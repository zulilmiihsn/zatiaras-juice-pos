import { formatRupiah } from './currency.js';
import { formatNomorHarian } from './orderNumber.js';
import { LOGO_BASE64 } from './logoBase64.js';
import type { PaperSize } from './printerConfig.js';

export interface ReceiptData {
	storeName: string;
	/** Nomor antrean harian resmi. Null = transaksi offline menunggu sinkron. */
	nomorHarian?: number | null;
	address?: string;
	phone?: string;
	instagram?: string;
	customerName?: string;
	dateTime: string;
	items: Array<{
		name: string;
		qty: number;
		price: number;
		unitPrice?: number;
		addOns?: Array<{ name: string; price: number }>;
		details?: string;
	}>;
	total: number;
	paymentMethod: string;
	cashReceived?: number;
	change?: number;
	footerMessage?: string;
	historyWarning?: string;
	queuedOffline?: boolean;
	reprint?: boolean;
}

export const METHOD_LABELS: Record<string, string> = {
	tunai: 'Tunai',
	qris: 'QRIS',
	transfer: 'Transfer',
	'e-wallet': 'E-Wallet',
	card: 'Kartu',
	'non-tunai': 'QRIS/Non-Tunai'
};

type TextNode = {
	type: 'text';
	text: string;
	x: number;
	y: number;
	size: number;
	bold: boolean;
	align: 'left' | 'center' | 'right';
};

export type ReceiptNode =
	| TextNode
	| { type: 'logo'; x: number; y: number; size: number }
	| { type: 'divider'; x: number; y: number; width: number };

export interface ReceiptLayout {
	width: number;
	height: number;
	paperSize: PaperSize;
	nodes: ReceiptNode[];
}

export type MeasureReceiptText = (text: string, size: number, bold: boolean) => number;

// Thick sans-serif strokes survive 1-bit thermal output; Android maps "Courier New" to a hairline typewriter face.
export const RECEIPT_FONT = 'Arial, Roboto, "Helvetica Neue", "Liberation Sans", sans-serif';

/** Control characters are never allowed to become printer commands or invisible layout changes. */
export function cleanReceiptText(text: string): string {
	return text
		.normalize('NFC')
		.replace(/\r\n?/g, '\n')
		.replace(/\p{Cc}/gu, (character) => (character === '\n' ? '\n' : ''))
		.replace(/[\u2028\u2029]/g, '\n')
		.replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
}

/** Wrap every line, including a single word wider than the available paper. */
export function wrapReceiptText(
	text: string,
	width: number,
	measure: (text: string) => number
): string[] {
	if (width <= 0) throw new Error('Lebar cetak struk tidak valid.');
	const result: string[] = [];
	const segmenter = new Intl.Segmenter('id', { granularity: 'grapheme' });
	for (const paragraph of cleanReceiptText(text).split('\n')) {
		let line = '';
		for (const { segment } of segmenter.segment(paragraph)) {
			while (measure(line + segment) > width && line) {
				const space = line.lastIndexOf(' ');
				if (space > 0 && segment !== ' ') {
					result.push(line.slice(0, space));
					line = line.slice(space + 1);
				} else {
					result.push(line.trimEnd());
					line = '';
				}
			}
			if (measure(segment) > width)
				throw new Error('Karakter struk terlalu lebar untuk area cetak.');
			if (segment !== ' ' || line) line += segment;
		}
		result.push(line.trimEnd());
	}
	return result;
}

