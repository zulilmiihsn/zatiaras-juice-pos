/**
 * Struk mode teks: isi struk dicetak dengan font bawaan printer (sel 12×24 titik), hanya logo
 * yang dikirim sebagai gambar. Datanya ±10× lebih kecil dari struk gambar penuh, jadi cepat
 * lewat Bluetooth. Murni: tidak memakai canvas; glyph huruf diberikan oleh pemanggil.
 */
import { formatRupiah } from './currency.js';
import { formatNomorHarian } from './orderNumber.js';
import { cleanReceiptText, METHOD_LABELS, type ReceiptData } from './receiptLayout.js';
import type { PaperSize } from './printerConfig.js';
import type { ReceiptBitmap } from './escposBuilder.js';

/** Font A ESC/POS: 12 titik lebar, 24 titik tinggi. */
export const ROM_CELL_WIDTH = 12;
export const ROM_CELL_HEIGHT = 24;
/** Jarak antarbaris di bawah tinggi huruf, dikirim lewat ESC J agar tidak bergantung jarak LF printer. */
export const TEXT_LINE_GAP = 6;
/**
 * Jarak kiri-kanan isi struk: satu spasi ukuran normal (12 titik ≈ 1,5 mm), sama dengan mode
 * gambar. Spasi dipakai, bukan GS L, karena dukungan perintah margin di printer mini tidak pasti.
 */
const TEXT_MARGIN = ' ';
export const LOGO_SIZE = 96;
const LOGO_GAP = 8;

/** Bitmap satu huruf: ROM_CELL_HEIGHT baris × 2 byte, bit paling kiri = MSB byte pertama. */
export type RomGlyph = (code: number, bold: boolean) => Uint8Array;

export type ReceiptTextBlock =
	| { type: 'logo' }
	| { type: 'feed'; dots: number }
	| {
			type: 'text';
			text: string;
			bold: boolean;
			scale: 1 | 2 | 3;
			align: 'left' | 'center' | 'right';
	  };

export function paperDots(paperSize: PaperSize): number {
	return paperSize === '80mm' ? 576 : 384;
}

/** Gambar logo dibuat selebar tepi kiri sampai sisi kanan logo, jadi tetap di tengah tanpa ESC a. */
export function logoRasterWidth(paperSize: PaperSize): number {
	return (paperDots(paperSize) + LOGO_SIZE) / 2;
}

const ASCII_REPLACEMENTS: Record<string, string> = {
	'–': '-',
	'—': '-',
	'‘': "'",
	'’': "'",
	'“': '"',
	'”': '"',
	'…': '...',
	'×': 'x',
	'•': '-'
};

/** Font ROM hanya pasti punya ASCII: aksen dibuang, karakter lain jadi '?'. */
export function toPrinterAscii(text: string): string {
	return cleanReceiptText(text)
		.replace(/\n/g, ' ')
		.replace(/[–—‘’“”…×•]/g, (character) => ASCII_REPLACEMENTS[character])
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\x20-\x7e]/g, '?');
}

/** Bungkus per kata; spasi awal (indentasi) diulang di setiap baris lanjutan. */
export function wrapColumns(text: string, columns: number): string[] {
	const clean = toPrinterAscii(text);
	const indent = clean.match(/^ */)![0].slice(0, Math.max(0, columns - 1));
	const lines: string[] = [];
	let line = indent;
	for (const word of clean.slice(indent.length).split(' ')) {
		if (!word) continue;
		let rest = word;
		while (indent.length + rest.length > columns) {
			if (line !== indent) lines.push(line);
			const room = columns - indent.length;
			lines.push(indent + rest.slice(0, room));
			rest = rest.slice(room);
			line = indent;
		}
		if (!rest) continue;
		if (line === indent) line += rest;
		else if (line.length + 1 + rest.length <= columns) line += ` ${rest}`;
		else {
			lines.push(line);
			line = indent + rest;
		}
	}
	if (line !== indent || lines.length === 0) lines.push(line);
	return lines;
}

