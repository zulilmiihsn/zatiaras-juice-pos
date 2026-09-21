/**
 * Resolver periode + intent murni untuk fast-path AI (F27).
 * Periode eksplisit di-resolve DULU; shortcut intent tak boleh menimpanya.
 * Tak dikenali/ambigu -> null agar analyzer lanjutan dipakai.
 */

export interface AiPeriod {
	start: string;
	end: string;
	type: 'daily' | 'monthly';
}

const word = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
const includesWord = (q: string, w: string) => word(w).test(q);
const includesAnyWord = (q: string, words: string[]) => words.some((w) => includesWord(q, w));

function shiftDays(ymd: string, days: number): string {
	const d = new Date(`${ymd}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

function prevMonthRange(todayWita: string): AiPeriod {
	const cur = new Date(`${todayWita}T00:00:00.000Z`);
	const firstThis = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
	const lastPrev = new Date(firstThis.getTime() - 86400000);
	const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
	return {
		start: firstPrev.toISOString().slice(0, 10),
		end: lastPrev.toISOString().slice(0, 10),
		type: 'monthly'
	};
}

const MONTHS = [
	['januari', 'january', 1],
	['februari', 'february', 2],
	['maret', 'march', 3],
	['april', 'april', 4],
	['mei', 'may', 5],
	['juni', 'june', 6],
	['juli', 'july', 7],
	['agustus', 'august', 8],
	['september', 'september', 9],
	['oktober', 'october', 10],
	['november', 'november', 11],
	['desember', 'december', 12]
] as Array<[string, string, number]>;

function findMonth(question: string): number | null {
	for (const [id, en, n] of MONTHS) {
		if (includesWord(question, id) || includesWord(question, en)) return n;
	}
	return null;
}

function findYear(question: string): number | null {
	const m = question.match(/\b(20\d{2})\b/);
	return m ? Number(m[1]) : null;
}

function monthRange(year: number, month: number, todayWita: string): AiPeriod {
	const start = `${year}-${String(month).padStart(2, '0')}-01`;
	const lastDay = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 0))
		.toISOString()
		.slice(0, 10);
	const end = lastDay > todayWita ? todayWita : lastDay;
	return { start, end: end < start ? start : end, type: 'monthly' };
}

/** Tanggal eksplisit "15 Agustus 2026" (hari+bulan[+tahun]) -> satu hari, bukan sebulan.
 * Pola ada tetapi tanggal mustahil ("29 Februari 2025") -> 'invalid' agar
 * pemanggil menyerahkan ke analyzer, bukan melebar diam-diam ke sebulan. */
function findExplicitDay(question: string, todayWita: string): AiPeriod | 'invalid' | null {
	const thisYear = Number(todayWita.slice(0, 4));
	for (const [id, en] of MONTHS) {
		const m =
			question.match(new RegExp(`\\b(\\d{1,2})\\s+(?:${id}|${en})\\s*(20\\d{2})?`, 'i')) ??
			question.match(new RegExp(`\\b(?:${id}|${en})\\s+(\\d{1,2})\\s*,\\s*(20\\d{2})`, 'i')) ??
			question.match(new RegExp(`\\b(?:${id}|${en})\\s+(\\d{1,2})(?!\\d)`, 'i'));
		if (!m) continue;
		const day = Number(m[1]);
		const year = m[2] ? Number(m[2]) : (findYear(question) ?? thisYear);
		if (year > thisYear || year < 2020) return 'invalid';
		const dim = new Date(Date.UTC(year, monthNumber(id), 0)).getUTCDate();
		if (day < 1 || day > dim) return 'invalid';
		const ymd = `${year}-${String(monthNumber(id)).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		return { start: ymd, end: ymd, type: 'daily' };
	}
	return null;
}

function monthNumber(id: string): number {
	const hit = MONTHS.find(([name]) => name === id);
	return hit ? hit[2] : 1;
}

function monthEnd(year: number, month: number): string {
	return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 0))
		.toISOString()
		.slice(0, 10);
}

const RANGE_SEP = '(?:sampai|s/d|s\\.d\\.?|-|–)';

function monthNamePattern(): string {
	return MONTHS.map(([id, en]) => `${id}|${en}`).join('|');
}

