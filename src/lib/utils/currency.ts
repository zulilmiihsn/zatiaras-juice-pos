/**
 * Utilitas untuk memformat mata uang (Rupiah) dan parsing angka.
 * Menerapkan prinsip DRY dan KISS.
 */

/**
 * Mengubah angka/string menjadi format ribuan Rupiah (contoh: 1.000.000)
 */
export function formatRupiah(value: number | string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '';

	const num = typeof value === 'string' ? parseRupiah(value) : value;
	if (isNaN(num)) return '';

	return num.toLocaleString('id-ID');
}

/**
 * Mengubah string format ribuan kembali menjadi angka (contoh: "1.000.000" -> 1000000)
 * KHUSUS UANG (bilangan bulat). Untuk jumlah/pecahan pakai parseQuantityInput.
 */
export function parseRupiah(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === '') return 0;
	if (typeof value === 'number') return value;

	const raw = String(value).replace(/[^\d-]/g, '');
	const parsed = parseInt(raw, 10);
	return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parser jumlah desimal Indonesia (R01): "0,5" -> 0.5, "1.000,5" -> 1000.5,
 * "1.000" -> 1000, "0.5" -> 0.5, "0.125" -> 0.125. parseRupiah() salah untuk
 * pecahan (0,5 -> 5) dan hanya untuk UANG bulat.
 *
 * Aturan eksplisit bila satu pemisah:
 * - koma tunggal -> selalu desimal ("0,5", "1.000,5" via aturan terakhir).
 * - dua pemisah -> yang TERAKHIR desimal.
 * - titik tunggal -> ribuan hanya bila tepat 3 digit sesudahnya DAN bagian
 *   bulat tak berawalan nol ("1.000", "10.000"); selain itu desimal
 *   ("0.5", "0.125", "12.34").
 */
export function parseQuantityInput(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === '') return 0;
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

	let s = String(value).trim().replace(/\s+/g, '');
	if (!s) return 0;
	const neg = s.startsWith('-');
	s = s.replace(/[^0-9.,]/g, '');
	if (!s) return 0;
	const commas = (s.match(/,/g) || []).length;
	const dots = (s.match(/\./g) || []).length;
	let dec: ',' | '.' | null = null;
	if (commas > 0 && dots > 0) {
		dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
	} else if (commas > 1) {
		dec = null;
	} else if (commas === 1) {
		// Koma tunggal: desimal ("0,5"), kecuali pola ribuan AS ("1,000",
		// tak berawalan nol) yang ditoleransi seperti aturan titik.
		const [cint, cfrac = ''] = s.split(',');
		dec = /^\d{3}$/.test(cfrac) && /^[1-9]\d*$/.test(cint) ? null : ',';
	} else if (dots > 1) {
		dec = null;
	} else if (dots === 1) {
		const [int, frac = ''] = s.split('.');
		dec = /^\d{3}$/.test(frac) && /^[1-9]\d*$/.test(int) ? null : '.';
	}
	let int = dec ? s.slice(0, s.lastIndexOf(dec)) : s;
	const frac = dec ? s.slice(s.lastIndexOf(dec) + 1).replace(/[^\d]/g, '') : '';
	int = int.replace(/[.,]/g, '');
	if (!int && !frac) return 0;
	const out = Number(`${neg ? '-' : ''}${int || '0'}${frac ? '.' + frac : ''}`);
	return Number.isFinite(out) ? out : 0;
}

/**
 * Sanitasi draft ketikan jumlah: pertahankan keadaan sementara ("0,", "0.",
 * pemisah terakhir) tanpa memaksa format numerik. Normalisasi/format hanya
 * pada blur atau commit. Hanya karakter jumlah yang lolos.
 */
export function sanitizeQuantityDraft(value: string): string {
	let s = String(value ?? '');
	const neg = /^\s*-/.test(s);
	s = s.replace(/[^0-9.,]/g, '');
	if (neg && !s.startsWith('-')) s = `-${s}`;
	return s;
}

/** Format jumlah desimal id-ID dengan pecahan terjaga (0.5 -> "0,5"). */
export function formatQuantityInput(value: number | string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '';
	const num = typeof value === 'string' ? parseQuantityInput(value) : value;
	if (typeof num !== 'number' || isNaN(num)) return '';
	return num.toLocaleString('id-ID', { maximumFractionDigits: 4 });
}

/**
 * Helper untuk input event. Format string secara otomatis menjadi ribuan.
 * Cocok digunakan di oninput={handleRupiahInput(formObj, 'field')}
 */
export function handleRupiahInput<T extends Record<string, unknown>>(obj: T, field: keyof T) {
	return (e: Event) => {
		const target = e.target as HTMLInputElement;
		const raw = target.value.replace(/[^\d]/g, '');
		const targetObj = obj as Record<keyof T, unknown>;

		if (raw) {
			targetObj[field] = parseInt(raw, 10).toLocaleString('id-ID');
		} else {
			targetObj[field] = '';
		}
	};
}

/**
 * Helper input jumlah desimal (R01): oninput HANYA sanitasi (draft "0,"
 * dipertahankan); format rapi pada blur via formatQuantityField.
 */
export function handleQuantityInput<T extends Record<string, unknown>>(obj: T, field: keyof T) {
	return (e: Event) => {
		const target = e.target as HTMLInputElement;
		(obj as Record<keyof T, unknown>)[field] = sanitizeQuantityDraft(target.value);
	};
}

/** Format field jumlah pada blur (kosong tetap kosong). */
export function formatQuantityField<T extends Record<string, unknown>>(obj: T, field: keyof T) {
	const targetObj = obj as Record<keyof T, unknown>;
	const raw = String(targetObj[field] ?? '').trim();
	if (!raw) {
		targetObj[field] = '';
		return;
	}
	targetObj[field] = formatQuantityInput(parseQuantityInput(raw));
}
