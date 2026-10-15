/**
 * Helper bersama untuk payload tulis dari klien: hanya kolom yang diizinkan yang diteruskan
 * ke DB (mencegah mass assignment kolom milik server), dan angka dibaca tanpa diam-diam
 * menjadi NaN.
 */

export function pickColumns(
	row: Record<string, unknown>,
	columns: readonly string[]
): Record<string, unknown> {
	const picked: Record<string, unknown> = {};
	for (const column of columns) if (Object.hasOwn(row, column)) picked[column] = row[column];
	return picked;
}

/** Angka finite dari number atau string angka; selain itu null (bukan NaN, bukan 0 diam-diam). */
export function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
