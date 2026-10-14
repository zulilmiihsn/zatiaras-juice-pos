import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestD1 } from './helpers/testD1';
import { applyRestorePlan } from './helpers/restorePlan';
import { branchContext } from '../lib/server/branchResolver';
import { buildLaporanAggregate } from '../lib/server/reportQueries';
import { runArchive, type ArchiveResult } from '../lib/server/archiveUseCase';
import { executeCheckout } from '../lib/server/checkout/checkoutUseCase';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { buildRestoreChunks, sqlVal } from '../../scripts/restore-archive-lib.mjs';
import { cutoffForYear } from '../lib/server/archiveService';
import { CHECKOUT_MAX_PER_WINDOW } from '../lib/server/checkout/utils';

// Budget performa pemilik (TRK-082) pada kode produksi asli di atas
// workerd D1 (--d1) atau SQLite, dengan data setahun satu cabang.
// Budget: checkout POS < 2 s; laporan setahun < 5 s; arsip dan restore setahun
// selesai tanpa timeout (tiap panggilan Worker di bawah batas CPU 30 s).
// Ukuran: PERF_DAYS (bawaan 365) x PERF_SALES_PER_DAY (bawaan 500).
function envInt(name: string, fallback: number, max: number): number {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isInteger(value) || value < 1 || value > max) {
		throw new Error(`${name} harus bilangan bulat 1..${max}`);
	}
	return value;
}
// Hari dibatasi 365 agar seluruh data jatuh di tahun laporan/arsip yang sama.
const DAYS = envInt('PERF_DAYS', 365, 365);
const SALES_PER_DAY = envInt('PERF_SALES_PER_DAY', 500, 720);
const MANUAL_PER_DAY = 10;
// PERF_SKIP_ARCHIVE=1: ukur laporan + checkout saja (arsip setahun ±40 menit; ukur
// arsip pada sampel lalu ekstrapolasi per chunk).
const SKIP_ARCHIVE = process.env.PERF_SKIP_ARCHIVE === '1';
const BUDGET = {
	checkoutP95Ms: 2_000,
	reportMs: 5_000,
	workerCallMs: 30_000
};
const YEAR = 2025;
const branch = branchContext('samarinda');
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
let peakRssMb = rss();
const track = () => (peakRssMb = Math.max(peakRssMb, rss()));
const q = sqlVal;

function dayOf(index: number): string {
	return new Date(Date.UTC(YEAR, 0, 1 + index)).toISOString().slice(0, 10);
}

function receipt(committedAt: string): string {
	return JSON.stringify({
		schema_version: 1,
		items: [
			{
				product_id: 'perf-product',
				nama: 'Jus Perf',
				jumlah: 2,
				harga: 20000,
				nominal: 40000,
				harga_dasar: 20000,
				total_tambahan: 0,
				tambahan: [],
				gula: null,
				es: null,
				catatan: null
			}
		],
		total_amount: 40000,
		total_qty: 2,
		cash_received: null,
		change: null,
		metode_bayar: 'tunai',
		committed_at: committedAt,
		customer_name: null,
		settings: null
	});
}

