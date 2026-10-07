// Peta label cabang kanonik tunggal (AUD-029).
// Dipakai semua permukaan yang menampilkan nama cabang agar konsisten
// dengan sesi terautentikasi, bukan tebakan UI. Unknown -> null
// (pemanggil tampilkan placeholder netral, jangan nama cabang salah).
const BRANCH_LABELS = {
	samarinda: 'Samarinda',
	berau: 'Berau',
	balikpapan: 'Balikpapan',
	samarinda2: 'Samarinda 2',
	balikpapan2: 'Balikpapan 2'
} as const;

export type BranchLabelId = keyof typeof BRANCH_LABELS;

export function branchLabel(branch: unknown): string | null {
	const key = String(branch ?? '')
		.trim()
		.toLowerCase();
	return (BRANCH_LABELS as Record<string, string>)[key] ?? null;
}
