import { decodeReceiptSnapshot, type ReceiptSnapshotSettings } from '$lib/utils/receiptSnapshot';
import type { BranchContext } from '../branchResolver';
import { recordErrorEvent } from '../observability';
import type { getExistingByIdempotency } from './dataLoader';
import type { CheckoutResult, PosQuoteTokenData } from './types';
import { CheckoutUseCaseError, normalizeMoney } from './utils';

type ExistingTransaction = NonNullable<Awaited<ReturnType<typeof getExistingByIdempotency>>>;

export function buildReceiptFromQuote(
	quote: PosQuoteTokenData,
	input: {
		totalAmount: number;
		cashReceived: number;
		paymentMethod: 'tunai' | 'non-tunai';
		committedAt: string;
		customerName: string | null;
		settings: ReceiptSnapshotSettings | null;
	}
) {
	return {
		schema_version: 1 as const,
		items: quote.items.map((item) => {
			const unitPrice =
				normalizeMoney(item.product_price) +
				item.add_ons.reduce((sum, addOn) => sum + normalizeMoney(addOn.harga), 0);
			return {
				product_id: item.source.product_id ? String(item.source.product_id) : null,
				nama: item.product_name,
				jumlah: Number(item.source.jumlah),
				harga: unitPrice,
				nominal: normalizeMoney(item.line_total),
				harga_dasar: normalizeMoney(item.product_price),
				total_tambahan: unitPrice - normalizeMoney(item.product_price),
				tambahan: item.add_ons,
				gula: item.source.gula || null,
				es: item.source.es || null,
				catatan: item.source.catatan || null
			};
		}),
		total_amount: input.totalAmount,
		total_qty: quote.total_qty,
		cash_received: input.cashReceived,
		change:
			input.paymentMethod === 'tunai' && input.cashReceived > 0
				? input.cashReceived - input.totalAmount
				: 0,
		metode_bayar: input.paymentMethod,
		committed_at: input.committedAt,
		customer_name: input.customerName || null,
		settings: input.settings
	};
}

async function parseStoredReceiptSnapshot(
	snapshot: string,
	platform: App.Platform | undefined,
	branch: BranchContext,
	transactionId: string
) {
	try {
		const receipt = decodeReceiptSnapshot(snapshot);
		if (!receipt) throw new Error('Snapshot struk kosong');
		return receipt;
	} catch (cause) {
		await recordErrorEvent(platform, branch, {
			source: 'checkout.receipt_snapshot',
			error: cause,
			status: 500,
			context: { transaction_id: transactionId }
		});
		throw new CheckoutUseCaseError(
			500,
			'Struk transaksi tersimpan tidak dapat dibaca. Hubungi pemilik.'
		);
	}
}

/**
 * Hasil untuk transaksi yang sudah tercatat dengan idempotency key yang sama. Fingerprint
 * berbeda berarti key dipakai untuk transaksi lain: ditolak tanpa mengubah apa pun.
 */
export async function buildCommittedResult(
	row: ExistingTransaction,
	context: {
		platform: App.Platform | undefined;
		branch: BranchContext;
		requestFingerprint: string;
		paymentMethod: 'tunai' | 'non-tunai';
		cashReceived: number;
		/** Struk untuk baris yang belum punya snapshot tersimpan. */
		receiptFallback?: (row: ExistingTransaction) => unknown;
	}
): Promise<CheckoutResult> {
	if (row.request_fingerprint !== context.requestFingerprint) {
		throw new CheckoutUseCaseError(409, 'Idempotency key sudah dipakai untuk transaksi berbeda');
	}

	let receipt: unknown = row.receipt_snapshot
		? await parseStoredReceiptSnapshot(
				row.receipt_snapshot,
				context.platform,
				context.branch,
				row.transaction_id
			)
		: null;
	if (!receipt && context.receiptFallback) receipt = context.receiptFallback(row);

	return {
		idempotent: true,
		d1Meta: null,
		data: {
			buku_kas_id: row.id,
			transaction_id: row.transaction_id,
			committed_at: row.waktu || new Date().toISOString(),
			total_amount: row.nominal,
			total_qty: row.jumlah,
			change:
				context.paymentMethod === 'tunai' && context.cashReceived > 0
					? context.cashReceived - row.nominal
					: 0,
			nomor_harian: row.nomor_harian ?? null,
			tanggal_nomor: row.tanggal_nomor ?? null,
			receipt
		}
	};
}
