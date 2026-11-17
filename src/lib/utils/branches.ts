// Peta label cabang kanonik tunggal.
// Dipakai semua permukaan yang menampilkan nama cabang agar konsisten
// dengan sesi terautentikasi, bukan tebakan UI. Unknown -> null
// (pemanggil tampilkan placeholder netral, jangan nama cabang salah).
const BRANCH_LABELS = {
	samarinda: 'Samarinda',
	berau: 'Berau',
	balikpapan: 'Balikpapan'
} as const;

export function branchLabel(branch: unknown): string | null {
	const key = String(branch ?? '')
		.trim()
		.toLowerCase();
	return (BRANCH_LABELS as Record<string, string>)[key] ?? null;
}
