/**
 * Struk penjualan POS: snapshot offline dan data cetak (HTML + ESC/POS) dari satu sumber.
 * Murni: tidak membaca state Svelte, storage, atau printer.
 */
import type { CartItem, CartProduct } from '../types/cart.js';
import type { ReceiptSettings } from '../types/laporan.js';
import type { buildReceiptEscPos } from './escposBuilder.js';
import { buildSaleReceiptHtml } from './receiptPrint.js';
import { formatOrderDetails } from './orderDetails.js';

const UNAVAILABLE_STORE_NAME = 'Header toko saat transaksi tidak tersimpan';

/** Struk yang dikomit server (atau dibentuk lokal saat transaksi masuk antrean offline). */
export interface CommittedReceipt {
	items: Array<{
		product_id: string | null;
		nama: string;
		jumlah: number;
		harga: number;
		nominal: number;
		harga_dasar?: number;
		total_tambahan?: number;
		tambahan: Array<{ id: string; nama: string; harga: number }>;
		gula: string | null;
		es: string | null;
		catatan: string | null;
	}>;
	total_amount: number;
	total_qty: number;
	cash_received: number;
	change: number;
	metode_bayar: string;
	committed_at: string;
	settings?: ReceiptSettings | null;
}

export interface SaleTotals {
	totalAmount: number;
	totalQty: number;
	cashReceived: number;
	paymentMethod: string;
}

/** Bentuk minimum item yang bisa dicetak: keranjang terbuka atau struk komit. */
type PrintableItem = Pick<CartItem, 'jumlah' | 'porsi' | 'gula' | 'es' | 'catatan'> & {
	product: Pick<CartProduct, 'nama' | 'harga' | 'harga_jumbo'>;
	addOns: Array<{ nama: string; harga: number }>;
};

function unitBasePrice(item: PrintableItem): number {
	const prod = item.product;
	return item.porsi === 'jumbo' ? (prod.harga_jumbo ?? prod.harga ?? 0) : (prod.harga ?? 0);
}

/** Snapshot struk dari keranjang lokal, dipakai saat checkout masuk antrean offline. */
export function buildOfflineReceipt(
	cart: CartItem[],
	sale: SaleTotals,
	committedAt: Date = new Date()
): CommittedReceipt {
	const { totalAmount, cashReceived, paymentMethod } = sale;
	return {
		items: cart.map((item) => {
			const basePrice = unitBasePrice(item);
			const addOnsTotal = (item.addOns || []).reduce((sum, a) => sum + (a.harga || 0), 0);
			const unitPrice = basePrice + addOnsTotal;
			return {
				product_id: item.product.id ? String(item.product.id) : null,
				nama: item.product.nama,
				jumlah: item.jumlah,
				harga: unitPrice,
				nominal: unitPrice * item.jumlah,
				harga_dasar: basePrice,
				total_tambahan: addOnsTotal,
				tambahan: (item.addOns || []).map((a) => ({
					id: String(a.id),
					nama: a.nama,
					harga: a.harga
				})),
				gula: item.gula || null,
				es: item.es || null,
				catatan: item.catatan || null
			};
		}),
		total_amount: totalAmount,
		total_qty: sale.totalQty,
		cash_received: cashReceived,
		change:
			paymentMethod === 'tunai' && cashReceived > totalAmount ? cashReceived - totalAmount : 0,
		metode_bayar: paymentMethod === 'qris' ? 'non-tunai' : paymentMethod,
		committed_at: committedAt.toISOString()
	};
}

export interface SaleReceiptPrintInput {
	/** Struk komit; null = cetak dari keranjang yang masih terbuka. */
	receipt: CommittedReceipt | null;
	cart: CartItem[];
	/** Pengaturan struk terkini, hanya dipakai bila belum ada struk komit. */
	settings: ReceiptSettings | null;
	nomorHarian: number | null;
	customerName: string;
	total: number;
	paymentMethod: string;
	cashReceived: number;
	change: number;
	queuedOffline: boolean;
}

export interface SaleReceiptPrint {
	html: string;
	receiptData: Parameters<typeof buildReceiptEscPos>[0];
}

/** HTML dan data ESC/POS dari nilai yang sama, agar kedua jalur cetak tidak berbeda. */
export function buildSaleReceiptPrint(input: SaleReceiptPrintInput): SaleReceiptPrint {
	const { receipt } = input;
	// Struk komit: harga dasar (tanpa topping) + rincian topping terpisah.
	// harga inklusif TIDAK dipakai sebagai dasar agar tidak ganda.
	const items: PrintableItem[] = receipt
		? receipt.items.map((item) => ({
				product: { nama: item.nama, harga: item.harga_dasar ?? item.harga },
				jumlah: item.jumlah,
				porsi: undefined,
				addOns: item.tambahan,
				gula: item.gula || '',
				es: item.es || '',
				catatan: item.catatan || ''
			}))
		: input.cart;

	const settings = receipt
		? (receipt.settings ?? { nama_toko: UNAVAILABLE_STORE_NAME, ucapan: '' })
		: input.settings;
	const total = receipt?.total_amount ?? input.total;
	const paymentMethod = receipt?.metode_bayar ?? input.paymentMethod;
	const cashReceived = receipt?.cash_received ?? input.cashReceived;
	const change = receipt?.change ?? input.change;
	const printedAt = receipt?.committed_at ? new Date(receipt.committed_at) : undefined;

	const html = buildSaleReceiptHtml({
		settings,
		nomorHarian: input.nomorHarian,
		items,
		customerName: input.customerName,
		total,
		paymentMethod,
		cashReceived,
		change,
		queuedOffline: input.queuedOffline,
		printedAt
	});

	const receiptData: SaleReceiptPrint['receiptData'] = {
		storeName: settings?.nama_toko || UNAVAILABLE_STORE_NAME,
		nomorHarian: input.nomorHarian,
		address: settings?.alamat,
		phone: settings?.telepon,
		instagram: settings?.instagram,
		customerName: input.customerName || 'Pelanggan',
		dateTime: (printedAt ?? new Date()).toLocaleString('id-ID'),
		items: items.map((item) => {
			const isJumbo = item.porsi === 'jumbo';
			const porsiSuffix =
				isJumbo && !item.product.nama.toLowerCase().includes('jumbo') ? ' (Jumbo)' : '';
			return {
				name: `${item.product.nama}${porsiSuffix}`,
				qty: item.jumlah,
				price: unitBasePrice(item) * item.jumlah,
				addOns: (item.addOns || []).map((a) => ({
					name: a.nama,
					price: (a.harga ?? 0) * item.jumlah
				})),
				details: formatOrderDetails(item) || undefined
			};
		}),
		total,
		paymentMethod,
		cashReceived,
		change,
		footerMessage: settings?.ucapan,
		queuedOffline: input.queuedOffline
	};

	return { html, receiptData };
}
