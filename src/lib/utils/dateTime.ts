/**
 * DateTime utilities untuk konversi UTC dan WITA
 * STANDAR: Semua waktu disimpan dalam UTC, ditampilkan dalam WITA (+08:00)
 */

// [CATATAN]: Konversi UTC ke waktu WITA (Asia/Makassar)
export function utcToWita(dateStr: string | Date): Date {
	const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
	// [CATATAN]: toLocaleString dengan timeZone Asia/Makassar
	const witaString = date.toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
	return new Date(witaString);
}

// [CATATAN]: Konversi waktu lokal WITA ke UTC (Date object)
export function witaToUtc(dateStr: string): Date {
	// [CATATAN]: dateStr: 'YYYY-MM-DDTHH:mm:ss' (anggap input sudah waktu lokal WITA)
	// [CATATAN]: Buat Date di Asia/Makassar, lalu konversi ke UTC
	const [datePart, timePart] = dateStr.split('T');
	const [year, month, day] = datePart.split('-').map(Number);
	const [hour, minute, second] = timePart.split(':').map(Number);
	// [CATATAN]: Buat Date di Asia/Makassar
	const witaDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
	return witaDate;
}

// [CATATAN]: STANDAR: Dapatkan tanggal hari ini dalam WITA (YYYY-MM-DD)
export function getTodayWita(): string {
	const now = new Date();
	const witaString = now.toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
	const witaDate = new Date(witaString);
	const year = witaDate.getFullYear();
	const month = String(witaDate.getMonth() + 1).padStart(2, '0');
	const day = String(witaDate.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function parseYmd(dateStr: string): { year: number; month: number; day: number } {
	const [year, month, day] = dateStr.split('-').map(Number);
	if (!year || !month || !day) throw new Error(`Invalid date: ${dateStr}`);
	return { year, month, day };
}

function formatUtcYmd(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function addDaysYmd(dateStr: string, days: number): string {
	const { year, month, day } = parseYmd(dateStr);
	return formatUtcYmd(new Date(Date.UTC(year, month - 1, day + days)));
}

export function getLastDaysYmdWita(days: number): string[] {
	const today = getTodayWita();
	const total = Math.max(1, Math.floor(days));
	return Array.from({ length: total }, (_, index) => addDaysYmd(today, index - total + 1));
}

export function getMonthEndYmd(monthStr: string): string {
	const [year, month] = monthStr.split('-').map(Number);
	if (!year || !month) throw new Error(`Invalid month: ${monthStr}`);
	return formatUtcYmd(new Date(Date.UTC(year, month, 0)));
}

export function formatDateYmdWita(date: string | Date): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(
		typeof date === 'string' ? new Date(date) : date
	);
}

// [CATATAN]: STANDAR: Dapatkan waktu sekarang dalam WITA (YYYY-MM-DDTHH:mm:ss)
export function getNowWita(): string {
	const now = new Date();
	const witaString = now.toLocaleString('en-US', { timeZone: 'Asia/Makassar' });
	const witaDate = new Date(witaString);
	const year = witaDate.getFullYear();
	const month = String(witaDate.getMonth() + 1).padStart(2, '0');
	const day = String(witaDate.getDate()).padStart(2, '0');
	const hours = String(witaDate.getHours()).padStart(2, '0');
	const minutes = String(witaDate.getMinutes()).padStart(2, '0');
	const seconds = String(witaDate.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

// [CATATAN]: STANDAR: Konversi tanggal WITA ke UTC range untuk query database
export function witaToUtcRange(dateStr: string): { startUtc: string; endUtc: string } {
	// [CATATAN]: Input: 'YYYY-MM-DD' (tanggal WITA)
	// [CATATAN]: Output: { startUtc: 'YYYY-MM-DDTHH:mm:ss.sssZ', endUtc: 'YYYY-MM-DDTHH:mm:ss.sssZ' }

	// [CATATAN]: Validasi input
	if (!dateStr || typeof dateStr !== 'string') {
		throw new Error('Invalid date string');
	}
	const parts = dateStr.split('-');
	if (parts.length !== 3) {
		throw new Error('Invalid date format. Expected YYYY-MM-DD');
	}
	const [year, month, day] = parts.map(Number);

	// [CATATAN]: Validasi nilai tanggal
	if (isNaN(year) || isNaN(month) || isNaN(day)) {
		throw new Error('Invalid date values');
	}
	if (year < 1900 || year > 2100) {
		throw new Error('Year out of valid range');
	}
	if (month < 1 || month > 12) {
		throw new Error('Month out of valid range');
	}
	if (day < 1 || day > 31) {
		throw new Error('Day out of valid range');
	}

	try {
		// [CATATAN]: Start: 00:00:00 WITA = 16:00:00 UTC hari sebelumnya
		const startUtc = new Date(Date.UTC(year, month - 1, day - 1, 16, 0, 0));
		// [CATATAN]: End: 23:59:59.999 WITA = 15:59:59.999 UTC hari berikutnya
		const endUtc = new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999));

		return {
			startUtc: startUtc.toISOString(),
			endUtc: endUtc.toISOString()
		};
	} catch (error) {
		throw new Error(`Failed to convert date: ${dateStr}`);
	}
}

// [CATATAN]: STANDAR: Konversi range tanggal WITA ke UTC range untuk query database
export function witaRangeToUtcRange(
	startDate: string,
	endDate: string
): { startUtc: string; endUtc: string } {
	// [CATATAN]: Input: 'YYYY-MM-DD', 'YYYY-MM-DD' (range tanggal WITA)
	// [CATATAN]: Output: { startUtc: 'YYYY-MM-DDTHH:mm:ss.sssZ', endUtc: 'YYYY-MM-DDTHH:mm:ss.sssZ' }

	try {
		// [CATATAN]: Start: 00:00:00 WITA tanggal pertama
		const startDateObj = new Date(startDate + 'T00:00:00+08:00');
		// [CATATAN]: End: 23:59:59.999 WITA tanggal terakhir
		const endDateObj = new Date(endDate + 'T23:59:59.999+08:00');

		return {
			startUtc: startDateObj.toISOString(),
			endUtc: endDateObj.toISOString()
		};
	} catch (error) {
		throw new Error(`Failed to convert date range: ${startDate} to ${endDate}`);
	}
}

// [CATATAN]: Format UTC ke string waktu WITA untuk tampilan
export function formatWitaDateTime(dateStr: string | Date, opts?: Intl.DateTimeFormatOptions) {
	const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
	return date.toLocaleString('id-ID', { timeZone: 'Asia/Makassar', ...(opts || {}) });
}

// [CATATAN]: Konversi waktu WITA (YYYY-MM-DDTHH:mm:ss) ke UTC ISO string
export function witaToUtcISO(dateStr: string, timeStr: string = '00:00:00'): string {
	const [year, month, day] = dateStr.split('-').map(Number);
	const [hour, minute, second] = timeStr.split(':').map(Number);
	// [CATATAN]: WITA = UTC+8, jadi UTC = WITA-8
	const utcDate = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second || 0));
	return utcDate.toISOString();
}

