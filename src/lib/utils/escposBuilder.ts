/**
 * ESC/POS Binary Command Builder
 * Standar generator byte binary untuk printer thermal kasir (58mm / 80mm).
 * Zero-dependency murni TypeScript (Uint8Array).
 */
import { ROM_CELL_HEIGHT, TEXT_LINE_GAP, type ReceiptTextBlock } from './receiptText.js';

export interface ReceiptBitmap {
	width: number;
	height: number;
	bytes: Uint8Array;
}

/** Blank gaps of at least 1 mm are fed instead of sent as image rows. */
const MIN_FEED_ROWS = 8;

export class EscPosBuilder {
	private buffer: number[] = [];

	constructor() {
		this.init();
	}

	/** Inisialisasi / Reset printer */
	init(): this {
		this.buffer.push(0x1b, 0x40); // ESC @
		return this;
	}

	/** Alignment: 'left' | 'center' | 'right' */
	align(alignment: 'left' | 'center' | 'right'): this {
		const val = alignment === 'center' ? 1 : alignment === 'right' ? 2 : 0;
		this.buffer.push(0x1b, 0x61, val); // ESC a n
		return this;
	}

	/** Tambah baris kosong */
	feed(lines: number = 1): this {
		for (let i = 0; i < lines; i++) {
			this.buffer.push(0x0a);
		}
		return this;
	}

	/** ESC E: huruf tebal (double strike pada printer mini). */
	bold(on: boolean): this {
		this.buffer.push(0x1b, 0x45, on ? 1 : 0);
		return this;
	}

	/** GS !: perbesar huruf sama lebar dan tinggi, 1–8×. */
	scale(times: number): this {
		if (!Number.isInteger(times) || times < 1 || times > 8)
			throw new Error('Ukuran huruf struk tidak valid.');
		this.buffer.push(0x1d, 0x21, (times - 1) * 0x11);
		return this;
	}

	/** Teks ASCII cetak; byte kontrol tidak boleh lolos menjadi perintah printer. */
	text(value: string): this {
		for (let i = 0; i < value.length; i++) {
			const code = value.charCodeAt(i);
			if (code < 0x20 || code > 0x7e) throw new Error('Teks struk berisi karakter tidak dikenal.');
			this.buffer.push(code);
		}
		return this;
	}

	/** Raster bands stay small enough for the input buffers of common thermal printers. */
	raster(bitmap: ReceiptBitmap): this {
		const bytesPerRow = bitmap.width / 8;
		if (
			!Number.isInteger(bytesPerRow) ||
			bitmap.width < 8 ||
			bitmap.width > 576 ||
			!Number.isInteger(bitmap.height) ||
			bitmap.height < 1 ||
			bitmap.height > 16_384 ||
			bitmap.bytes.length !== bytesPerRow * bitmap.height
		)
			throw new Error('Gambar struk tidak valid.');
		// blankRun[r] counts the blank rows starting at r, so every row is scanned once.
		const blankRun = new Uint16Array(bitmap.height + 1);
		for (let r = bitmap.height - 1; r >= 0; r--) {
			const blank = bitmap.bytes
				.subarray(r * bytesPerRow, (r + 1) * bytesPerRow)
				.every((byte) => byte === 0);
			blankRun[r] = blank ? blankRun[r + 1] + 1 : 0;
		}
		let row = 0;
		while (row < bitmap.height) {
			// A short gap costs more in feed/raster switching than in bytes, so it stays in the image.
			if (blankRun[row] >= MIN_FEED_ROWS) {
				this.feedDots(blankRun[row]);
				row += blankRun[row];
				continue;
			}
			// The band ends at the next gap long enough to be fed, or at 128 rows.
			let end = row + 1;
			while (end < bitmap.height && end - row < 128 && blankRun[end] < MIN_FEED_ROWS) end++;
			const rows = end - row;
			this.buffer.push(
				0x1d,
				0x76,
				0x30,
				0,
				bytesPerRow & 0xff,
				bytesPerRow >> 8,
				rows & 0xff,
				rows >> 8
			);
			for (const byte of bitmap.bytes.subarray(row * bytesPerRow, end * bytesPerRow))
				this.buffer.push(byte);
			row = end;
		}
		return this;
	}

	/**
	 * ESC J prints the pending text line and moves the paper n dots from that line's top
	 * (1/203 inch on 203 dpi thermal heads); 255 is the most one command moves.
	 */
	feedDots(dots: number): this {
		for (let left = dots; left > 0; left -= 255) this.buffer.push(0x1b, 0x4a, Math.min(left, 255));
		return this;
	}

	/** Perintah potong kertas otomatis (Auto Cut) + feed */
	cut(): this {
		this.feed(3);
		this.buffer.push(0x1d, 0x56, 0x41, 0x10); // GS V 65 16 (Full cut with feed)
		return this;
	}

	/** Dapatkan Uint8Array binary lengkap */
	toBytes(): Uint8Array {
		return new Uint8Array(this.buffer);
	}
}

/** Helper untuk menyusun data struk transaksi kasir menjadi ESC/POS bytes */
export function buildReceiptEscPos(bitmap: ReceiptBitmap): Uint8Array {
	const builder = new EscPosBuilder();
	builder.align('left').raster(bitmap);
	// Potong Kertas
	builder.cut();
	return builder.toBytes();
}

/** Struk mode teks: logo sebagai gambar kecil, isi dengan font printer, jarak baris lewat ESC J. */
export function buildReceiptTextEscPos(
	blocks: ReceiptTextBlock[],
	logo: ReceiptBitmap
): Uint8Array {
	const builder = new EscPosBuilder();
	for (const block of blocks) {
		if (block.type === 'logo') builder.align('left').raster(logo);
		else if (block.type === 'feed') builder.feedDots(block.dots);
		else
			builder
				.align(block.align)
				.bold(block.bold)
				.scale(block.scale)
				.text(block.text)
				.feedDots(ROM_CELL_HEIGHT * block.scale + TEXT_LINE_GAP);
	}
	builder.bold(false).scale(1).align('left').cut();
	return builder.toBytes();
}
