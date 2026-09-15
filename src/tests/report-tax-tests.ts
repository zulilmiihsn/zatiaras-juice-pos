import assert from 'node:assert/strict';
import { buildLaporanAggregate } from '../lib/server/reportQueries.js';

function mockDb(handlers: Array<{ match: RegExp; first?: unknown; all?: unknown[] }>) {
	return {
		prepare: (sql: string) => ({
			bind: () => ({
				first: async () => {
					const h = handlers.find((x) => x.match.test(sql));
					if (!h) throw new Error(`query tak terduga: ${sql.slice(0, 80)}`);
					if (h.first === 'THROW') throw new Error('DB down');
					return h.first ?? null;
				},
				all: async () => ({ results: handlers.find((x) => x.match.test(sql))?.all ?? [] })
			})
		})
	};
}

const base = [
	{ match: /ringkasan_penjualan_harian/, first: { gross: 40000 } },
	{ match: /penjualan_produk_harian/, all: [] },
	{ match: /FROM buku_kas/, first: { total: 10000 } },
	{ match: /ringkasan_kas_arsip_harian/, first: { total: 0 } },
	{ match: /pengaturan/, first: null }
];

// R06: query YTD wajib gagal -> laporan gagal, bukan pajak 0.
{
	const db = mockDb([
		{ match: /ringkasan_penjualan_harian/, first: { gross: 40000 } },
		{ match: /penjualan_produk_harian/, all: [] },
		// Query rentang periode (3 argumen tanggal) lolos; query YTD gagal.
		{ match: /FROM buku_kas/, first: 'THROW' },
		{ match: /ringkasan_kas_arsip_harian/, first: { total: 0 } },
		{ match: /pengaturan/, first: null }
	]);
	await assert.rejects(() =>
		buildLaporanAggregate(db as never, 'samarinda', '2026-09-01', '2026-09-15')
	);
}

// F12+F13: POS 40rb + manual 10rb, tarif 0,5% -> pajak 250, breakdown+label kanonik.
{
	const taxRow = {
		nilai: JSON.stringify({
			enabled: true,
			nama: 'PPh',
			rate: 0.005,
			threshold: 500_000_000,
			apply_threshold: false
		})
	};
	const db = mockDb([
		{ match: /ringkasan_penjualan_harian/, first: { gross: 40000 } },
		{ match: /penjualan_produk_harian/, all: [] },
		{
			match: /SELECT id, transaction_id/,
			all: [
				{
					id: 'm1',
					tipe: 'in',
					jenis: 'pendapatan_usaha',
					nominal: 10000,
					sumber: 'catat',
					metode_bayar: 'tunai'
				}
			]
		},
		{ match: /FROM buku_kas/, first: { total: 10000 } },
		{ match: /ringkasan_kas_arsip_harian/, first: { total: 0 } },
		{ match: /pengaturan/, first: taxRow }
	]);
	const agg = await buildLaporanAggregate(db as never, 'samarinda', '2026-09-01', '2026-09-15');
	assert.equal(agg.summary.pajak, 250);
	assert.equal(agg.summary.labaBersih, agg.summary.labaKotor - 250);
	assert.ok(Array.isArray(agg.taxContext?.breakdowns) && agg.taxContext.breakdowns.length === 1);
	assert.ok(typeof agg.taxContext?.label === 'string' && agg.taxContext.label.length > 0);
	assert.equal(agg.taxContext?.omzetUsaha, 50000);
	assert.equal(agg.taxContext?.contract, 2);
}

// Lintas tahun: Des 2025 300jt + Jan 2026 300jt, threshold 500jt -> pajak per tahun terpisah.
{
	const byRange = (from: string, to: string) => {
		if (from <= '2025-12-31' && to >= '2025-12-01') return 300_000_000;
		if (from <= '2026-01-31' && to >= '2026-01-01') return 300_000_000;
		return 0;
	};
	const db = {
		prepare: (sql: string) => ({
			bind: (...args: unknown[]) => ({
				first: async () => {
					if (/pengaturan/.test(sql)) {
						return {
							nilai: JSON.stringify({
								enabled: true,
								nama: 'PPh',
								rate: 0.005,
								threshold: 500_000_000,
								apply_threshold: true
							})
						};
					}
					if (/ringkasan_penjualan_harian/.test(sql) && /tanggal_penjualan >=/.test(sql)) {
						return { gross: byRange(String(args[1]), String(args[2])) };
					}
					if (/FROM buku_kas/.test(sql) || /ringkasan_kas_arsip/.test(sql)) {
						return { total: 0 };
					}
					return null;
				},
				all: async () => ({ results: [] })
			})
		})
	};
	const agg = await buildLaporanAggregate(db as never, 'samarinda', '2025-12-01', '2026-01-31');
	// 2025: 300jt <= 500jt -> 0. 2026: YTD reset, 300jt -> 0. Total 0, bukan YTD gabungan.
	assert.equal(agg.summary.pajak, 0);
	assert.equal(agg.taxContext?.perTahun?.length, 2);
	void base;
}

console.log('report-tax-tests: all assertions passed');