/** "1 sampai 15 Agustus [2026]" -> rentang hari dalam sebulan. */
function findDayRange(question: string, todayWita: string): AiPeriod | 'invalid' | null {
	const thisYear = Number(todayWita.slice(0, 4));
	const m = question.match(
		new RegExp(
			`\\b(\\d{1,2})\\s*${RANGE_SEP}\\s*(\\d{1,2})\\s+(${monthNamePattern()})\\s*(20\\d{2})?`,
			'i'
		)
	);
	if (!m) return null;
	const month = monthNumberByName(m[3]);
	if (month === null) return null;
	const year = m[4] ? Number(m[4]) : (findYear(question) ?? thisYear);
	if (year > thisYear || year < 2020) return 'invalid';
	const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const d1 = Number(m[1]);
	const d2 = Number(m[2]);
	if (d1 < 1 || d2 < 1 || d1 > dim || d2 > dim || d1 > d2) return 'invalid';
	const pad = (n: number) => String(n).padStart(2, '0');
	const start = `${year}-${pad(month)}-${pad(d1)}`;
	if (start > todayWita) return 'invalid';
	const rawEnd = `${year}-${pad(month)}-${pad(d2)}`;
	const end = rawEnd > todayWita ? todayWita : rawEnd;
	return { start, end: end < start ? start : end, type: 'daily' };
}

function monthNumberByName(name: string): number | null {
	const lower = name.toLowerCase();
	for (const [id, en, n] of MONTHS) {
		if (lower === id || lower === en) return n;
	}
	return null;
}

/** "Agustus sampai September [2026]" -> awal bulan1 s/d akhir bulan2 (setahun). */
function findMonthRange(question: string, todayWita: string): AiPeriod | 'invalid' | null {
	const thisYear = Number(todayWita.slice(0, 4));
	const m = question.match(
		new RegExp(
			`\\b(${monthNamePattern()})\\s*${RANGE_SEP}\\s*(${monthNamePattern()})\\s*(20\\d{2})?`,
			'i'
		)
	);
	if (!m) return null;
	const m1 = monthNumberByName(m[1]);
	const m2 = monthNumberByName(m[2]);
	if (m1 === null || m2 === null) return null;
	const year = m[3] ? Number(m[3]) : (findYear(question) ?? thisYear);
	if (year > thisYear || year < 2020 || m2 < m1) return 'invalid';
	const pad = (n: number) => String(n).padStart(2, '0');
	const start = `${year}-${pad(m1)}-01`;
	if (start > todayWita) return 'invalid';
	const end = monthEnd(year, m2);
	return { start, end: end > todayWita ? todayWita : end, type: 'monthly' };
}

