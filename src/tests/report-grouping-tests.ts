import assert from 'node:assert/strict';
import { groupReportTransactions } from '$lib/utils/reportGrouping';
import type { BukuKasRecord } from '$lib/types/laporan';

function record(
	id: string,
	tipe: BukuKasRecord['tipe'],
	jenis: BukuKasRecord['jenis'],
	metode_bayar: BukuKasRecord['metode_bayar'],
	nominal: number
): BukuKasRecord {
	return {
		id,
		tipe,
		jenis,
		metode_bayar,
		nominal,
		created_at: '2026-06-29T00:00:00.000Z'
	};
}

function legacyGroup(records: BukuKasRecord[]) {
	const normalizeJenis = (item: BukuKasRecord) => {
		const jenis = String(item.jenis || '')
			.trim()
			.toLowerCase();
		if (jenis === 'pendapatan_usaha' || jenis === 'beban_usaha' || jenis === 'lainnya') {
			return jenis;
		}
		return item.tipe === 'out' ? 'beban_usaha' : 'pendapatan_usaha';
	};
	const isCash = (item: BukuKasRecord) =>
		String(item.metode_bayar || '')
			.trim()
			.toLowerCase() === 'tunai';
	const pemasukanUsaha = records.filter(
		(item) => item.tipe === 'in' && normalizeJenis(item) === 'pendapatan_usaha'
	);
	const pemasukanLain = records.filter(
		(item) => item.tipe === 'in' && normalizeJenis(item) === 'lainnya'
	);
	const bebanUsaha = records.filter(
		(item) => item.tipe === 'out' && normalizeJenis(item) === 'beban_usaha'
	);
	const bebanLain = records.filter(
		(item) => item.tipe === 'out' && normalizeJenis(item) === 'lainnya'
	);
	const all = [...pemasukanUsaha, ...pemasukanLain, ...bebanUsaha, ...bebanLain];
	const income = [...pemasukanUsaha, ...pemasukanLain];
	const expense = [...bebanUsaha, ...bebanLain];
	const sum = (items: BukuKasRecord[]) =>
		items.reduce((total, item) => total + (item.nominal || 0), 0);

	return {
		pemasukanUsahaQris: pemasukanUsaha.filter((item) => !isCash(item)),
		pemasukanUsahaTunai: pemasukanUsaha.filter(isCash),
		pemasukanLainQris: pemasukanLain.filter((item) => !isCash(item)),
		pemasukanLainTunai: pemasukanLain.filter(isCash),
		bebanUsahaQris: bebanUsaha.filter((item) => !isCash(item)),
		bebanUsahaTunai: bebanUsaha.filter(isCash),
		bebanLainQris: bebanLain.filter((item) => !isCash(item)),
		bebanLainTunai: bebanLain.filter(isCash),
		totalQrisAll: sum(all.filter((item) => !isCash(item))),
		totalTunaiAll: sum(all.filter(isCash)),
		totalQrisPemasukan: sum(income.filter((item) => !isCash(item))),
		totalTunaiPemasukan: sum(income.filter(isCash)),
		totalQrisPengeluaran: sum(expense.filter((item) => !isCash(item))),
		totalTunaiPengeluaran: sum(expense.filter(isCash))
	};
}

const fixture: BukuKasRecord[] = [
	record('income-business-cash', 'in', 'pendapatan_usaha', 'tunai', 10_000),
	record('income-business-qris', 'in', 'pendapatan_usaha', 'qris', 20_000),
	record('income-other-cash', 'in', 'lainnya', 'tunai', 3_000),
	record('income-other-noncash', 'in', 'lainnya', 'non-tunai', 4_000),
	record('expense-business-cash', 'out', 'beban_usaha', 'tunai', 5_000),
	record('expense-business-qris', 'out', 'beban_usaha', 'qris', 6_000),
	record('expense-other-cash', 'out', 'lainnya', 'tunai', 7_000),
	record('expense-other-noncash', 'out', 'lainnya', 'non-tunai', 8_000),
	{ ...record('legacy-income', 'in', 'lainnya', 'qris', 9_000), jenis: 'legacy' as never },
	{ ...record('legacy-expense', 'out', 'lainnya', 'tunai', 11_000), jenis: 'legacy' as never },
	record('excluded-income-expense-kind', 'in', 'beban_usaha', 'tunai', 12_000),
	record('excluded-expense-income-kind', 'out', 'pendapatan_usaha', 'qris', 13_000)
];

assert.deepEqual(groupReportTransactions(fixture), legacyGroup(fixture));
console.log('Report grouping one-pass output matches legacy filters.');
