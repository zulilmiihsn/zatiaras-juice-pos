// KENAPA: normalisasi tampilan satu kata (catatan POS) dipakai di lebih dari satu
// tempat; satu kanonik mencegah varian kapitalisasi berbeda.
export function capitalizeFirst(value: string): string {
	if (!value) return '';
	return value.charAt(0).toUpperCase() + value.slice(1);
}
