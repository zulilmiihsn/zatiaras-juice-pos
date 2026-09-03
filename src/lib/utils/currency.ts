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
 */
export function parseRupiah(value: string | number | null | undefined): number {
	if (value === null || value === undefined || value === '') return 0;
	if (typeof value === 'number') return value;

	const raw = String(value).replace(/[^\d-]/g, '');
	const parsed = parseInt(raw, 10);
	return isNaN(parsed) ? 0 : parsed;
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