/** Isi dan urutan sama dengan buildReceiptLayout, disusun ulang untuk kolom font printer. */
export function buildReceiptTextBlocks(
	data: ReceiptData,
	paperSize: PaperSize = '58mm'
): ReceiptTextBlock[] {
	const columns = paperDots(paperSize) / ROM_CELL_WIDTH - 2 * TEXT_MARGIN.length;
	const blocks: ReceiptTextBlock[] = [{ type: 'logo' }, { type: 'feed', dots: LOGO_GAP }];
	const text = (
		value: string,
		bold = false,
		scale: 1 | 2 | 3 = 1,
		align: 'left' | 'center' | 'right' = 'left'
	) => {
		for (const line of wrapColumns(value, Math.floor(columns / scale)))
			blocks.push({ type: 'text', text: line, bold, scale, align });
	};
	const row = (left: string, right: string, bold = false, scale: 1 | 2 = 1) => {
		const width = Math.floor(columns / scale);
		const value = toPrinterAscii(right);
		if (value.length > width - 4) {
			text(left, bold, scale);
			text(value, bold, scale, 'right');
			return;
		}
		const lines = wrapColumns(left, width - value.length - 1);
		blocks.push({
			type: 'text',
			text: lines[0].padEnd(width - value.length) + value,
			bold,
			scale,
			align: 'left'
		});
		for (const line of lines.slice(1))
			blocks.push({ type: 'text', text: line, bold, scale, align: 'left' });
	};
	const divider = () => text('-'.repeat(columns));

	text(data.storeName.toUpperCase(), true, 2, 'center');
	if (data.address) text(data.address, false, 1, 'center');
	if (data.instagram) text(data.instagram, false, 1, 'center');
	if (data.phone) text(data.phone, false, 1, 'center');
	divider();
	if (data.reprint) text('*** CETAK ULANG ***', true, 1, 'center');

	const nomor = formatNomorHarian(data.nomorHarian);
	text('NOMOR PESANAN', false, 1, 'center');
	if (nomor) text(nomor, true, 3, 'center');
	else text(data.queuedOffline ? 'Menunggu sinkronisasi' : 'Belum tersedia', true, 1, 'center');
	text(data.customerName || 'Pelanggan', true);
	text(data.dateTime);
	if (data.queuedOffline) text('STATUS: MENUNGGU SINKRONISASI', true);
	divider();

	for (const item of data.items) {
		row(`${item.name} x${item.qty}`, `Rp${formatRupiah(item.price)}`, true);
		if (item.qty > 1 && item.unitPrice !== undefined) text(`  @Rp${formatRupiah(item.unitPrice)}`);
		for (const addOn of item.addOns ?? [])
			row(`  + ${addOn.name}`, `Rp${formatRupiah(addOn.price)}`);
		if (item.details) text(`  ${item.details}`);
	}
	divider();

	row('TOTAL', `Rp${formatRupiah(data.total)}`, true, 2);
	const method = data.paymentMethod.toLowerCase();
	row('Metode', METHOD_LABELS[method] || data.paymentMethod);
	if (method === 'tunai') {
		if (data.cashReceived !== undefined) row('Dibayar', `Rp${formatRupiah(data.cashReceived)}`);
		if (data.change !== undefined) row('Kembalian', `Rp${formatRupiah(data.change)}`);
		if (data.reprint && (data.cashReceived === undefined || data.change === undefined))
			text('Data uang diterima atau kembalian: Tidak tersimpan', true);
	}
	divider();

	if (data.historyWarning) text(data.historyWarning, true);
	if (data.footerMessage) text(data.footerMessage, false, 1, 'center');
	return blocks;
}

export interface RomChar {
	code: number;
	bold: boolean;
	scaleX: number;
	scaleY: number;
}

export interface TextRun {
	text: string;
	scale: 1 | 2 | 3;
}

/**
 * Isi satu baris sebagai potongan berukuran: spasi margin selalu ukuran normal agar jaraknya
 * tetap 12 titik, juga pada baris yang diperbesar. Baris tengah tidak butuh margin.
 */
