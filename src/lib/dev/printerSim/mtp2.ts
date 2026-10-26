/**
 * Virtual MTP-II: a 58 mm, 203 dpi direct-thermal printer fed by a byte stream.
 *
 * The model keeps the physical order of a real unit: bytes land in a finite input buffer,
 * the firmware parses ESC/POS only as far as the bytes allow, and the head burns one dot row
 * at a time at paper speed. Every number that is not in a published datasheet is marked
 * "asumsi" in MTP2_ASSUMPTIONS so the page never presents a guess as a measurement.
 */

import {
	renderRomLine,
	ROM_CELL_HEIGHT,
	ROM_CELL_WIDTH,
	type RomChar,
	type RomGlyph
} from '../../utils/receiptText.js';

export const DOTS_PER_LINE = 384;
export const BYTES_PER_LINE = DOTS_PER_LINE / 8;
export const DOTS_PER_MM = 8;

export interface Mtp2Config {
	/** Paper speed in mm/s. Listings give 50–80. */
	speedMmS: number;
	/** Input buffer in bytes (asumsi). */
	bufferBytes: number;
	/** Default ESC/POS line spacing in dots (asumsi). */
	lineSpacingDots: number;
	/** Distance from the head to the tear bar in mm (asumsi). */
	headToTearMm: number;
	/** Paper left on the roll in mm. */
	paperMm: number;
	/** Battery charge, 0–100. */
	batteryPct: number;
}

export const DEFAULT_MTP2_CONFIG: Mtp2Config = {
	speedMmS: 60,
	bufferBytes: 4096,
	lineSpacingDots: 30,
	headToTearMm: 10,
	paperMm: 12_000,
	batteryPct: 80
};

export const MTP2_ASSUMPTIONS: Array<{ name: string; value: string; basis: string }> = [
	{ name: 'Resolusi', value: '203 dpi, 384 dot/baris', basis: 'listing penjual (konsisten)' },
	{ name: 'Kecepatan', value: '50–80 mm/s', basis: 'listing penjual' },
	{ name: 'Buffer masukan', value: 'bawaan 4 KB', basis: 'asumsi, tidak ada di datasheet' },
	{ name: 'Jarak baris LF', value: '30 dot (3,75 mm)', basis: 'asumsi, umum di printer mini' },
	{ name: 'Kepala ke gigi sobek', value: '10 mm', basis: 'asumsi, ukur unit asli' },
	{
		name: 'Baris padat melambat',
		value: '>96 titik/baris hingga 2× lebih lambat',
		basis: 'asumsi'
	},
	{ name: 'Pudar baterai', value: 'mulai terlihat di bawah ±35%', basis: 'asumsi' },
	{ name: 'Mati baterai', value: '≤3%', basis: 'asumsi' },
	{ name: 'Pemotong kertas', value: 'tidak ada', basis: 'spesifikasi (gigi sobek manual)' }
];

export type Mtp2Status = 'idle' | 'printing' | 'starved' | 'paper-out' | 'overheat' | 'off';

export interface PaperRow {
	/** 48 bytes of burned dots, or null for a fed (blank) row. */
	bits: Uint8Array | null;
	/** 0–1 darkness the head could deliver on this row. */
	darkness: number;
	/** The motor stopped and restarted on this row; real paper shows a faint band here. */
	restart: boolean;
}

export type Mtp2Event =
	| { kind: 'command'; at: number; name: string; detail?: string }
	| { kind: 'warning'; at: number; message: string }
	| { kind: 'error'; at: number; message: string };

export interface Mtp2Job {
	startedAt: number;
	firstRow: number;
	bytesReceived: number;
	bytesDropped: number;
	commands: Map<string, number>;
	events: Mtp2Event[];
	stalls: number;
	resets: number;
	lastByteAt: number;
	lastRowAt: number | null;
	finishedAt: number | null;
}

type ParseState =
	| { mode: 'command' }
	| { mode: 'raster'; bytesPerRow: number; rowsLeft: number }
	| { mode: 'feed'; dotsLeft: number }
	| { mode: 'text'; rows: Uint8Array[]; next: number; feedAfter: number };

