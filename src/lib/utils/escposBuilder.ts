/**
 * ESC/POS Binary Command Builder
 * Standar generator byte binary untuk printer thermal kasir (58mm / 80mm).
 * Zero-dependency murni TypeScript (Uint8Array).
 */

export interface EscPosOptions {
	paperSize?: '58mm' | '80mm';
}

export class EscPosBuilder {
	private buffer: number[] = [];
	private encoder = new TextEncoder();
	public readonly lineWidth: number;

	constructor(options: EscPosOptions = {}) {
		this.lineWidth = options.paperSize === '80mm' ? 48 : 32;
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

	/** Bold on / off */
	bold(enable: boolean = true): this {
		this.buffer.push(0x1b, 0x45, enable ? 1 : 0); // ESC E n
		return this;
	}

	/** Ukuran font: 'normal' | 'double-height' | 'double-width' | 'double-both' */
	size(size: 'normal' | 'double-height' | 'double-width' | 'double-both' = 'normal'): this {
		let val = 0x00;
		if (size === 'double-height') val = 0x01;
		else if (size === 'double-width') val = 0x10;
		else if (size === 'double-both') val = 0x11;
		this.buffer.push(0x1d, 0x21, val); // GS ! n
		return this;
	}

	/** Tambah teks murni (tanpa newline) */
	text(str: string): this {
		if (!str) return this;
		const bytes = this.encoder.encode(str);
		for (let i = 0; i < bytes.length; i++) {
			this.buffer.push(bytes[i]);
		}
		return this;
	}

	/** Tambah satu baris teks + newline */
	line(str: string = ''): this {
		this.text(str);
		this.buffer.push(0x0a); // LF
		return this;
	}

	/** Tambah baris kosong */
	feed(lines: number = 1): this {
		for (let i = 0; i < lines; i++) {
			this.buffer.push(0x0a);
		}
		return this;
	}

	/** Garis pemisah putus-putus atau solid */
	divider(char: string = '-'): this {
		const line = char.repeat(this.lineWidth);
		this.line(line);
		return this;
	}

	/**
	 * Cetak baris dua kolom (Kiri rata kiri, Kanan rata kanan).
	 * Sangat cocok untuk daftar item kasir (misal: "Jus Mangga x2" di kiri, "Rp20.000" di kanan).
	 */
	twoColumn(left: string, right: string): this {
		const leftLen = left.length;
		const rightLen = right.length;
		const spaceNeeded = this.lineWidth - (leftLen + rightLen);

		if (spaceNeeded >= 0) {
			this.line(left + ' '.repeat(spaceNeeded) + right);
		} else {
			// Jika teks kiri terlalu panjang, potong atau bungkus
			const maxLeft = Math.max(1, this.lineWidth - rightLen - 1);
			const truncatedLeft = left.slice(0, maxLeft);
			const remainingLeft = left.slice(maxLeft);
			this.line(truncatedLeft + ' ' + right);
			if (remainingLeft) {
				this.line(remainingLeft);
			}
		}
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
export function buildReceiptEscPos(
	data: {
		storeName: string;
		address?: string;
		phone?: string;
		instagram?: string;
		customerName?: string;
		dateTime?: string;
		items: Array<{
			name: string;
			qty: number;
			price: number;
			addOns?: Array<{ name: string; price: number }>;
			details?: string;
		}>;
		total: number;
		paymentMethod: string;
		cashReceived?: number;
		change?: number;
		footerMessage?: string;
		queuedOffline?: boolean;
	},
	options: EscPosOptions = {}
): Uint8Array {
	const builder = new EscPosBuilder(options);

	// Header Toko
	builder.align('center').bold(true).size('double-both');
	builder.line(data.storeName.toUpperCase());
	builder.bold(false).size('normal');

	if (data.address) builder.line(data.address);
	const contact = [data.instagram, data.phone].filter(Boolean).join(' | ');
	if (contact) builder.line(contact);

	builder.divider('-');

	// Info Pelanggan & Waktu
	builder.align('left');
	const customer = data.customerName || 'Pelanggan';
	const dateStr = data.dateTime || new Date().toLocaleString('id-ID');
	builder.twoColumn(customer, dateStr);

	if (data.queuedOffline) {
		builder.bold(true).line('STATUS: MENUNGGU SINKRONISASI').bold(false);
	}

	builder.divider('-');

	// Daftar Item Belanja
	for (const item of data.items) {
		const itemLeft = `${item.name} x${item.qty}`;
		const itemRight = `Rp${item.price.toLocaleString('id-ID')}`;
		builder.bold(true).twoColumn(itemLeft, itemRight).bold(false);

		if (item.addOns && item.addOns.length > 0) {
			for (const addOn of item.addOns) {
				builder.twoColumn(`  + ${addOn.name}`, `Rp${addOn.price.toLocaleString('id-ID')}`);
			}
		}

		if (item.details) {
			builder.line(`  (${item.details})`);
		}
	}

	builder.divider('-');

	// Total Pembayaran
	builder.bold(true).twoColumn('TOTAL', `Rp${data.total.toLocaleString('id-ID')}`);
	builder.bold(false);

	builder.twoColumn('Metode', data.paymentMethod.toUpperCase());
	if (data.paymentMethod.toLowerCase() === 'tunai' && data.cashReceived !== undefined) {
		builder.twoColumn('Dibayar', `Rp${data.cashReceived.toLocaleString('id-ID')}`);
		builder.twoColumn('Kembalian', `Rp${(data.change ?? 0).toLocaleString('id-ID')}`);
	}

	builder.divider('-');

	// Ucapan Footer
	if (data.footerMessage) {
		builder.align('center');
		const lines = data.footerMessage.split('\n');
		for (const l of lines) {
			if (l.trim()) builder.line(l.trim());
		}
	}

	// Potong Kertas
	builder.cut();

	return builder.toBytes();
}