export function textBlockRuns(block: Extract<ReceiptTextBlock, { type: 'text' }>): TextRun[] {
	const content: TextRun = { text: block.text, scale: block.scale };
	const margin: TextRun = { text: TEXT_MARGIN, scale: 1 };
	if (block.align === 'left') return [margin, content];
	if (block.align === 'right') return [content, margin];
	return [content];
}

/**
 * Baris titik untuk satu baris teks, persis seperti printer membakarnya: huruf diperbesar dengan
 * mengulang titik, rata bawah, dan lebar baris diratakan menurut ESC a. Dipakai pratinjau dan simulator.
 */
export function renderRomLine(
	chars: RomChar[],
	align: 'left' | 'center' | 'right',
	lineDots: number,
	glyph: RomGlyph
): Uint8Array[] {
	const height = Math.max(ROM_CELL_HEIGHT, ...chars.map((c) => ROM_CELL_HEIGHT * c.scaleY));
	const width = chars.reduce((sum, c) => sum + ROM_CELL_WIDTH * c.scaleX, 0);
	const rows = Array.from({ length: height }, () => new Uint8Array(lineDots / 8));
	let x =
		align === 'center'
			? Math.floor(Math.max(0, lineDots - width) / 2)
			: align === 'right'
				? Math.max(0, lineDots - width)
				: 0;
	for (const c of chars) {
		const bits = glyph(c.code, c.bold);
		const top = height - ROM_CELL_HEIGHT * c.scaleY;
		for (let gy = 0; gy < ROM_CELL_HEIGHT; gy++)
			for (let gx = 0; gx < ROM_CELL_WIDTH; gx++) {
				if (!(bits[gy * 2 + (gx >> 3)] & (0x80 >> (gx & 7)))) continue;
				for (let sy = 0; sy < c.scaleY; sy++)
					for (let sx = 0; sx < c.scaleX; sx++) {
						const px = x + gx * c.scaleX + sx;
						if (px < lineDots) rows[top + gy * c.scaleY + sy][px >> 3] |= 0x80 >> (px & 7);
					}
			}
		x += ROM_CELL_WIDTH * c.scaleX;
	}
	return rows;
}

/** Gambar seluruh struk mode teks, untuk pratinjau dan acuan simulator. */
export function rasterizeReceiptText(
	blocks: ReceiptTextBlock[],
	logo: ReceiptBitmap,
	paperSize: PaperSize,
	glyph: RomGlyph
): ReceiptBitmap {
	const width = paperDots(paperSize);
	const bytesPerRow = width / 8;
	const rows: Uint8Array[] = [];
	for (const block of blocks) {
		if (block.type === 'logo') {
			const logoBytes = logo.width / 8;
			for (let r = 0; r < logo.height; r++) {
				const row = new Uint8Array(bytesPerRow);
				row.set(logo.bytes.subarray(r * logoBytes, (r + 1) * logoBytes));
				rows.push(row);
			}
		} else if (block.type === 'feed') {
			for (let i = 0; i < block.dots; i++) rows.push(new Uint8Array(bytesPerRow));
		} else {
			const chars = textBlockRuns(block).flatMap((run) =>
				Array.from(run.text, (character) => ({
					code: character.charCodeAt(0),
					bold: block.bold,
					scaleX: run.scale,
					scaleY: run.scale
				}))
			);
			rows.push(...renderRomLine(chars, block.align, width, glyph));
			for (let i = 0; i < TEXT_LINE_GAP; i++) rows.push(new Uint8Array(bytesPerRow));
		}
	}
	const bytes = new Uint8Array(bytesPerRow * rows.length);
	rows.forEach((row, i) => bytes.set(row, i * bytesPerRow));
	return { width, height: rows.length, bytes };
}

/** Isi struk sebagai teks biasa, untuk dibaca pembaca layar di halaman pratinjau. */
export function receiptTextContent(blocks: ReceiptTextBlock[]): string[] {
	return blocks.flatMap((block) => (block.type === 'text' ? [block.text.trim()] : []));
}
