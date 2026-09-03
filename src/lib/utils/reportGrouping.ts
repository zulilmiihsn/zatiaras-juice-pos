import type { BukuKasRecord } from '$lib/types/laporan';

export interface ReportGroups {
	pemasukanUsahaQris: BukuKasRecord[];
	pemasukanUsahaTunai: BukuKasRecord[];
	pemasukanLainQris: BukuKasRecord[];
	pemasukanLainTunai: BukuKasRecord[];
	bebanUsahaQris: BukuKasRecord[];
	bebanUsahaTunai: BukuKasRecord[];
	bebanLainQris: BukuKasRecord[];
	bebanLainTunai: BukuKasRecord[];
	totalQrisAll: number;
	totalTunaiAll: number;
	totalQrisPemasukan: number;
	totalTunaiPemasukan: number;
	totalQrisPengeluaran: number;
	totalTunaiPengeluaran: number;
}

function emptyGroups(): ReportGroups {
	return {
		pemasukanUsahaQris: [],
		pemasukanUsahaTunai: [],
		pemasukanLainQris: [],
		pemasukanLainTunai: [],
		bebanUsahaQris: [],
		bebanUsahaTunai: [],
		bebanLainQris: [],
		bebanLainTunai: [],
		totalQrisAll: 0,
		totalTunaiAll: 0,
		totalQrisPemasukan: 0,
		totalTunaiPemasukan: 0,
		totalQrisPengeluaran: 0,
		totalTunaiPengeluaran: 0
	};
}

function normalizeReportJenis(
	record: BukuKasRecord
): 'pendapatan_usaha' | 'beban_usaha' | 'lainnya' {
	const jenis = String(record?.jenis || '')
		.trim()
		.toLowerCase();
	if (jenis === 'pendapatan_usaha' || jenis === 'beban_usaha' || jenis === 'lainnya') {
		return jenis;
	}
	return record?.tipe === 'out' ? 'beban_usaha' : 'pendapatan_usaha';
}

function isCash(record: BukuKasRecord): boolean {
	return (
		String(record?.metode_bayar || '')
			.trim()
			.toLowerCase() === 'tunai'
	);
}

export function groupReportTransactions(records: BukuKasRecord[]): ReportGroups {
	const groups = emptyGroups();

	for (const record of records) {
		const jenis = normalizeReportJenis(record);
		const cash = isCash(record);
		const nominal = record.nominal || 0;
		let target: BukuKasRecord[] | null = null;

		if (record.tipe === 'in' && jenis === 'pendapatan_usaha') {
			target = cash ? groups.pemasukanUsahaTunai : groups.pemasukanUsahaQris;
		} else if (record.tipe === 'in' && jenis === 'lainnya') {
			target = cash ? groups.pemasukanLainTunai : groups.pemasukanLainQris;
		} else if (record.tipe === 'out' && jenis === 'beban_usaha') {
			target = cash ? groups.bebanUsahaTunai : groups.bebanUsahaQris;
		} else if (record.tipe === 'out' && jenis === 'lainnya') {
			target = cash ? groups.bebanLainTunai : groups.bebanLainQris;
		}

		if (!target) continue;
		target.push(record);

		if (cash) {
			groups.totalTunaiAll += nominal;
			if (record.tipe === 'in') groups.totalTunaiPemasukan += nominal;
			else groups.totalTunaiPengeluaran += nominal;
		} else {
			groups.totalQrisAll += nominal;
			if (record.tipe === 'in') groups.totalQrisPemasukan += nominal;
			else groups.totalQrisPengeluaran += nominal;
		}
	}

	return groups;
}
