/**
 * Validasi batas tulis ledger manual (`buku_kas` non-POS).
 *
 * Seluruh nominal/deskrimininasi invalid DITOLAK dengan 400 — tidak pernah
 * dikoersi menjadi 0 (laporan menganggap string invalid sebagai 0 adalah
 * bug baca; menambalnya dengan fallback 0 hanya memindahkan korupsi ke tulis).
 * Desimal rupiah dibulatkan ke integer via Math.round sebelum simpan.
 *
 * Tidak import SvelteKit. Route memetakan LedgerValidationError ke kitError.
 */

export class LedgerValidationError extends Error {
	readonly status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = 'LedgerValidationError';
		this.status = status;
	}
}

export const MANUAL_LEDGER_TIPE = ['in', 'out'] as const;
export const MANUAL_LEDGER_JENIS = ['pendapatan_usaha', 'beban_usaha', 'lainnya'] as const;
/** Sumber tulis manual yang sah lewat route. `pos` ditolak terpisah (409). */
export const MANUAL_LEDGER_SUMBER = ['catat', 'stok'] as const;
export const MANUAL_LEDGER_METODE = ['tunai', 'non-tunai', 'qris'] as const;

export type ManualLedgerRow = Record<string, unknown>;

function fail(message: string): never {
	throw new LedgerValidationError(message, 400);
}

function asRecord(row: unknown): ManualLedgerRow {
	if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Payload baris kas tidak valid');
	return row as ManualLedgerRow;
}

/** Nominal rupiah: finite, >= 0, dalam rentang aman; desimal dibulatkan. */
export function validateLedgerNominal(value: unknown): number {
	const amount = Number(value);
	if (value === null || value === undefined || value === '' || !Number.isFinite(amount))
		fail('Nominal harus angka yang valid');
	if (amount < 0) fail('Nominal tidak boleh negatif');
	if (amount > Number.MAX_SAFE_INTEGER) fail('Nominal melebihi batas aman');
	return Math.round(amount);
}

export function validateLedgerTipe(value: unknown): 'in' | 'out' {
	if (value === 'in' || value === 'out') return value;
	fail("Tipe harus 'in' atau 'out'");
}

export function validateLedgerJenis(value: unknown): (typeof MANUAL_LEDGER_JENIS)[number] {
	if (value === 'pendapatan_usaha' || value === 'beban_usaha' || value === 'lainnya') return value;
	fail('Jenis harus pendapatan_usaha, beban_usaha, atau lainnya');
}

function checkJenisPairing(tipe: 'in' | 'out', jenis: (typeof MANUAL_LEDGER_JENIS)[number]) {
	const ok =
		(tipe === 'in' && (jenis === 'pendapatan_usaha' || jenis === 'lainnya')) ||
		(tipe === 'out' && (jenis === 'beban_usaha' || jenis === 'lainnya'));
	if (!ok) fail(`Jenis ${jenis} tidak cocok untuk tipe ${tipe}`);
}

export function validateLedgerSumber(value: unknown): (typeof MANUAL_LEDGER_SUMBER)[number] {
	if (value === 'catat' || value === 'stok') return value;
	fail('Sumber harus catat atau stok');
}

export function validateLedgerWaktu(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') fail('Waktu transaksi wajib diisi');
	if (!Number.isFinite(Date.parse(value))) fail('Waktu transaksi tidak valid');
	return value;
}

/** Metode dinormalisasi kanonik: qris -> non-tunai (sama seperti checkout). */
export function validateLedgerMetode(value: unknown): 'tunai' | 'non-tunai' {
	if (value === 'tunai') return 'tunai';
	if (value === 'non-tunai' || value === 'qris') return 'non-tunai';
	fail('Metode bayar harus tunai atau non-tunai');
}

export function validateLedgerDeskripsi(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') fail('Deskripsi wajib diisi');
	return value;
}

/**
 * Validasi seluruh batch SEBELUM tulis apa pun. Mengembalikan baris
 * ternormalisasi (nominal integer, metode kanonik). Melempar pada baris
 * invalid pertama — caller tidak boleh menulis sebagian.
 */
export function validateManualLedgerRows(rows: unknown): ManualLedgerRow[] {
	if (!Array.isArray(rows) || rows.length === 0) fail('Payload baris kas tidak valid');
	return (rows as unknown[]).map((raw) => {
		const row = asRecord(raw);
		const tipe = validateLedgerTipe(row.tipe);
		const jenis = validateLedgerJenis(row.jenis);
		checkJenisPairing(tipe, jenis);
		return {
			...row,
			nominal: validateLedgerNominal(row.nominal),
			tipe,
			jenis,
			sumber: validateLedgerSumber(row.sumber),
			waktu: validateLedgerWaktu(row.waktu),
			metode_bayar: validateLedgerMetode(row.metode_bayar),
			deskripsi: validateLedgerDeskripsi(row.deskripsi)
		};
	});
}

/**
 * Validasi field parsial untuk PATCH manual. `existing` adalah nilai kolom
 * kini (untuk cek pairing bila hanya salah satu tipe/jenis diubah).
 */
export function validateManualLedgerPatch(
	payload: ManualLedgerRow,
	existing: { tipe?: unknown; jenis?: unknown }
): ManualLedgerRow {
	const out: ManualLedgerRow = { ...payload };
	if ('nominal' in payload) out.nominal = validateLedgerNominal(payload.nominal);
	let tipe = existing.tipe;
	let jenis = existing.jenis;
	if ('tipe' in payload) {
		tipe = validateLedgerTipe(payload.tipe);
		out.tipe = tipe;
	}
	if ('jenis' in payload) {
		jenis = validateLedgerJenis(payload.jenis);
		out.jenis = jenis;
	}
	if ('tipe' in payload || 'jenis' in payload) {
		checkJenisPairing(
			tipe === 'in' || tipe === 'out' ? tipe : fail('Tipe kini tidak valid'),
			jenis === 'pendapatan_usaha' || jenis === 'beban_usaha' || jenis === 'lainnya'
				? jenis
				: fail('Jenis kini tidak valid')
		);
	}
	if ('sumber' in payload) out.sumber = validateLedgerSumber(payload.sumber);
	if ('waktu' in payload) out.waktu = validateLedgerWaktu(payload.waktu);
	if ('metode_bayar' in payload) out.metode_bayar = validateLedgerMetode(payload.metode_bayar);
	if ('deskripsi' in payload) out.deskripsi = validateLedgerDeskripsi(payload.deskripsi);
	return out;
}