const { db, close } = await createTestD1();
const report: Record<string, unknown> = {
	backend: process.argv.includes('--d1') ? 'workerd D1' : 'SQLite',
	runtime: process.version,
	dataset: { days: DAYS, salesPerDay: SALES_PER_DAY, manualPerDay: MANUAL_PER_DAY },
	budget: BUDGET
};
// Direktori objek arsip sementara (ratusan MB) selalu dihapus, juga saat gagal.
const tempDirs: string[] = [];
try {
	// 1. Seed: SQL literal multi-baris agar tak terkena batas 100 bind-param D1.
	const seedStart = performance.now();
	const statements: string[] = [];
	const ROWS_PER_INSERT = 100;
	for (let d = 0; d < DAYS; d++) {
		const day = dayOf(d);
		const headers: string[] = [];
		const details: string[] = [];
		for (let i = 0; i < SALES_PER_DAY; i++) {
			const minute = Math.floor((i * 720) / SALES_PER_DAY);
			const waktu = `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`;
			const id = `perf-${day}-${i}`;
			headers.push(
				`(${[
					q(id),
					"'samarinda'",
					q(waktu),
					"'pos'",
					"'in'",
					"'pendapatan_usaha'",
					40000,
					"'tunai'",
					2,
					q(`tx-${id}`),
					q(`key-${id}`),
					q('a'.repeat(64)),
					i + 1,
					q(day),
					q(receipt(waktu)),
					"'tracked'",
					0,
					q(waktu)
				].join(',')})`
			);
			details.push(
				`(${[
					q(`tk-${id}`),
					"'samarinda'",
					q(id),
					q(`tx-${id}`),
					"'perf-product'",
					"'Jus Perf'",
					2,
					20000,
					20000,
					0,
					40000,
					12000,
					q('{"total":12000}'),
					"'[]'",
					q(waktu)
				].join(',')})`
			);
		}
		for (let start = 0; start < headers.length; start += ROWS_PER_INSERT) {
			statements.push(
				`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar,jumlah,transaction_id,idempotency_key,request_fingerprint,nomor_harian,tanggal_nomor,receipt_snapshot,stock_policy_mode,stock_policy_revision,created_at) VALUES ${headers.slice(start, start + ROWS_PER_INSERT).join(',')}`,
				`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,transaction_id,produk_id,nama_produk,jumlah,harga,harga_dasar,total_tambahan,nominal,nominal_hpp,snapshot_hpp,snapshot_tambahan,created_at) VALUES ${details.slice(start, start + ROWS_PER_INSERT).join(',')}`
			);
		}
		const manual = Array.from({ length: MANUAL_PER_DAY }, (_, i) => {
			const isOut = i % 2 === 1;
			return `(${[
				q(`perf-manual-${day}-${i}`),
				"'samarinda'",
				q(`${day}T05:${String(i).padStart(2, '0')}:00.000Z`),
				"'catat'",
				q(isOut ? 'out' : 'in'),
				q(isOut ? 'beban_usaha' : 'pendapatan_usaha'),
				isOut ? 15000 : 25000,
				"'tunai'",
				q(`tx-perf-manual-${day}-${i}`)
			].join(',')})`;
		});
		statements.push(
			`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar,transaction_id) VALUES ${manual.join(',')}`,
			`INSERT INTO ringkasan_penjualan_harian(id,cabang_id,tanggal_penjualan,jumlah_transaksi,jumlah_item,penjualan_kotor,penjualan_tunai,penjualan_nontunai,total_hpp) VALUES (${q(`sum-${day}`)},'samarinda',${q(day)},${SALES_PER_DAY},${SALES_PER_DAY * 2},${SALES_PER_DAY * 40000},${SALES_PER_DAY * 40000},0,${SALES_PER_DAY * 12000})`,
			`INSERT INTO penjualan_produk_harian(id,cabang_id,tanggal_penjualan,produk_id,nama_produk,jumlah,penjualan_kotor,penjualan_tunai,penjualan_nontunai,jumlah_transaksi) VALUES (${q(`pp-${day}`)},'samarinda',${q(day)},'perf-product','Jus Perf',${SALES_PER_DAY * 2},${SALES_PER_DAY * 40000},${SALES_PER_DAY * 40000},0,${SALES_PER_DAY})`
		);
	}
	for (let start = 0; start < statements.length; start += 50) {
		await db.batch(statements.slice(start, start + 50).map((sql) => db.prepare(sql)));
		track();
	}
	const posRows = DAYS * SALES_PER_DAY;
	assert.equal(
		await db
			.prepare(
				"SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = 'samarinda' AND sumber = 'pos'"
			)
			.first('n'),
		posRows
	);
	report.seedMs = Math.round(performance.now() - seedStart);

	// 2. Laporan setahun (jalur /api/reports/aggregate), tiga kali: dingin + hangat.
	const reportRuns: number[] = [];
	let summary: Awaited<ReturnType<typeof buildLaporanAggregate>>['summary'] | null = null;
	for (let run = 0; run < 3; run++) {
		const start = performance.now();
		const aggregate = await buildLaporanAggregate(db, branch, `${YEAR}-01-01`, `${YEAR}-12-31`);
		reportRuns.push(Math.round(performance.now() - start));
		summary = aggregate.summary;
		track();
	}
	const expectedIncome = posRows * 40000 + DAYS * (MANUAL_PER_DAY / 2) * 25000;
	assert.equal(summary?.pendapatan, expectedIncome, 'Laporan setahun utuh');
	report.reportMs = reportRuns;

	// 3. Checkout di atas data setahun: 30 checkout berurutan.
	await db.batch([
		db.prepare(
			"INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active) VALUES ('perf-checkout', 'samarinda', 'Jus Checkout', 15000, 0, 0, 0, 1)"
		),
		db.prepare(
			"INSERT INTO pengaturan (id, cabang_id, kunci, nama_toko) VALUES ('perf-settings', 'samarinda', NULL, 'Toko Perf')"
		)
	]);
	const env = {
		DB_SAMARINDA_GROUP: db,
		POS_PRICE_SIGNING_KEY: 'perf-budget-key-32-bytes-minimum-abcd',
		POS_PRICE_SIGNING_KEY_ID: 'perf'
	} as App.Platform['env'];
	const source = { product_id: 'perf-checkout', jumlah: 1 };
	const checkoutRuns: number[] = [];
	// Satu pengguna dibatasi CHECKOUT_MAX_PER_WINDOW per jendela; jangan melewatinya.
	for (let i = 0; i < Math.min(30, CHECKOUT_MAX_PER_WINDOW); i++) {
		const quote = await signPosPricingToken(env, {
			kind: 'checkout_quote',
			branch: 'samarinda',
			data: {
				items: [
					{
						source,
						product_name: 'Jus Checkout',
						product_price: 15000,
						add_ons: [],
						line_total: 15000
					}
				],
				total_amount: 15000,
				total_qty: 1
			},
			ttlMs: 60_000
		});
		const start = performance.now();
		const result = await executeCheckout({
			db,
			branch,
			session: { userId: 'perf-owner', username: 'owner', role: 'pemilik' },
			platform: { env } as App.Platform,
			rawBody: {
				idempotency_key: `perf-checkout-${String(i).padStart(4, '0')}`,
				metode_bayar: 'tunai',
				cash_received: 15000,
				items: [source],
				quote_token: quote
			}
		});
		checkoutRuns.push(Math.round(performance.now() - start));
		assert.equal(result.idempotent, false);
	}
	const sorted = [...checkoutRuns].sort((a, b) => a - b);
	report.checkoutMs = {
		p50: sorted[Math.floor(sorted.length * 0.5)],
		p95: sorted[Math.floor(sorted.length * 0.95)],
		max: sorted[sorted.length - 1]
	};

	if (!SKIP_ARCHIVE) {
		// 4. Arsip setahun: panggil runArchive berulang seperti UI sampai selesai.
		// Objek arsip disimpan di disk, bukan memori: setahun ±0,3GB JSON.
		const objectDir = mkdtempSync(join(tmpdir(), 'zatiaras-perf-archive-'));
		tempDirs.push(objectDir);
		const objectPath = (key: string) => join(objectDir, encodeURIComponent(key));
		const storage = {
			async put(key: string, value: string) {
				writeFileSync(objectPath(key), value);
			},
			async get(key: string) {
				let text: string;
				try {
					text = readFileSync(objectPath(key), 'utf8');
				} catch {
					return null;
				}
				return {
					text: async () => text,
					arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer
				};
			}
		};
		const objectKeys = () => readdirSync(objectDir).map((name) => decodeURIComponent(name));
		const archiveCalls: number[] = [];
		let archived: ArchiveResult | null = null;
		const archiveStart = performance.now();
		for (let call = 0; call < 10_000; call++) {
			const start = performance.now();
			archived = await runArchive(db, storage, branch, YEAR + 1);
			archiveCalls.push(Math.round(performance.now() - start));
			track();
			if (archived.kind !== 'partial') break;
		}
		assert.ok(archived && ['completed', 'resumed'].includes(archived.kind), String(archived?.kind));
		const archiveBytes = objectKeys().map((key) => statSync(objectPath(key)).size);
		report.archive = {
			calls: archiveCalls.length,
			objects: archiveBytes.length,
			maxCallMs: Math.max(...archiveCalls),
			totalMs: Math.round(performance.now() - archiveStart),
			maxObjectBytes: Math.max(...archiveBytes),
			totalBytes: archiveBytes.reduce((sum, n) => sum + n, 0)
		};
		assert.equal(
			await db
				.prepare(
					"SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = 'samarinda' AND sumber = 'pos' AND waktu < ?"
				)
				.bind(cutoffForYear(YEAR + 1).cutoff)
				.first('n'),
			0,
			'Semua transaksi 2025 terarsip'
		);

		// 5. Restore setahun: tiap objek arsip direncanakan + diterapkan seperti CLI.
		const restoreStart = performance.now();
		let maxRestorePartMs = 0;
		for (const key of objectKeys()) {
			if (!key.endsWith('.json')) continue;
			const text = readFileSync(objectPath(key), 'utf8');
			const start = performance.now();
			const archive = JSON.parse(text);
			const sha256 = createHash('sha256').update(text).digest('hex');
			await applyRestorePlan(db, buildRestoreChunks(archive, { sha256 }));
			maxRestorePartMs = Math.max(maxRestorePartMs, performance.now() - start);
			track();
		}
		report.restore = {
			parts: objectKeys().filter((k) => k.endsWith('.json')).length,
			maxPartMs: Math.round(maxRestorePartMs),
			totalMs: Math.round(performance.now() - restoreStart)
		};
		const afterRestore = await buildLaporanAggregate(db, branch, `${YEAR}-01-01`, `${YEAR}-12-31`);
		assert.equal(afterRestore.summary.pendapatan, expectedIncome, 'Restore setahun utuh (paritas)');
		// Laporan POS berasal dari ringkasan harian yang tak ikut diarsip: hitung baris ledger langsung.
		const cutoff = cutoffForYear(YEAR + 1).cutoff;
		const countBefore = (sql: string) => db.prepare(sql).bind(cutoff).first('n');
		assert.equal(
			await countBefore(
				"SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = 'samarinda' AND sumber = 'pos' AND waktu < ?"
			),
			posRows,
			'Seluruh header POS kembali'
		);
		assert.equal(
			await countBefore(
				"SELECT COUNT(*) AS n FROM transaksi_kasir WHERE cabang_id = 'samarinda' AND created_at < ?"
			),
			posRows,
			'Seluruh detail POS kembali'
		);
		assert.equal(
			await countBefore(
				"SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = 'samarinda' AND sumber = 'catat' AND waktu < ?"
			),
			DAYS * MANUAL_PER_DAY,
			'Seluruh transaksi manual kembali'
		);
	}
	// Hanya proses Node; dengan --d1 memori workerd (D1) tidak ikut terukur.
	report.peakNodeRssMb = peakRssMb;

	console.log('PERF_BUDGET_REPORT', JSON.stringify(report));
	assert.ok(Math.max(...reportRuns) < BUDGET.reportMs, `Laporan setahun ${reportRuns} ms`);
	assert.ok(
		(report.checkoutMs as { p95: number }).p95 < BUDGET.checkoutP95Ms,
		`Checkout p95 ${JSON.stringify(report.checkoutMs)}`
	);
	assert.ok(
		SKIP_ARCHIVE || (report.archive as { maxCallMs: number }).maxCallMs < BUDGET.workerCallMs,
		`Panggilan arsip terlama ${JSON.stringify(report.archive)}`
	);
	console.log('perf-budget-tests: budget pemilik terpenuhi');
} finally {
	// Cleanup dulu; kegagalan close tak boleh menutupi kegagalan budget.
	try {
		await close();
	} catch (error) {
		console.warn('perf-budget-tests: gagal menutup D1:', error);
	}
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			// Jangan menutupi kegagalan budget yang sebenarnya.
			console.warn(`perf-budget-tests: gagal menghapus ${dir}:`, error);
		}
	}
}
