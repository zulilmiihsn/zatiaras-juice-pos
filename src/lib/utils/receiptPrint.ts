/**
 * Util cetak struk bersama (DRY) — dipakai oleh riwayat umum/kasir/pemilik.
 * Mengganti builder HTML struk yang sebelumnya diduplikasi verbatim di 3 file.
 *
 * Sumber kebenaran: lihat CONVENTIONS.md §2.
 */
import * as pako from 'pako';
import { Base64 } from 'js-base64';
import { LOGO_BASE64 } from './logoBase64.js';
import { formatRupiah } from './currency.js';
import type { ReceiptSettings, HistoryItem } from '../types/laporan.js';
import { formatOrderDetails } from './orderDetails.js';

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
	items: SaleReceiptItem[];
	customerName: string;
	total: number;
	paymentMethod: string;
	cashReceived: number;
	change: number;
	queuedOffline: boolean;
	printedAt?: Date;
};

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/** Default pengaturan struk bila data toko belum tersedia. */
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
	nama_toko: 'Zatiaras Juice',
	alamat: 'Jl. Contoh Alamat No. 123, Kota',
	telepon: '0812-3456-7890',
	instagram: '@zatiarasjuice',
	// [CATATAN]: Newline asli '\n' (bukan literal '\\n') — dirender via white-space:pre-line.
	ucapan: 'Terima kasih sudah ngejus di\nZatiaras Juice!'
};

/** Label metode bayar untuk tampilan struk. */
export const METHOD_LABELS: Record<string, string> = {
	tunai: 'Tunai',
	qris: 'QRIS',
	transfer: 'Transfer',
	'e-wallet': 'E-Wallet',
	card: 'Kartu',
	'non-tunai': 'QRIS/Non-Tunai'
};

type ReceiptShellHeader = {
	settings: ReceiptSettings;
	marginBottom: number;
	renderText: (value: unknown) => string;
};

function buildReceiptShell(header: ReceiptShellHeader, body: string, footer: string): string {
	const { settings, marginBottom, renderText } = header;
	let html = `<html><body style='font-family:monospace;color:#000;font-size:14px;line-height:1.5;margin:0;padding:8px;'>`;
	html += `<div style='text-align:center;margin-bottom:${marginBottom}px;'>`;
	html += `<img src='${LOGO_BASE64}' style='width:80px;height:80px;margin:0 auto 8px;display:block;' />`;
	html += `<div style='font-weight:bold;font-size:20px;text-transform:uppercase;'>${renderText(settings.nama_toko)}</div>`;
	html += `<div style='font-size:13px;margin-top:4px;'>${renderText(settings.alamat)}</div>`;
	if (settings.instagram || settings.telepon) {
		html += `<div style='font-size:13px;margin-top:2px;'>${settings.instagram ? renderText(settings.instagram) : ''}${settings.instagram && settings.telepon ? ' | ' : ''}${settings.telepon ? renderText(settings.telepon) : ''}</div>`;
	}
	html += `</div>`;
	html += `<div style='border-bottom:1px dashed #333;margin-bottom:12px;'></div>`;
	html += body;
	html += footer;
	html += `</body></html>`;
	return html;
}

/**
 * Muat pengaturan struk dari DB, fallback ke localStorage.
 * Mengembalikan null bila keduanya tidak tersedia (caller pakai DEFAULT via buildReceiptHtml).
 */