interface TextStyle {
	bold: boolean;
	scaleX: number;
	scaleY: number;
	align: 'left' | 'center' | 'right';
}

const RESET_STYLE: TextStyle = { bold: false, scaleX: 1, scaleY: 1, align: 'left' };

/**
 * Stand-in ROM font for Node tests: every character gets its own fixed dot pattern, so a wrong,
 * missing, or shifted character shows up as mismatched rows. The page swaps in romGlyph.
 */
export const patternGlyph: RomGlyph = (code, bold) => {
	const bits = new Uint8Array(ROM_CELL_HEIGHT * 2);
	if (code === 0x20) return bits;
	for (let y = 2; y < ROM_CELL_HEIGHT - 2; y++) {
		let row = ((code * 2654435761 + y * 40503) >>> 20) & 0x7fe0;
		if (bold) row |= row >> 1;
		bits[y * 2] = (row >> 8) & 0xff;
		bits[y * 2 + 1] = row & 0xf0;
	}
	return bits;
};

/** A blank feed moves the motor without heating; a fixed row time keeps it simple. */
function rowTimeMs(speedMmS: number, darkDots: number): number {
	const base = 1000 / (speedMmS * DOTS_PER_MM);
	// The head heats in strobe groups; dense rows need more strobes (asumsi).
	const slow = darkDots <= 96 ? 1 : 1 + (darkDots - 96) / (DOTS_PER_LINE - 96);
	return base * slow;
}

function countDots(row: Uint8Array): number {
	let n = 0;
	for (const byte of row) {
		let b = byte;
		while (b) {
			n += b & 1;
			b >>= 1;
		}
	}
	return n;
}

export class VirtualMtp2 {
	config: Mtp2Config;
	readonly rows: PaperRow[] = [];
	/** Index of the first row still attached to the roll (rows before it were torn off). */
	tornAt = 0;
	status: Mtp2Status = 'idle';
	headTempC = 25;
	job: Mtp2Job | null = null;
	readonly jobs: Mtp2Job[] = [];

	private buffer: Uint8Array;
	private head = 0;
	private count = 0;
	private parse: ParseState = { mode: 'command' };
	private budgetMs = 0;
	private stalledSince: number | null = null;
	private waiters: Array<() => void> = [];
	private listeners = new Set<() => void>();
	/** Font ROM: pola tetap di Node, perkiraan font browser di halaman simulator. */
	glyph: RomGlyph = patternGlyph;
	private style: TextStyle = { ...RESET_STYLE };
	private lineChars: RomChar[] = [];
	private lineAlign: TextStyle['align'] = 'left';

