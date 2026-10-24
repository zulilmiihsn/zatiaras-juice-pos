/**
 * Util cetak struk bersama (DRY) — dipakai oleh riwayat umum/kasir/pemilik.
 * Mengganti builder HTML struk yang sebelumnya diduplikasi verbatim di 3 file.
 *
 * Sumber kebenaran: lihat CONVENTIONS.md §2.
 */
import type { ReceiptSettings, HistoryItem } from '../types/laporan.js';
import { formatOrderDetails } from './orderDetails.js';
import { buildHistoryEscPosData } from './historyReceipt.js';
import { buildReceiptDocumentHtml, type ReceiptData } from './receiptLayout.js';
import { roundMoney } from './money.js';
import type { PaperSize } from './printerConfig.js';

type SaleReceiptItem = {
	product: { nama: string; harga?: number | null; harga_jumbo?: number | null };
	porsi?: string | null;
	jumlah: number;
	addOns?: Array<{ nama: string; harga?: number | null }>;
	gula?: string | null;
	es?: string | null;
	catatan?: string | null;
};

type SaleReceiptInput = {
	settings: ReceiptSettings | null;
	/** Nomor antrean harian resmi. Null = transaksi offline menunggu sinkron. */
	nomorHarian?: number | null;
	items: SaleReceiptItem[];
	customerName: string;
	total: number;
	paymentMethod: string;
	cashReceived: number;
	change: number;
	queuedOffline: boolean;
	printedAt?: Date;
};

/** Default pengaturan struk bila data toko belum tersedia. */
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
	nama_toko: 'Zatiaras Juice',
	alamat: 'Jl. Contoh Alamat No. 123, Kota',
	telepon: '0812-3456-7890',
	instagram: '@zatiarasjuice',
	// Newline asli '\n' (bukan literal '\\n') — dirender via white-space:pre-line.
	ucapan: 'Terima kasih sudah ngejus di\nZatiaras Juice!'
};

/** Label metode bayar untuk tampilan struk. */
export { METHOD_LABELS } from './receiptLayout.js';

/**
 * Muat pengaturan struk dari DB, fallback ke localStorage.
 * Mengembalikan null bila keduanya tidak tersedia (caller pakai DEFAULT via buildReceiptHtml).
 */
export async function loadReceiptSettings(): Promise<ReceiptSettings | null> {
	if (typeof window === 'undefined') return null;
	try {
		const { dbGet } = await import('$lib/services/dataApiClient');
		const rows = await dbGet('pengaturan');
		if (rows && rows.length > 0) return rows[0] as unknown as ReceiptSettings;
	} catch {
		// abaikan, jatuh ke localStorage
	}
	const local =
		typeof localStorage !== 'undefined' ? localStorage.getItem('pengaturan_struk') : null;
	if (local) {
		try {
			return JSON.parse(local) as ReceiptSettings;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Bangun HTML struk cetak-ulang untuk satu transaksi.
 * @param trx transaksi yang dicetak
 * @param pengaturan pengaturan struk (null → pakai DEFAULT_RECEIPT_SETTINGS)
 * @param items detail item (kosong → tampilkan satu baris ringkas dari trx)
 */
export function buildReceiptHtml(
	trx: HistoryItem,
	pengaturan: ReceiptSettings | null,
	items: Record<string, unknown>[],
	paperSize: PaperSize = '58mm'
): string {
	return buildReceiptDocumentHtml(
		buildHistoryEscPosData({
			history: trx,
			settings: pengaturan ?? DEFAULT_RECEIPT_SETTINGS,
			items,
			historyWarning: null
		}),
		paperSize
	);
}

export function buildSaleReceiptData(input: SaleReceiptInput): ReceiptData {
	const settings = input.settings ?? DEFAULT_RECEIPT_SETTINGS;
	const printedAt = input.printedAt ?? new Date();
	return {
		// Kolom pengaturan.nama_toko boleh NULL dan barisnya dibaca tanpa validasi.
		storeName: (settings.nama_toko ?? '').trim() || DEFAULT_RECEIPT_SETTINGS.nama_toko,
		address: settings.alamat,
		phone: settings.telepon,
		instagram: settings.instagram,
		footerMessage: settings.ucapan,
		nomorHarian: input.nomorHarian,
		customerName: input.customerName || 'Pelanggan',
		dateTime: printedAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
		items: input.items.map((item) => {
			const isJumbo = (item.porsi || '').toLowerCase() === 'jumbo';
			const basePrice = isJumbo
				? (item.product.harga_jumbo ?? item.product.harga ?? 0)
				: (item.product.harga ?? 0);
			const porsiSuffix =
				isJumbo && !item.product.nama.toLowerCase().includes('jumbo') ? ' (Jumbo)' : '';
			return {
				name: `${item.product.nama}${porsiSuffix}`,
				qty: item.jumlah,
				price: roundMoney(basePrice * item.jumlah),
				addOns: (item.addOns ?? []).map((addOn) => ({
					name: addOn.nama,
					price: roundMoney((addOn.harga ?? 0) * item.jumlah)
				})),
				details: formatOrderDetails(item) || undefined
			};
		}),
		total: input.total,
		paymentMethod: input.paymentMethod,
		cashReceived: input.cashReceived,
		change: Math.max(0, input.change),
		queuedOffline: input.queuedOffline
	};
}

/** Bangun HTML struk transaksi yang baru selesai dibayar. */
export function buildSaleReceiptHtml(
	input: SaleReceiptInput,
	paperSize: PaperSize = '58mm'
): string {
	return buildReceiptDocumentHtml(buildSaleReceiptData(input), paperSize);
}

/** Preview and connection tests use the real renderer and the same arithmetically consistent sample. */
export function buildSampleReceipt(settings: ReceiptSettings, printedAt = new Date()): ReceiptData {
	return buildSaleReceiptData({
		settings,
		nomorHarian: 7,
		items: [
			{
				product: { nama: 'Jus Mangga', harga: 10_000 },
				jumlah: 2,
				addOns: [{ nama: 'Topping Nata', harga: 2_000 }],
				gula: 'no',
				es: 'less'
			},
			{ product: { nama: 'Jus Alpukat', harga: 15_000 }, jumlah: 1 }
		],
		customerName: 'Pelanggan Contoh',
		total: 39_000,
		paymentMethod: 'tunai',
		cashReceived: 50_000,
		change: 11_000,
		queuedOffline: false,
		printedAt
	});
}

function uint8ToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** RawBT Android and the vendor's PC WebSocket server accept the same ESC/POS envelope. */
export function buildRawBtIntentUrl(bytes: Uint8Array): string {
	return `intent:base64,${uint8ToBase64(bytes)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

/** Bangun URL intent cetak (gzip + base64) tanpa navigasi; dipakai ulang jalur server. */
export async function buildPrintIntentUrl(html: string): Promise<string> {
	const { gzip } = await import('pako');
	const gzipped = gzip(JSON.stringify([html]));
	return `intent://#Intent;scheme=print-intent;S.content=${uint8ToBase64(gzipped)};end`;
}

/** Kirim HTML struk ke printer via Android print-intent (gzip + base64). */
export async function printViaIntent(html: string): Promise<void> {
	window.location.href = await buildPrintIntentUrl(html);
}
