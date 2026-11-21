import { formatDateYmdWita } from '$lib/utils/dateTime';
import type { BranchContext } from '../branchResolver';
import { resolveCheckoutQuote } from './quoteResolution';
import { buildReceiptFromQuote } from './checkoutReceipt';
import { CheckoutDomainError, normalizeMoney, normalizePaymentMethod } from './utils';
import type { PosTransactionItemInput } from './types';
import { reserveKioskInventory } from '../kioskInventory';
import { enqueueKioskProjection } from '../kioskProjectionQueue';
import { addCoordinatedSaleTotals } from '../coordinatedShift';
import type { DurableObjectStorage } from '@cloudflare/workers-types';

interface SaleInput {
	id: string;
	shiftId: string;
	payment: 'tunai' | 'non-tunai';
	cash: number;
	items: PosTransactionItemInput[];
}

function parseSale(raw: unknown): SaleInput {
	const data = raw as Partial<SaleInput> | null;
	if (
		!data ||
		typeof data.id !== 'string' ||
		!/^[-\w]{8,114}$/.test(data.id) ||
		typeof data.shiftId !== 'string' ||
		!/^[-\w]{1,128}$/.test(data.shiftId) ||
		typeof data.cash !== 'number' ||
		!Number.isSafeInteger(data.cash) ||
		data.cash < 0 ||
		!Array.isArray(data.items) ||
		!data.items.length ||
		data.items.length > 20
	)
		throw new CheckoutDomainError(400, 'Data penjualan tidak valid');
	const items = data.items.map((item) => {
		if (
			!item ||
			typeof item.product_id !== 'string' ||
			!item.product_id ||
			item.product_id.length > 128 ||
			typeof item.product_price_token !== 'string' ||
			!item.product_price_token ||
			item.product_price_token.length > 8192 ||
			!Number.isInteger(item.jumlah) ||
			item.jumlah < 1 ||
			item.jumlah > 99
		)
			throw new CheckoutDomainError(400, 'Item penjualan tidak valid');
		const ids = item.add_on_ids ?? [];
		const tokens = item.add_on_price_tokens ?? [];
		if (
			!Array.isArray(ids) ||
			!Array.isArray(tokens) ||
			ids.length > 10 ||
			tokens.length !== ids.length ||
			new Set(ids).size !== ids.length ||
			ids.some((id) => typeof id !== 'string' || !id || id.length > 128) ||
			tokens.some((token) => typeof token !== 'string' || !token || token.length > 8192) ||
			(item.porsi != null && item.porsi !== 'reguler' && item.porsi !== 'jumbo')
		)
			throw new CheckoutDomainError(400, 'Pilihan produk tidak valid');
		return {
			porsi: item.porsi ?? 'reguler',
			add_on_ids: ids,
			add_on_price_tokens: tokens,
			product_id: item.product_id,
			jumlah: item.jumlah,
			product_price_token: item.product_price_token
		};
	});
	return {
		id: data.id,
		shiftId: data.shiftId,
		payment: normalizePaymentMethod(data.payment),
		cash: normalizeMoney(data.cash),
		items
	};
}

export interface CoordinatedSaleRecord {
	fingerprint: string;
	orderNumber: number;
	orderDate: string;
	stockPolicyEpoch?: string;
	userId: string;
	request: SaleInput;
	receipt: ReturnType<typeof buildReceiptFromQuote>;
}

/** Journal only: not a D1 commit, stock mutation, or payment-provider confirmation. */
export async function recordCoordinatedSale(
	storage: Pick<DurableObjectStorage, 'get' | 'transaction'>,
	platform: App.Platform,
	branch: BranchContext,
	userId: string,
	raw: unknown,
	now: number,
	stockPolicyEpoch?: string
) {
	const input = parseSale(raw);
	const key = `sale:request:${input.id}`;
	const signature = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([branch, userId, input]))
	);
	const fingerprint = Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
	type Record = CoordinatedSaleRecord;
	function replay(prior: Record) {
		if (prior.fingerprint !== fingerprint)
			throw new CheckoutDomainError(409, 'ID penjualan sudah dipakai untuk transaksi lain');
		return { status: 'replayed', receipt: prior.receipt, orderNumber: prior.orderNumber } as const;
	}
	const saved = await storage.get<Record>(key);
	if (saved) return replay(saved);
	const quote = await resolveCheckoutQuote(
		platform,
		branch,
		{ items: input.items, metode_bayar: input.payment, queued_at: now },
		'offline_replay'
	);
	if (
		!Number.isSafeInteger(quote.total_amount) ||
		quote.total_amount <= 0 ||
		(input.payment === 'tunai' && input.cash < quote.total_amount) ||
		(input.payment === 'non-tunai' && input.cash !== quote.total_amount)
	)
		throw new CheckoutDomainError(400, 'Nominal pembayaran tidak cocok dengan harga katalog');
	const receipt = buildReceiptFromQuote(quote, {
		totalAmount: quote.total_amount,
		cashReceived: input.cash,
		paymentMethod: input.payment,
		committedAt: new Date(now).toISOString(),
		customerName: null,
		settings: null
	});
	return storage.transaction(async (tx) => {
		const prior = await tx.get<Record>(key);
		if (prior) return replay(prior);
		const shift = await tx.get<Parameters<typeof addCoordinatedSaleTotals>[1] | null>(
			'shift:active'
		);
		if (!shift || shift.id !== input.shiftId || now < shift.openedAt)
			throw new CheckoutDomainError(409, 'Shift aktif sudah berubah');
		if (!(await addCoordinatedSaleTotals(tx, shift, receipt.total_amount, receipt.metode_bayar)))
			throw new CheckoutDomainError(409, 'Total penjualan shift melebihi batas aman');
		const orderDate = formatDateYmdWita(receipt.committed_at);
		const handoff = await tx.get<{ date: string }>('sale:handoff');
		if (!handoff || orderDate < handoff.date)
			throw new CheckoutDomainError(409, 'Penghitung antrean kios belum dialihkan');
		await reserveKioskInventory(tx, input.items);
		const counter = 'sale:counter:' + orderDate;
		const orderNumber = ((await tx.get<number>(counter)) ?? 0) + 1;
		if (!Number.isSafeInteger(orderNumber))
			throw new CheckoutDomainError(409, 'Nomor antrean melebihi batas aman');
		await tx.put(counter, orderNumber);
		await tx.put(key, {
			fingerprint,
			userId,
			request: input,
			receipt,
			orderNumber,
			orderDate,
			stockPolicyEpoch
		} satisfies Record);
		await enqueueKioskProjection(tx, 'sale-recorded', key);
		return { status: 'recorded', receipt, orderNumber } as const;
	});
}
