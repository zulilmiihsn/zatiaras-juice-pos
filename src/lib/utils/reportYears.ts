export const REPORT_YEAR_MIN = 2020;

/** Tahun WITA (Asia/Makassar) saat ini. Fallback tanggal lokal bila Intl gagal. */
export function getWitaYear(ref: Date = new Date()): number {
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Asia/Makassar',
			year: 'numeric'
		}).formatToParts(ref);
		const y = Number(parts.find((p) => p.type === 'year')?.value);
		if (Number.isInteger(y)) return y;
	} catch {}
	return ref.getFullYear();
}

/** Satu daftar tahun untuk semua selector: 2020..tahun WITA, termasuk tahun terpilih. */
export function getReportYears(selectedYear?: string | number | null, ref?: Date): string[] {
	const wita = getWitaYear(ref);
	const sel = Number(selectedYear);
	const max = Number.isInteger(sel) && sel > wita ? sel : wita;
	const out: string[] = [];
	for (let y = REPORT_YEAR_MIN; y <= max; y++) out.push(String(y));
	return out;
}