/** Periode eksplisit; null bila tak ada qualifier tanggal yang dikenali. */
export function resolveAiPeriod(question: string, todayWita: string): AiPeriod | null {
	let q = question.toLowerCase();
	const monthStart = `${todayWita.slice(0, 7)}-01`;
	const thisYear = Number(todayWita.slice(0, 4));
	const monthMentions = [...q.matchAll(new RegExp(`\\b(${monthNamePattern()})\\b`, 'gi'))];
	const years = [...q.matchAll(/\b20\d{2}\b/g)];
	const relativeYears = [...q.matchAll(/\btahun (lalu|ini)\b/g)];
	// A comparison needs multiple periods; do not silently turn it into one aggregate.
	if (/\b(bandingkan|dibandingkan|perbandingan|versus|vs)\b/.test(q)) return null;
	if (years.length > 1 || relativeYears.length > 1) return null;
	if (
		monthMentions.length &&
		/\b(bulan (lalu|kemarin|ini)|kemarin|hari ini|minggu|pekan)\b/.test(q)
	)
		return null;
	if (relativeYears.length) {
		const year = relativeYears[0][1] === 'lalu' ? thisYear - 1 : thisYear;
		if (years.length && Number(years[0][0]) !== year) return null;
		if (!monthMentions.length) {
			// Day/week/numeric-date qualifiers must not be swallowed by a full-year result.
			if (
				/\b(tanggal|bulan|hari|minggu|pekan|kemarin|kuartal|semester|triwulan)\b|\d{1,2}[/-]\d{1,2}/.test(
					q
				)
			)
				return null;
			return {
				start: `${year}-01-01`,
				end: year === thisYear ? todayWita : `${year}-12-31`,
				type: 'monthly'
			};
		}
		q = q.replace(/\btahun (lalu|ini)\b/, '').trim();
		if (!years.length) q += ` ${year}`;
	}
	// Rentang didahulukan: "1 sampai 15 Agustus" bukan "15 Agustus" saja.
	const dayRange = monthMentions.length === 1 ? findDayRange(q, todayWita) : null;
	if (dayRange === 'invalid') return null;
	if (dayRange) return dayRange;
	const monthRangeValue = monthMentions.length === 2 ? findMonthRange(q, todayWita) : null;
	if (monthRangeValue === 'invalid') return null;
	if (monthRangeValue) {
		// A day-qualified endpoint is not a whole-month range ("15 Juli sampai Agustus").
		if (findExplicitDay(q, todayWita) !== null) return null;
		return monthRangeValue;
	}
	// Unsupported lists or cross-month day ranges belong to the existing analyzer.
	if (monthMentions.length > 1 || /\b(sampai|hingga|s\/d|s\.d)\b|\d\s*[-–]\s*\d/.test(q))
		return null;
	const explicitDay = findExplicitDay(q, todayWita);
	if (explicitDay === 'invalid') return null;
	if (explicitDay) return explicitDay;
	const namedMonth = findMonth(q);
	if (namedMonth !== null) {
		const explicitYear = findYear(q);
		const y = explicitYear ?? thisYear;
		if (y > thisYear || y < 2020) return null;
		// Bulan depan tanpa tahun eksplisit = ambigu, serahkan ke analyzer.
		if (explicitYear === null && y === thisYear && namedMonth > Number(todayWita.slice(5, 7)))
			return null;
		return monthRange(y, namedMonth, todayWita);
	}
	if (q.includes('bulan lalu') || q.includes('bulan kemarin')) return prevMonthRange(todayWita);
	if (q.includes('bulan ini')) return { start: monthStart, end: todayWita, type: 'monthly' };
	if (q.includes('kemarin')) {
		const y = shiftDays(todayWita, -1);
		return { start: y, end: y, type: 'daily' };
	}
	if (includesWord(q, 'hari ini')) return { start: todayWita, end: todayWita, type: 'daily' };
	if (q.includes('7 hari') || q.includes('seminggu terakhir') || q.includes('1 minggu')) {
		return { start: shiftDays(todayWita, -6), end: todayWita, type: 'daily' };
	}
	return null;
}

export function hasPeriodQualifier(question: string): boolean {
	const q = question.toLowerCase();
	if (
		q.includes('bulan lalu') ||
		q.includes('bulan kemarin') ||
		q.includes('bulan ini') ||
		q.includes('kemarin') ||
		includesWord(q, 'hari ini') ||
		q.includes('7 hari') ||
		q.includes('seminggu terakhir') ||
		q.includes('1 minggu') ||
		q.includes('tahun lalu') ||
		q.includes('tahun ini') ||
		q.includes('minggu lalu') ||
		q.includes('pekan lalu') ||
		q.includes('kemarin lusa') ||
		q.includes('kuartal') ||
		q.includes('triwulan') ||
		q.includes('semester') ||
		findMonth(q) !== null ||
		findYear(q) !== null ||
		/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(q)
	)
		return true;
	return false;
}

export interface AiIntent {
	jenisData: string[];
	prioritas: string;
	scope: string;
	reasoning: string;
}