	constructor(config: Partial<Mtp2Config> = {}) {
		this.config = { ...DEFAULT_MTP2_CONFIG, ...config };
		this.buffer = new Uint8Array(this.config.bufferBytes);
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	get bufferUsed(): number {
		return this.count;
	}

	get bufferFree(): number {
		return this.buffer.length - this.count;
	}

	reconfigure(config: Partial<Mtp2Config>): void {
		const next = { ...this.config, ...config };
		if (next.bufferBytes !== this.buffer.length) {
			const data = this.drainAll();
			this.buffer = new Uint8Array(next.bufferBytes);
			this.head = this.count = 0;
			this.write(data.subarray(0, next.bufferBytes));
		}
		this.config = next;
		if (this.status === 'off' && next.batteryPct > 3) this.status = 'idle';
		if (this.status === 'paper-out' && next.paperMm > 0) this.status = 'idle';
		this.emit();
	}

	private drainAll(): Uint8Array {
		const out = new Uint8Array(this.count);
		for (let i = 0; i < this.count; i++) out[i] = this.buffer[(this.head + i) % this.buffer.length];
		return out;
	}

	private write(data: Uint8Array): void {
		const size = this.buffer.length;
		for (const byte of data) {
			this.buffer[(this.head + this.count) % size] = byte;
			this.count++;
		}
	}

	private beginJob(now: number): Mtp2Job {
		if (this.job && this.job.finishedAt === null) return this.job;
		const job: Mtp2Job = {
			startedAt: now,
			firstRow: this.rows.length,
			bytesReceived: 0,
			bytesDropped: 0,
			commands: new Map(),
			events: [],
			stalls: 0,
			resets: 0,
			lastByteAt: now,
			lastRowAt: null,
			finishedAt: null
		};
		this.job = job;
		this.jobs.push(job);
		return job;
	}

	private log(event: Mtp2Event): void {
		this.job?.events.push(event);
	}

	/**
	 * Link without flow control (BLE write-without-response): whatever does not fit is lost,
	 * exactly like a UART FIFO behind a BLE module.
	 */
	receiveDropping(data: Uint8Array, now: number): number {
		if (this.status === 'off') return 0;
		const job = this.beginJob(now);
		job.bytesReceived += data.length;
		job.lastByteAt = now;
		const accepted = Math.min(this.bufferFree, data.length);
		this.write(data.subarray(0, accepted));
		if (accepted < data.length) {
			job.bytesDropped += data.length - accepted;
			this.log({
				kind: 'error',
				at: now,
				message: `Buffer penuh: ${data.length - accepted} byte hilang pada byte ke-${job.bytesReceived - data.length + accepted}`
			});
		}
		this.emit();
		return accepted;
	}

	/** Link with flow control (USB bulk NAK, RFCOMM credits): the sender waits for space. */
	async receiveBlocking(data: Uint8Array, clock: () => number): Promise<void> {
		let offset = 0;
		while (offset < data.length) {
			if (this.status === 'off') throw new Error('Printer mati.');
			if (this.bufferFree === 0) {
				await new Promise<void>((resolve) => this.waiters.push(resolve));
				continue;
			}
			const now = clock();
			const job = this.beginJob(now);
			const take = Math.min(this.bufferFree, data.length - offset);
			this.write(data.subarray(offset, offset + take));
			job.bytesReceived += take;
			job.lastByteAt = now;
			offset += take;
			this.emit();
		}
	}

	private peek(i: number): number {
		return this.buffer[(this.head + i) % this.buffer.length];
	}

	private consume(n: number): void {
		this.head = (this.head + n) % this.buffer.length;
		this.count -= n;
		if (n > 0 && this.waiters.length) {
			const waiters = this.waiters.splice(0);
			for (const resolve of waiters) resolve();
		}
	}

	private take(n: number): Uint8Array {
		const out = new Uint8Array(n);
		for (let i = 0; i < n; i++) out[i] = this.peek(i);
		this.consume(n);
		return out;
	}

	private command(name: string, now: number, detail?: string): void {
		if (!this.job) return;
		this.job.commands.set(name, (this.job.commands.get(name) ?? 0) + 1);
		this.log({ kind: 'command', at: now, name, ...(detail ? { detail } : {}) });
	}

	/**
	 * Prints the pending text line and moves the paper `dots` from the line's top, the way LF,
	 * ESC J, and ESC d do; a line taller than the move pushes the paper by its own height.
	 */
	private printLine(dots: number, now: number): void {
		if (this.lineChars.length === 0) {
			if (dots > 0) this.parse = { mode: 'feed', dotsLeft: dots };
			return;
		}
		const chars = this.lineChars;
		this.lineChars = [];
		const width = chars.reduce((sum, c) => sum + ROM_CELL_WIDTH * c.scaleX, 0);
		this.command('teks', now, `"${String.fromCharCode(...chars.map((c) => c.code))}"`);
		if (width > DOTS_PER_LINE)
			this.log({
				kind: 'error',
				at: now,
				message: `Baris teks ${width} dot lebih lebar dari kepala ${DOTS_PER_LINE} dot; sisi kanan terpotong`
			});
		const rows = renderRomLine(chars, this.lineAlign, DOTS_PER_LINE, this.glyph);
		this.parse = { mode: 'text', rows, next: 0, feedAfter: Math.max(0, dots - rows.length) };
	}

	/** Parses one command if its bytes are all present. Returns false when it must wait. */
	private parseCommand(now: number): boolean {
		if (this.count === 0) return false;
		const b0 = this.peek(0);
		if (b0 === 0x0a) {
			this.consume(1);
			this.command('LF', now);
			this.printLine(this.config.lineSpacingDots, now);
			return true;
		}
		if (b0 === 0x1b) {
			if (this.count < 2) return false;
			const b1 = this.peek(1);
			if (b1 === 0x40) {
				this.consume(2);
				this.command('ESC @', now, 'reset printer');
				this.style = { ...RESET_STYLE };
				this.lineChars = [];
				return true;
			}
			if (b1 === 0x45) {
				if (this.count < 3) return false;
				const n = this.peek(2);
				this.consume(3);
				this.style.bold = (n & 1) === 1;
				this.command('ESC E', now, this.style.bold ? 'tebal' : 'normal');
				return true;
			}
			if (b1 === 0x32) {
				this.consume(2);
				this.command('ESC 2', now);
				return true;
			}
			if (b1 === 0x61 || b1 === 0x4a || b1 === 0x64 || b1 === 0x33 || b1 === 0x21) {
				if (this.count < 3) return false;
				const n = this.peek(2);
				this.consume(3);
				if (b1 === 0x61) {
					this.command('ESC a', now, ['kiri', 'tengah', 'kanan'][n] ?? `n=${n}`);
					const align = (['left', 'center', 'right'] as const)[n % 48];
					if (align) this.style.align = align;
				} else if (b1 === 0x4a) {
					this.command('ESC J', now, `${n} dot`);
					this.printLine(n, now);
				} else if (b1 === 0x64) {
					this.command('ESC d', now, `${n} baris`);
					this.printLine(n * this.config.lineSpacingDots, now);
				} else this.command(b1 === 0x33 ? 'ESC 3' : 'ESC !', now, `n=${n}`);
				return true;
			}
		}
		if (b0 === 0x1d) {
			if (this.count < 2) return false;
			const b1 = this.peek(1);
			if (b1 === 0x21) {
				if (this.count < 3) return false;
				const n = this.peek(2);
				this.consume(3);
				this.style.scaleX = ((n >> 4) & 7) + 1;
				this.style.scaleY = (n & 7) + 1;
				this.command('GS !', now, `${this.style.scaleX}×${this.style.scaleY}`);
				return true;
			}
			if (b1 === 0x76) {
				if (this.count < 8) return false;
				const header = this.take(8);
				const bytesPerRow = header[4] | (header[5] << 8);
				const rows = header[6] | (header[7] << 8);
				this.command('GS v 0', now, `${bytesPerRow * 8}×${rows} dot`);
				if (header[2] !== 0x30 || header[3] !== 0)
					this.log({
						kind: 'warning',
						at: now,
						message: `GS v ${header[2]} m=${header[3]}: mode skala raster tidak dijamin didukung MTP-II`
					});
				if (bytesPerRow > BYTES_PER_LINE)
					this.log({
						kind: 'error',
						at: now,
						message: `Gambar ${bytesPerRow * 8} dot lebih lebar dari kepala ${DOTS_PER_LINE} dot; sisi kanan terpotong`
					});
				if (rows > 0 && bytesPerRow > 0)
					this.parse = { mode: 'raster', bytesPerRow, rowsLeft: rows };
				return true;
			}
			if (b1 === 0x56) {
				if (this.count < 3) return false;
				const m = this.peek(2);
				const length = m === 65 || m === 66 ? 4 : 3;
				if (this.count < length) return false;
				this.consume(length);
				this.command('GS V', now, 'diabaikan: MTP-II tidak punya pemotong');
				return true;
			}
		}
		if (b0 === 0x10 && this.count >= 3 && this.peek(1) === 0x04) {
			this.consume(3);
			this.command('DLE EOT', now, 'status realtime');
			return true;
		}
		this.consume(1);
		if (b0 >= 0x20 && b0 < 0x7f) {
			// ESC a only takes effect at the start of a line, as on Epson-compatible firmware.
			if (this.lineChars.length === 0) this.lineAlign = this.style.align;
			const { bold, scaleX, scaleY } = this.style;
			this.lineChars.push({ code: b0, bold, scaleX, scaleY });
		} else {
			this.command('tidak dikenal', now);
			this.log({
				kind: 'error',
				at: now,
				message: `Byte 0x${b0.toString(16).padStart(2, '0')} bukan perintah yang dikenal MTP-II`
			});
		}
		return true;
	}

	private darkness(dots: number): number {
		const pct = this.config.batteryPct;
		// 2S Li-ion pack, roughly 6.6 V empty to 8.4 V full (asumsi).
		const energy = Math.min(1, Math.max(0, (pct - 3) / 32));
		const demand = 0.55 + 0.45 * (dots / DOTS_PER_LINE);
		const heat = this.headTempC > 55 ? 1 - (this.headTempC - 55) / 40 : 1;
		return Math.max(0.08, Math.min(1, (0.35 + 0.65 * energy) / demand) * heat);
	}

	private pushRow(bits: Uint8Array | null, now: number): number {
		const dots = bits ? countDots(bits) : 0;
		if (this.job) this.job.lastRowAt = now;
		this.rows.push({ bits, darkness: bits ? this.darkness(dots) : 1, restart: false });
		this.config.paperMm = Math.max(0, this.config.paperMm - 1 / DOTS_PER_MM);
		this.config.batteryPct = Math.max(0, this.config.batteryPct - dots * 1e-6 - 2e-6);
		// Solid black reaches the 65 °C cut-off after roughly 10 cm (asumsi).
		this.headTempC += dots * 1.3e-4;
		if (this.config.paperMm === 0) {
			this.status = 'paper-out';
			this.log({
				kind: 'error',
				at: now,
				message: 'Kertas habis: printer berhenti, lampu berkedip'
			});
		}
		if (this.config.batteryPct <= 3) {
			this.status = 'off';
			this.head = this.count = 0;
			this.parse = { mode: 'command' };
			if (this.job) this.job.resets++;
			this.log({
				kind: 'error',
				at: now,
				message: 'Baterai habis: printer mati, isi buffer hilang'
			});
		}
		return rowTimeMs(this.config.speedMmS, dots);
	}

	/** Advances the printer by dtMs of wall time. */
	tick(dtMs: number, now: number): void {
		this.headTempC = Math.max(25, this.headTempC - (this.headTempC - 25) * dtMs * 1e-4);
		if (this.status === 'off' || this.status === 'paper-out') {
			this.budgetMs = 0;
			this.finishIfIdle(now);
			this.emit();
			return;
		}
		if (this.status === 'overheat') {
			if (this.headTempC > 55) return this.emit();
			this.status = 'idle';
		} else if (this.headTempC > 65) {
			this.status = 'overheat';
			this.log({ kind: 'warning', at: now, message: 'Kepala terlalu panas: printer jeda' });
			return this.emit();
		}
		this.budgetMs = Math.min(this.budgetMs + dtMs, 250);
		let moved = false;
		while (this.budgetMs > 0) {
			const parse = this.parse;
			if (parse.mode === 'feed') {
				this.budgetMs -= this.pushRow(null, now);
				moved = true;
				if (--parse.dotsLeft <= 0) this.parse = { mode: 'command' };
			} else if (parse.mode === 'text') {
				const row = parse.rows[parse.next++];
				this.budgetMs -= this.pushRow(row.some((byte) => byte !== 0) ? row : null, now);
				moved = true;
				if (parse.next >= parse.rows.length)
					this.parse =
						parse.feedAfter > 0 ? { mode: 'feed', dotsLeft: parse.feedAfter } : { mode: 'command' };
			} else if (parse.mode === 'raster') {
				if (this.count < parse.bytesPerRow) break;
				const raw = this.take(parse.bytesPerRow);
				const row = new Uint8Array(BYTES_PER_LINE);
				row.set(raw.subarray(0, BYTES_PER_LINE));
				this.budgetMs -= this.pushRow(row, now);
				moved = true;
				if (--parse.rowsLeft <= 0) this.parse = { mode: 'command' };
			} else if (!this.parseCommand(now)) break;
			if ((this.status as Mtp2Status) === 'paper-out' || (this.status as Mtp2Status) === 'off')
				break;
		}
		if ((this.status as Mtp2Status) === 'paper-out' || (this.status as Mtp2Status) === 'off') {
			// Keep the fault status; the job stays open until the paper or battery is fixed.
		} else if (moved) {
			// A stop longer than a few rows leaves a visible band where the motor restarted.
			if (this.stalledSince !== null && now - this.stalledSince > 40) {
				this.rows[this.rows.length - 1].restart = true;
				if (this.job) this.job.stalls++;
			}
			this.stalledSince = null;
			this.status = 'printing';
		} else {
			if (this.status === 'printing' && this.job?.finishedAt === null) this.stalledSince = now;
			const waitingMidImage = this.parse.mode === 'raster';
			this.status = waitingMidImage || this.count > 0 ? 'starved' : 'idle';
			this.budgetMs = 0;
		}
		this.finishIfIdle(now);
		this.emit();
	}

	private finishIfIdle(now: number): void {
		const job = this.job;
		if (!job || job.finishedAt !== null) return;
		const quiet = this.count === 0 && this.parse.mode === 'command';
		if ((quiet || this.status === 'off') && now - job.lastByteAt > 1500) {
			job.finishedAt = now;
			this.stalledSince = null;
		}
	}

	/** Rows the head has passed that are already above the tear bar. */
	get visibleRowEnd(): number {
		return Math.max(this.tornAt, this.rows.length - this.config.headToTearMm * DOTS_PER_MM);
	}

	/** Tears at the bar; returns the torn piece. */
	tear(): PaperRow[] {
		const end = this.visibleRowEnd;
		const piece = this.rows.slice(this.tornAt, end);
		this.tornAt = end;
		this.emit();
		return piece;
	}
}

export interface JobVerdict {
	matchedRows: number;
	mismatchedRows: number;
	firstMismatch: number | null;
	/** Receipt-relative rows that differ, capped for display. */
	mismatchRows: number[];
	fadedRows: number;
	restartRows: number;
	/** Rows of the receipt still inside the printer when tearing right after printing. */
	contentBelowTearRows: number;
}

/** Compares what the head burned with the bitmap the app meant to print. */
export function verifyJob(
	printer: VirtualMtp2,
	job: Mtp2Job,
	expected: { width: number; height: number; bytes: Uint8Array }
): JobVerdict {
	const bytesPerRow = expected.width / 8;
	let matched = 0;
	let mismatched = 0;
	let first: number | null = null;
	const mismatchRows: number[] = [];
	let faded = 0;
	let restart = 0;
	let lastInk = -1;
	for (let r = 0; r < expected.height; r++) {
		const row = printer.rows[job.firstRow + r];
		const want = expected.bytes.subarray(r * bytesPerRow, (r + 1) * bytesPerRow);
		const wantInk = want.some((b) => b !== 0);
		if (wantInk) lastInk = r;
		let ok = !!row;
		if (row) {
			for (let i = 0; i < BYTES_PER_LINE && ok; i++) {
				const want8 = i < want.length ? want[i] : 0;
				if ((row.bits?.[i] ?? 0) !== want8) ok = false;
			}
			if (row.bits && row.darkness < 0.6) faded++;
			if (row.restart) restart++;
		}
		if (ok) matched++;
		else {
			mismatched++;
			first ??= r;
			if (mismatchRows.length < 4000) mismatchRows.push(r);
		}
	}
	const jobEnd = printer.rows.length;
	const lastInkRow = job.firstRow + lastInk;
	const tearRow = jobEnd - printer.config.headToTearMm * DOTS_PER_MM;
	return {
		matchedRows: matched,
		mismatchedRows: mismatched,
		firstMismatch: first,
		mismatchRows,
		fadedRows: faded,
		restartRows: restart,
		contentBelowTearRows: lastInk < 0 ? 0 : Math.max(0, lastInkRow - tearRow + 1)
	};
}
