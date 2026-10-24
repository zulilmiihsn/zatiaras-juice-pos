/**
 * ESC/POS Binary Command Builder
 * Standar generator byte binary untuk printer thermal kasir (58mm / 80mm).
 * Zero-dependency murni TypeScript (Uint8Array).
 */
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

	/** Raster bands stay small enough for the input buffers of common thermal printers. */
	raster(bitmap: ReceiptBitmap): this {
		const bytesPerRow = bitmap.width / 8;
		if (
			![384, 576].includes(bitmap.width) ||
			!Number.isInteger(bitmap.height) ||
			bitmap.height < 1 ||
			bitmap.height > 16_384 ||
			bitmap.bytes.length !== bytesPerRow * bitmap.height
		)
			throw new Error('Gambar struk tidak valid.');
		const isBlank = (row: number) =>
			bitmap.bytes.subarray(row * bytesPerRow, (row + 1) * bytesPerRow).every((byte) => byte === 0);
		let row = 0;
		while (row < bitmap.height) {
			if (isBlank(row)) {
				let end = row;
				while (end < bitmap.height && isBlank(end)) end++;
				// A short gap costs more in feed/raster switching than in bytes, so it stays in the image.
				if (end - row >= MIN_FEED_ROWS) {
					this.feedDots(end - row);
					row = end;
					continue;
				}
			}
			// The band ends at the next gap long enough to be fed, or at 128 rows.
			let end = row;
			while (end < bitmap.height && end - row < 128) {
				if (isBlank(end)) {
					let gapEnd = end;
					while (gapEnd < bitmap.height && gapEnd - end < MIN_FEED_ROWS && isBlank(gapEnd))
						gapEnd++;
					if (gapEnd - end >= MIN_FEED_ROWS) break;
					end = gapEnd;
				} else end++;
			}
			end = Math.min(end, row + 128);
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

	/** ESC J feeds n dots (1/203 inch on 203 dpi thermal heads); 255 is the most one command moves. */
	private feedDots(dots: number): void {
		for (let left = dots; left > 0; left -= 255) this.buffer.push(0x1b, 0x4a, Math.min(left, 255));
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