export async function loadReceiptSettings(): Promise<ReceiptSettings | null> {
	if (typeof window === 'undefined') return null;
	try {
		const { dbGet } = await import('$lib/services/dataApiClient');
		const rows = await dbGet('pengaturan');
		if (rows && rows.length > 0) {
			return rows[0] as unknown as ReceiptSettings;
		}
	} catch {
		// [CATATAN]: abaikan, jatuh ke localStorage
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
	items: Record<string, unknown>[]
): string {
	const p = pengaturan ?? DEFAULT_RECEIPT_SETTINGS;

	let body = `<div style='text-align:center;font-weight:bold;font-size:14px;margin-bottom:8px;'>*** CETAK ULANG ***</div>`;
	body += `<div style='text-align:left;font-size:13px;margin-bottom:12px;display:flex;justify-content:space-between;'>`;
	body += `<div>${trx.nama_pelanggan || ''}</div>`;
	body += `<div>${new Date(trx.waktu).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</div>`;
	body += `</div>`;

	body += `<table style='width:100%;font-size:14px;margin-bottom:12px;border-collapse:collapse;'><tbody>`;

	if (items.length > 0) {
		items.forEach((item: Record<string, unknown>) => {
			const produk = item.produk as Record<string, unknown> | undefined;
			const itemName = item.nama_kustom || (produk && produk.nama) || 'Produk Custom';
			body += `<tr><td style='text-align:left;padding-bottom:4px;font-weight:bold;'>${itemName} <span style='font-size:12px;font-weight:normal;'>x${item.jumlah}</span></td><td style='text-align:right;padding-bottom:4px;'>Rp${formatRupiah(Number(item.harga))}</td></tr>`;
		});
	} else {
		body += `<tr><td style='text-align:left;padding-bottom:4px;font-weight:bold;'>${trx.nama}</td><td style='text-align:right;padding-bottom:4px;'>Rp${formatRupiah(trx.nominal ?? 0)}</td></tr>`;
	}

	body += `</tbody></table>`;
	body += `<div style='border-bottom:1px dashed #333;margin-bottom:12px;'></div>`;

	body += `<table style='width:100%;font-size:14px;margin-bottom:24px;border-collapse:collapse;'><tbody>`;
	body += `<tr><td style='text-align:left;padding-bottom:4px;'>Total:</td><td style='text-align:right;font-weight:bold;font-size:16px;'>Rp${formatRupiah(trx.nominal ?? 0)}</td></tr>`;

	const methodKey = (trx.metode_bayar || '').toLowerCase();
	body += `<tr><td style='text-align:left;font-size:13px;padding-top:4px;'>Metode:</td><td style='text-align:right;font-size:13px;padding-top:4px;'>${METHOD_LABELS[methodKey] || methodKey}</td></tr>`;
	body += `</tbody></table>`;

	const footer = `<div style='text-align:center;font-size:13px;white-space:pre-line;'>${p.ucapan}</div>`;
	return buildReceiptShell(
		{ settings: p, marginBottom: 12, renderText: (value) => String(value) },
		body,
		footer
	);
}

/** Bangun HTML struk transaksi yang baru selesai dibayar. */
export function buildSaleReceiptHtml(input: SaleReceiptInput): string {
	const settings = input.settings ?? DEFAULT_RECEIPT_SETTINGS;
	const printedAt = input.printedAt ?? new Date();
	let body = `<div style='text-align:left;font-size:13px;margin-bottom:12px;display:flex;justify-content:space-between;'>`;
	body += `<div>${escapeHtml(input.customerName)}</div>`;
	body += `<div>${printedAt.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</div>`;
	body += `</div>`;
	if (input.queuedOffline) {
		body += `<div style='font-size:12px;margin-bottom:12px;'><b>STATUS: MENUNGGU SINKRONISASI</b></div>`;
	}
	body += `<table style='width:100%;font-size:14px;margin-bottom:12px;border-collapse:collapse;'><tbody>`;
	for (const item of input.items) {
		const isJumbo = (item.porsi || '').toLowerCase() === 'jumbo';
		const basePrice = isJumbo
			? (item.product.harga_jumbo ?? item.product.harga ?? 0)
			: (item.product.harga ?? 0);
		const porsiSuffix =
			isJumbo && !item.product.nama.toLowerCase().includes('jumbo') ? ' (Jumbo)' : '';
		const displayName = `${escapeHtml(item.product.nama)}${porsiSuffix}`;
		body += `<tr><td style='text-align:left;padding-bottom:4px;font-weight:bold;'>${displayName} <span style='font-size:12px;font-weight:normal;'>x${item.jumlah}</span></td><td style='text-align:right;padding-bottom:4px;'>Rp${formatRupiah(basePrice * item.jumlah)}</td></tr>`;
		for (const addOn of item.addOns ?? []) {
			body += `<tr><td style='font-size:12px;padding-left:8px;color:#333;'>+ ${escapeHtml(addOn.nama)}</td><td style='font-size:12px;text-align:right;color:#333;'>Rp${formatRupiah((addOn.harga ?? 0) * item.jumlah)}</td></tr>`;
		}
		const detail = formatOrderDetails(item);
		if (detail) {
			body += `<tr><td colspan='2' style='font-size:12px;padding-left:8px;padding-bottom:8px;color:#333;font-style:italic;'>${escapeHtml(detail)}</td></tr>`;
		}
	}
	body += `</tbody></table>`;
	body += `<div style='border-bottom:1px dashed #333;margin-bottom:12px;'></div>`;
	body += `<table style='width:100%;font-size:14px;margin-bottom:24px;border-collapse:collapse;'><tbody>`;
	body += `<tr><td style='text-align:left;padding-bottom:4px;'>Total:</td><td style='text-align:right;font-weight:bold;font-size:16px;'>Rp${formatRupiah(input.total)}</td></tr>`;
	body += `<tr><td style='text-align:left;font-size:13px;padding-top:4px;'>Metode:</td><td style='text-align:right;font-size:13px;padding-top:4px;'>${escapeHtml(METHOD_LABELS[input.paymentMethod] || input.paymentMethod)}</td></tr>`;
	if (input.paymentMethod === 'tunai') {
		body += `<tr><td style='text-align:left;font-size:13px;'>Dibayar:</td><td style='text-align:right;font-size:13px;'>Rp${formatRupiah(input.cashReceived)}</td></tr>`;
		body += `<tr><td style='text-align:left;font-size:13px;'>Kembalian:</td><td style='text-align:right;font-size:13px;'>Rp${input.change >= 0 ? formatRupiah(input.change) : '0'}</td></tr>`;
	}
	body += `</tbody></table>`;
	const footer = `<div style='text-align:center;font-size:13px;white-space:pre-line;'>${escapeHtml(settings.ucapan)}</div>`;
	return buildReceiptShell({ settings, marginBottom: 16, renderText: escapeHtml }, body, footer);
}

/** Kirim HTML struk ke printer via Android print-intent (gzip + base64). */
export function printViaIntent(html: string): void {
	const gzip = pako.gzip(JSON.stringify([html]));
	const base64 = Base64.fromUint8Array(gzip);
	const intentUrl = `intent://#Intent;scheme=print-intent;S.content=${base64};end`;
	window.location.href = intentUrl;
}