/** Intent tanpa periode; null bila tak dikenali. Kata pendek pakai batas kata. */
export function detectAiIntent(question: string): AiIntent | null {
	const q = question.toLowerCase();
	if (
		q.includes('performa penjualan') ||
		q.includes('penjualan toko hari ini') ||
		q.includes('omzet hari ini') ||
		q.includes('bagaimana performa')
	)
		return {
			jenisData: ['buku_kas', 'transaksi_kasir', 'payment_analysis'],
			prioritas: 'sales_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis performa penjualan hari ini'
		};
	if (
		includesAnyWord(q, ['terlaris', 'laris']) ||
		q.includes('paling laris') ||
		q.includes('banyak terjual') ||
		q.includes('produk terlaris') ||
		q.includes('menu terlaris')
	)
		return {
			jenisData: ['produk_terlaris', 'transaksi_kasir', 'produk'],
			prioritas: 'product_analysis',
			scope: 'product_performance',
			reasoning: 'Shortcut Heuristik: Analisis produk terlaris'
		};
	if (includesAnyWord(q, ['keuntungan bersih', 'laba kotor', 'laba bersih', 'profit']))
		return {
			jenisData: ['buku_kas', 'financial_summary'],
			prioritas: 'financial_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis laba dan keuangan'
		};
	if (
		q.includes('tren penjualan') ||
		q.includes('seminggu terakhir') ||
		q.includes('7 hari') ||
		q.includes('1 minggu')
	)
		return {
			jenisData: ['buku_kas', 'daily_trends', 'payment_analysis'],
			prioritas: 'trend_analysis',
			scope: 'trend_analysis',
			reasoning: 'Shortcut Heuristik: Analisis tren seminggu terakhir'
		};
	if (
		includesAnyWord(q, ['stok', 'bahan', 'restok', 'persediaan']) ||
		q.includes('sisa buah') ||
		q.includes('buah habis') ||
		q.includes('ambang stok')
	)
		return {
			jenisData: ['stok_bahan', 'produk'],
			prioritas: 'inventory_analysis',
			scope: 'inventory_management',
			reasoning: 'Shortcut Heuristik: Evaluasi stok bahan baku dan peringatan restok'
		};
	if (
		includesWord(q, 'hpp') ||
		includesWord(q, 'margin') ||
		q.includes('modal produk') ||
		q.includes('paling untung') ||
		q.includes('margin terbesar') ||
		q.includes('margin tipis') ||
		q.includes('keuntungan per cup')
	)
		return {
			jenisData: ['hpp_margin', 'transaksi_kasir', 'financial_summary'],
			prioritas: 'margin_analysis',
			scope: 'margin_optimization',
			reasoning: 'Shortcut Heuristik: Analisis HPP dan margin keuntungan produk'
		};
	if (
		includesWord(q, 'gula') ||
		q.includes('less sugar') ||
		q.includes('level gula') ||
		includesWord(q, 'selera') ||
		includesWord(q, 'kustomisasi') ||
		(/\bes\b/.test(q) &&
			(q.includes('level') || q.includes('konsumen') || q.includes('preferensi')))
	)
		return {
			jenisData: ['customer_behavior', 'transaksi_kasir'],
			prioritas: 'customer_analysis',
			scope: 'customer_insights',
			reasoning: 'Shortcut Heuristik: Analisis preferensi kustomisasi pelanggan (gula & es)'
		};
	if (
		includesWord(q, 'shift') ||
		q.includes('sesi kasir') ||
		q.includes('sesi toko') ||
		q.includes('buka toko') ||
		q.includes('tutup toko')
	)
		return {
			jenisData: ['shift_analysis', 'buku_kas'],
			prioritas: 'shift_analysis',
			scope: 'operational_efficiency',
			reasoning: 'Shortcut Heuristik: Analisis performa shift dan sesi toko'
		};
	if (
		includesAnyWord(q, [
			'strategi',
			'marketing',
			'saran',
			'rekomendasi',
			'tips',
			'bantu',
			'ide',
			'solusi',
			'maju',
			'laris',
			'ramai',
			'sepi',
			'sukses',
			'promosi',
			'bundling',
			'evaluasi',
			'kembangkan',
			'tingkatkan'
		]) ||
		q.includes('riset') ||
		q.includes('viral') ||
		q.includes('kompetitor') ||
		q.includes('pesaing')
	)
		return {
			jenisData: [
				'produk_terlaris',
				'transaksi_kasir',
				'financial_summary',
				'hpp_margin',
				'stok_bahan'
			],
			prioritas: 'strategic_consulting',
			scope: 'market_analysis',
			reasoning: 'Shortcut Heuristik: Konsultasi strategi bisnis FnB dan pertumbuhan toko'
		};
	return null;
}
