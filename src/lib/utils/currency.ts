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
 * "1.000" -> 1000, "0.5" -> 0.5. Pemisah terakhir ,/. adalah desimal;
 * pemisah lain adalah ribuan. parseRupiah() salah untuk pecahan (0,5 -> 5).
 */
export function parseQuantityInput(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === '') return 0;
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

	let s = String(value).trim().replace(/\s+/g, '');
	if (!s) return 0;
	const neg = s.startsWith('-');
	s = s.replace(/[^0-9.,]/g, '');
	if (!s) return 0;
	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	let dec: ',' | '.' | null = null;
	if (lastComma > lastDot) {
		dec = ',';
	} else if (lastDot > lastComma) {
		const after = s.slice(lastDot + 1);
		// Titik ribuan ("1.000") vs desimal ("0.5"): ribuan bila 3 digit + digit sebelumnya.
		dec = /^\d{3}$/.test(after) && lastDot > 0 ? null : '.';
	}
	let int = dec ? s.slice(0, s.lastIndexOf(dec)) : s;
	const frac = dec ? s.slice(s.lastIndexOf(dec) + 1).replace(/[^\d]/g, '') : '';
	int = int.replace(/[.,]/g, '');
	if (!int && !frac) return 0;
	const out = Number(`${neg ? '-' : ''}${int || '0'}${frac ? '.' + frac : ''}`);
	return Number.isFinite(out) ? out : 0;
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