// [CATATAN]: STANDAR: Konversi range tanggal WITA ke format WITA untuk query database
export function witaRangeToWitaQuery(
	startDate: string,
	endDate: string
): { startWita: string; endWita: string } {
	// [CATATAN]: Input: 'YYYY-MM-DD', 'YYYY-MM-DD' (range tanggal WITA)
	// [CATATAN]: Output: { startWita: 'YYYY-MM-DDTHH:mm:ss+08:00', endWita: 'YYYY-MM-DDTHH:mm:ss+08:00' }

	try {
		// [CATATAN]: Start: 00:00:00 WITA tanggal pertama
		const startWita = startDate + 'T00:00:00+08:00';
		// [CATATAN]: End: 23:59:59 WITA tanggal terakhir
		const endWita = endDate + 'T23:59:59+08:00';

		return {
			startWita: startWita,
			endWita: endWita
		};
	} catch (error) {
		throw new Error(`Failed to convert date range to WITA: ${startDate} to ${endDate}`);
	}
}

export function getLast7DaysLabelsWITA(): string[] {
	const labels: string[] = [];
	const now = new Date();
	for (let i = 6; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		// [CATATAN]: Format WITA day name
		const dayName = new Intl.DateTimeFormat('id-ID', {
			weekday: 'short',
			timeZone: 'Asia/Makassar'
		}).format(date);
		labels.push(dayName);
	}
	return labels;
}