/** One layout owns paper width, wrapping, amounts, warnings, logo, and spacing for every transport. */
export function buildReceiptLayout(
	data: ReceiptData,
	paperSize: PaperSize = '58mm',
	measure: MeasureReceiptText = (text, size) => Array.from(text).length * size * 0.6
): ReceiptLayout {
	const width = paperSize === '80mm' ? 576 : 384;
	const padding = 12;
	const innerWidth = width - padding * 2;
	const nodes: ReceiptNode[] = [];
	let y = 12;
	const text = (value: string, size = 20, bold = false, align: TextNode['align'] = 'left') => {
		for (const line of wrapReceiptText(value, innerWidth, (s) => measure(s, size, bold))) {
			nodes.push({
				type: 'text',
				text: line,
				y,
				size,
				bold,
				align,
				x: align === 'center' ? width / 2 : align === 'right' ? width - padding : padding
			});
			y += Math.ceil(size * 1.3);
		}
	};
	const columns = (left: string, right: string, bold = false, size = 20) => {
		const rightWidth = measure(right, size, bold);
		const available = innerWidth - rightWidth - 12;
		if (available < size * 3) {
			text(left, size, bold);
			text(right, size, bold, 'right');
			return;
		}
		const lines = wrapReceiptText(left, available, (s) => measure(s, size, bold));
		for (let i = 0; i < lines.length; i++) {
			nodes.push({ type: 'text', text: lines[i], x: padding, y, size, bold, align: 'left' });
			if (i === 0)
				nodes.push({
					type: 'text',
					text: right,
					x: width - padding,
					y,
					size,
					bold,
					align: 'right'
				});
			y += Math.ceil(size * 1.3);
		}
	};
	const divider = () => {
		y += 10;
		nodes.push({ type: 'divider', x: padding, y, width: innerWidth });
		y += 12;
	};

	// Header Toko
	nodes.push({ type: 'logo', x: (width - 96) / 2, y, size: 96 });
	y += 108;
	text(data.storeName.toUpperCase(), 26, true, 'center');
	if (data.address) text(data.address, 18, false, 'center');
	if (data.instagram) text(data.instagram, 18, false, 'center');
	if (data.phone) text(data.phone, 18, false, 'center');
	divider();
	if (data.reprint) text('*** CETAK ULANG ***', 20, true, 'center');

	// Info Pelanggan & Waktu
	const nomor = formatNomorHarian(data.nomorHarian);
	y += 4;
	text('NOMOR PESANAN', 16, false, 'center');
	y += 4;
	text(
		nomor ?? (data.queuedOffline ? 'Menunggu sinkronisasi' : 'Belum tersedia'),
		nomor ? 52 : 18,
		true,
		'center'
	);
	y += 12;
	text(data.customerName || 'Pelanggan');
	text(data.dateTime, 18);
	if (data.queuedOffline) text('STATUS: MENUNGGU SINKRONISASI', 18, true);
	divider();

	// Daftar Item Belanja
	for (const item of data.items) {
		// Breakdown terpercaya: baris dasar + topping terpisah (jumlah = subtotal).
		// Inklusif legacy: satu baris subtotal, topping sudah termasuk.
		columns(`${item.name} x${item.qty}`, `Rp${formatRupiah(item.price)}`, true);
		if (item.qty > 1 && item.unitPrice !== undefined)
			text(`  @Rp${formatRupiah(item.unitPrice)}`, 18);
		for (const addOn of item.addOns ?? [])
			columns(`  + ${addOn.name}`, `Rp${formatRupiah(addOn.price)}`, false, 18);
		if (item.details) text(`  ${item.details}`, 18);
		y += 6;
	}
	divider();

	// Total Pembayaran
	columns('TOTAL', `Rp${formatRupiah(data.total)}`, true, 24);
	const method = data.paymentMethod.toLowerCase();
	columns('Metode', METHOD_LABELS[method] || data.paymentMethod, false, 18);
	if (method === 'tunai') {
		if (data.cashReceived !== undefined)
			columns('Dibayar', `Rp${formatRupiah(data.cashReceived)}`, false, 18);
		if (data.change !== undefined)
			columns('Kembalian', `Rp${formatRupiah(data.change)}`, false, 18);
		if (data.reprint && (data.cashReceived === undefined || data.change === undefined))
			text('Data uang diterima atau kembalian: Tidak tersimpan', 18, true);
	}
	divider();

	// Jelaskan bila data historis yang tidak tersedia memang tidak pernah tersimpan.
	if (data.historyWarning) text(data.historyWarning, 18, true);
	// Ucapan Footer
	if (data.footerMessage) text(data.footerMessage, 18, false, 'center');
	y += 18;
	if (y > 16_384)
		throw new Error('Struk terlalu panjang untuk dirender. Kurangi jumlah item per transaksi.');
	return { width, height: y, paperSize, nodes };
}

export function escapeReceiptHtml(value: string): string {
	return cleanReceiptText(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/** Printable content is 48/72 mm at 203 dpi, leaving the thermal printer's unprintable edges. */
export function receiptHtmlShell(content: string, layout: ReceiptLayout): string {
	const paperWidth = layout.paperSize === '80mm' ? 80 : 58;
	const printWidth = layout.paperSize === '80mm' ? 72 : 48;
	const heightMm = Math.ceil(layout.height / 8);
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Struk</title><style>@page{size:${paperWidth}mm ${heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${printWidth}mm;background:white;color:#181818}svg,img{display:block;width:${printWidth}mm;height:auto;max-width:100%}@media print{html,body{width:${printWidth}mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>${content}</body></html>`;
}

/** The synchronous HTML representation shares the same layout as the browser raster renderer. */
export function buildReceiptDocumentHtml(data: ReceiptData, paperSize: PaperSize = '58mm'): string {
	const layout = buildReceiptLayout(data, paperSize);
	const nomor = formatNomorHarian(data.nomorHarian);
	const description = [
		data.storeName,
		data.customerName,
		data.address,
		data.phone,
		data.instagram,
		data.historyWarning,
		data.footerMessage,
		...(nomor ? [`No. Pesanan: ${nomor}`] : []),
		...data.items.flatMap((item) => [item.name, item.details]),
		...(data.queuedOffline
			? [...(nomor ? [] : ['No. Pesanan: menunggu sinkronisasi']), 'STATUS: MENUNGGU SINKRONISASI']
			: [])
	]
		.filter(Boolean)
		.join('\n');
	const content =
		`<desc>${escapeReceiptHtml(description)}</desc>` +
		layout.nodes
			.map((node) => {
				if (node.type === 'logo')
					return `<image href="${LOGO_BASE64}" x="${node.x}" y="${node.y}" width="${node.size}" height="${node.size}"/>`;
				if (node.type === 'divider')
					return `<path d="M${node.x} ${node.y}h${node.width}" stroke="#181818" stroke-dasharray="4 4"/>`;
				const anchor =
					node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
				return `<text x="${node.x}" y="${node.y}" dominant-baseline="text-before-edge" text-anchor="${anchor}" font-size="${node.size}" font-weight="${node.bold ? 700 : 400}">${escapeReceiptHtml(node.text)}</text>`;
			})
			.join('');
	return receiptHtmlShell(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" style='font-family:${RECEIPT_FONT}' fill="#181818">${content}</svg>`,
		layout
	);
}
