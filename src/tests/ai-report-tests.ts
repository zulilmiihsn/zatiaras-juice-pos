import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/testD1';
import { fetchReportDataSql } from '../lib/server/ai/reportData';
import { buildLaporanAggregate } from '../lib/server/reportQueries';
import { branchContext } from '../lib/server/branchResolver';

// AUD-030: inti finansial AI reuse agregat kanonik aktif + arsip.
const { db, close } = await createTestD1();
try {
	const day = '2026-09-10';
	const otherDay = '2026-09-11';
	// Aktif: ringkasan harian POS 100000 + manual 25000.
	await db.batch([
		db
			.prepare(
				`INSERT INTO ringkasan_penjualan_harian (id, cabang_id, tanggal_penjualan, jumlah_transaksi, jumlah_item, penjualan_kotor, penjualan_tunai, penjualan_nontunai, total_hpp)
			 VALUES ('sum1', 'samarinda', ?, 2, 2, 100000, 60000, 40000, 10000)`
			)
			.bind(day),
		db
			.prepare(
				`INSERT INTO penjualan_produk_harian (id, cabang_id, tanggal_penjualan, produk_id, nama_produk, jumlah, penjualan_kotor, penjualan_tunai, penjualan_nontunai, jumlah_transaksi)
			 VALUES ('pp1', 'samarinda', ?, 'p1', 'Teh', 2, 100000, 60000, 40000, 2)`
			)
			.bind(day),
		db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('bk-manual', 'samarinda', '2026-09-10T02:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 25000, 1, 'tx-manual')`
		),
		// Arsip saja: 40000 masuk + 5000 keluar, 2 transaksi.
		db
			.prepare(
				`INSERT INTO ringkasan_kas_arsip_harian (id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar, jumlah_transaksi, total_nominal)
			 VALUES ('ar1', 'samarinda', 'arc1', ?, 'in', 'pendapatan_usaha', 'tunai', 2, 40000)`
			)
			.bind(day),
		db
			.prepare(
				`INSERT INTO ringkasan_kas_arsip_harian (id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar, jumlah_transaksi, total_nominal)
			 VALUES ('ar2', 'samarinda', 'arc1', ?, 'out', 'beban_usaha', 'tunai', 1, 5000)`
			)
			.bind(day),
		// Cabang lain: wajib diabaikan.
		db
			.prepare(
				`INSERT INTO ringkasan_kas_arsip_harian (id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar, jumlah_transaksi, total_nominal)
			 VALUES ('arX', 'balikpapan', 'arcX', ?, 'in', 'pendapatan_usaha', 'tunai', 9, 999999)`
			)
			.bind(day),
		db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('bkX', 'balikpapan', '2026-09-10T02:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 888888, 1, 'txX')`
		)
	]);

	const range = { start: '2026-09-09', end: '2026-09-12' };
	const result = await fetchReportDataSql(db, 'samarinda', range.start, range.end);
	const canonical = await buildLaporanAggregate(
		db,
		branchContext('samarinda'),
		range.start,
		range.end
	);

	// Paritas inti dengan laporan kanonik (tanpa ganda).
	assert.equal(result.hasData, true);
	assert.equal(result.serverReportData.summary?.pendapatan, canonical.summary.pendapatan);
	assert.equal(result.serverReportData.summary?.pengeluaran, canonical.summary.pengeluaran);
	assert.equal(result.serverReportData.summary?.pendapatan, 165000);
	assert.equal(result.serverReportData.summary?.pengeluaran, 5000);
	assert.ok((result.totalRecords || 0) > 0);
	// Transaksi = aktif + arsip.
	assert.ok((result.serverReportData.summary?.totalTransaksi || 0) >= 2);

	// Hari lain di luar rentang tak ikut.
	const narrow = await fetchReportDataSql(db, 'samarinda', otherDay, otherDay);
	assert.equal(narrow.hasData, false);

	// Arsip saja terbaca bila hanya arsip yang ada.
	await db.prepare(`DELETE FROM ringkasan_penjualan_harian WHERE cabang_id = 'samarinda'`).run();
	await db.prepare(`DELETE FROM penjualan_produk_harian WHERE cabang_id = 'samarinda'`).run();
	await db.prepare(`DELETE FROM buku_kas WHERE cabang_id = 'samarinda'`).run();
	const archiveOnly = await fetchReportDataSql(db, 'samarinda', range.start, range.end);
	assert.equal(archiveOnly.hasData, true);
	assert.equal(archiveOnly.serverReportData.summary?.pendapatan, 40000);
	assert.equal(archiveOnly.serverReportData.summary?.pengeluaran, 5000);

	// Benar-benar kosong = NO_DATA.
	await db.prepare(`DELETE FROM ringkasan_kas_arsip_harian WHERE cabang_id = 'samarinda'`).run();
	const empty = await fetchReportDataSql(db, 'samarinda', range.start, range.end);
	assert.equal(empty.hasData, false);

	console.log('ai-report-tests: paritas kanonik, arsip, cabang, NO_DATA passed');
} finally {
	await close();
}

// AUD-030 / F-030: rincian bulanan, harian, pembayaran, dan produk memakai fakta
// kanonik yang sama dengan ringkasan. POS terarsip = buku_kas/transaksi_kasir
// sudah hilang, ringkasan harian + produk harian tetap ada.
const detailDb = await createTestD1();
try {
	const run = (sql: string, ...values: unknown[]) =>
		detailDb.db
			.prepare(sql)
			.bind(...values)
			.run();
	const posDay = (
		id: string,
		branch: string,
		day: string,
		tx: number,
		cash: number,
		nonCash: number
	) =>
		run(
			`INSERT INTO ringkasan_penjualan_harian (id, cabang_id, tanggal_penjualan, jumlah_transaksi, jumlah_item, penjualan_kotor, penjualan_tunai, penjualan_nontunai, total_hpp)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
			id,
			branch,
			day,
			tx,
			tx,
			cash + nonCash,
			cash,
			nonCash
		);
	const productDay = (
		id: string,
		branch: string,
		day: string,
		name: string,
		qty: number,
		gross: number
	) =>
		run(
			`INSERT INTO penjualan_produk_harian (id, cabang_id, tanggal_penjualan, produk_id, nama_produk, jumlah, penjualan_kotor, penjualan_tunai, penjualan_nontunai, jumlah_transaksi)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
			id,
			branch,
			day,
			`p-${name}`,
			name,
			qty,
			gross,
			gross,
			qty
		);
	const archived = (
		id: string,
		branch: string,
		day: string,
		tipe: string,
		metode: string,
		tx: number,
		total: number
	) =>
		run(
			`INSERT INTO ringkasan_kas_arsip_harian (id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar, jumlah_transaksi, total_nominal)
			 VALUES (?, ?, 'arc', ?, ?, ?, ?, ?, ?)`,
			id,
			branch,
			day,
			tipe,
			tipe === 'in' ? 'pendapatan_usaha' : 'beban_usaha',
			metode,
			tx,
			total
		);

	// Arsip saja (tahun 2025 diarsipkan): POS Rp40000 dari ringkasan harian.
	await posDay('s-25a', 'samarinda', '2025-03-04', 2, 30000, 10000);
	await productDay('pp-25a', 'samarinda', '2025-03-04', 'Teh (Jumbo)', 1, 25000);
	await productDay('pp-25b', 'samarinda', '2025-03-04', 'Teh (Reguler)', 1, 15000);
	await run(
		`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,object_key,checksum,counts,created_at,updated_at)
		 VALUES('job-2026','samarinda',2026,'2026-01-01','completed','t',0,'arsip/samarinda/2026/f.json','abc',NULL,'2026-01-02','2026-01-02')`
	);
	const archiveOnly = await fetchReportDataSql(
		detailDb.db,
		'samarinda',
		'2025-03-01',
		'2025-03-31'
	);
	const data = archiveOnly.serverReportData;
	assert.equal(archiveOnly.hasData, true);
	assert.equal(data.summary?.pendapatan, 40000);
	assert.deepEqual(
		data.summary?.requestedMonthlyData?.map((m) => [m.month, m.pemasukan, m.transaksi]),
		[['2025-03', 40000, 2]]
	);
	assert.deepEqual(data.summary?.requestedMonthlyData?.[0].topProducts, [
		{ id: 'Teh', nama: 'Teh', totalTerjual: 2, totalPendapatan: 40000 }
	]);
	assert.deepEqual(
		data.dailyPerformance?.map((d) => [d.count, d.revenue]),
		[[2, 40000]]
	);
	assert.deepEqual(data.pembayaran, { tunai: { nominal: 30000 }, 'non-tunai': { nominal: 10000 } });
	assert.deepEqual(data.produkTerlaris, [
		{ id: 'Teh', nama: 'Teh', totalTerjual: 2, totalPendapatan: 40000 }
	]);
	assert.equal(data.summary?.totalTransaksi, 2);
	assert.deepEqual(data.rincianDetailAktifSaja, { arsipSebelum: '2026-01-01' });

	// Campuran lintas tahun: arsip manual 2025 + POS/manual aktif 2026, cabang lain diabaikan.
	await archived('am-25', 'samarinda', '2025-12-31', 'in', 'qris', 3, 9000);
	await archived('ao-25', 'samarinda', '2025-12-31', 'out', 'tunai', 1, 4000);
	await posDay('s-26', 'samarinda', '2026-01-05', 1, 0, 20000);
	await productDay('pp-26', 'samarinda', '2026-01-05', 'Kopi', 2, 20000);
	// Pemasukan lain-lain (mis. modal) dengan metode tunai lama 'cash': ikut pendapatan
	// dan tunai, tetapi bukan transaksi penjualan.
	await run(
		`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id, metode_bayar)
		 VALUES ('bk-26', 'samarinda', '2026-01-05T03:00:00.000Z', 'catat', 'in', 'lainnya', 5000, 1, 'tx-26', 'cash')`
	);
	// Baris POS aktif buku_kas tidak boleh menghitung ganda ringkasan POS harian.
	await run(
		`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id, metode_bayar, stock_policy_mode, stock_policy_revision)
		 VALUES ('bk-pos-26', 'samarinda', '2026-01-05T03:00:00.000Z', 'pos', 'in', 'pendapatan_usaha', 20000, 1, 'tx-pos-26', 'non-tunai', 'tracked', 0)`
	);
	await posDay('s-x', 'balikpapan', '2026-01-05', 9, 999999, 0);
	await productDay('pp-x', 'balikpapan', '2026-01-05', 'Teh', 99, 999999);
	await archived('ax', 'balikpapan', '2025-12-31', 'in', 'tunai', 9, 888888);

	const mixed = await fetchReportDataSql(detailDb.db, 'samarinda', '2025-01-01', '2026-01-31');
	const canonical = await buildLaporanAggregate(
		detailDb.db,
		branchContext('samarinda'),
		'2025-01-01',
		'2026-01-31'
	);
	const months = mixed.serverReportData.summary?.requestedMonthlyData ?? [];
	assert.equal(mixed.serverReportData.summary?.pendapatan, canonical.summary.pendapatan);
	assert.equal(canonical.summary.pendapatan, 40000 + 9000 + 20000 + 5000);
	assert.equal(
		months.reduce((sum, m) => sum + m.pemasukan, 0),
		canonical.summary.pendapatan
	);
	assert.equal(
		months.reduce((sum, m) => sum + m.pengeluaran, 0),
		canonical.summary.pengeluaran
	);
	assert.equal(
		Object.values(mixed.serverReportData.pembayaran ?? {}).reduce((s, p) => s + p.nominal, 0),
		canonical.summary.pendapatan
	);
	assert.equal(
		(mixed.serverReportData.dailyPerformance ?? []).reduce((s, d) => s + d.revenue, 0),
		canonical.summary.pendapatan
	);
	assert.deepEqual(
		months.map((m) => [m.month, m.pemasukan, m.pengeluaran, m.transaksi]),
		[
			['2025-03', 40000, 0, 2],
			['2025-12', 9000, 4000, 3],
			['2026-01', 25000, 0, 1]
		]
	);
	assert.deepEqual(mixed.serverReportData.pembayaran, {
		tunai: { nominal: 35000 },
		'non-tunai': { nominal: 39000 }
	});
	assert.deepEqual(
		mixed.serverReportData.produkTerlaris?.map((p) => [p.nama, p.totalTerjual, p.totalPendapatan]),
		[
			['Teh', 2, 40000],
			['Kopi', 2, 20000]
		]
	);
	assert.equal(mixed.serverReportData.summary?.totalTransaksi, 6);

	// Rentang aktif penuh (setelah batas arsip) tidak diberi catatan cakupan.
	const active = await fetchReportDataSql(detailDb.db, 'samarinda', '2026-01-01', '2026-01-31');
	assert.equal(active.serverReportData.rincianDetailAktifSaja, undefined);
	assert.equal(active.serverReportData.summary?.pendapatan, 25000);

	console.log('ai-report-tests: rincian bulanan/harian/pembayaran/produk kanonik arsip passed');
} finally {
	await detailDb.close();
}

// AUD-031: pajak AI = omzet usaha + YTD before + segmentasi tahun kanonik.
const taxDb = await createTestD1();
try {
	const taxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph_final_umkm',
				nama: 'PPh Final UMKM (0.5%)',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true,
				useThreshold500Juta: true,
				thresholdAmount: 500000000
			}
		]
	};
	await taxDb.db
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nilai) VALUES ('pajak1', 'samarinda', 'pajak_config', ?)`
		)
		.bind(JSON.stringify({ schema_version: 2, revision: 1, settings: taxSettings }))
		.run();
	// YTD 600jt: 500jt harian Jan-Agu + 100jt arsip manual.
	const ytdInserts = [];
	for (let m = 1; m <= 5; m++) {
		const tanggal = `2026-0${m}-15`;
		ytdInserts.push(
			taxDb.db
				.prepare(
					`INSERT INTO ringkasan_penjualan_harian (id, cabang_id, tanggal_penjualan, jumlah_transaksi, jumlah_item, penjualan_kotor, penjualan_tunai, penjualan_nontunai, total_hpp)
					 VALUES (?, 'samarinda', ?, 10, 10, 100000000, 100000000, 0, 0)`
				)
				.bind(`ytd${m}`, tanggal)
		);
	}
	ytdInserts.push(
		taxDb.db.prepare(
			`INSERT INTO ringkasan_kas_arsip_harian (id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar, jumlah_transaksi, total_nominal)
			 VALUES ('ytd-ar', 'samarinda', 'arcY', '2026-06-15', 'in', 'pendapatan_usaha', 'tunai', 50, 100000000)`
		),
		// Periode berjalan September: manual 100rb (omzet periode = 100rb).
		taxDb.db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('sep-manual', 'samarinda', '2026-09-10T02:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 100000, 1, 'tx-sep')`
		)
	);
	await taxDb.db.batch(ytdInserts);

	const sep = await fetchReportDataSql(taxDb.db, 'samarinda', '2026-09-01', '2026-09-30');
	const sepCanonical = await buildLaporanAggregate(
		taxDb.db,
		branchContext('samarinda'),
		'2026-09-01',
		'2026-09-30'
	);
	// YTD 600jt > 500jt: 100rb periode kena 0.5% = 500 (bukan 0).
	assert.equal(sep.serverReportData.summary?.pajak, 500);
	assert.equal(sep.serverReportData.summary?.pajak, sepCanonical.summary.pajak);
	assert.equal(sep.serverReportData.summary?.labaBersih, sepCanonical.summary.labaBersih);

	// Lintas tahun + reset Januari ikut kanonik.
	const crossYear = await fetchReportDataSql(taxDb.db, 'samarinda', '2025-12-01', '2026-09-30');
	const crossCanonical = await buildLaporanAggregate(
		taxDb.db,
		branchContext('samarinda'),
		'2025-12-01',
		'2026-09-30'
	);
	assert.equal(crossYear.serverReportData.summary?.pajak, crossCanonical.summary.pajak);
	console.log('ai-report-tests: YTD threshold + lintas tahun passed');
} finally {
	await taxDb.close();
}

// Modal 200jt bukan omzet: usaha 400jt tetap bebas (0, bukan 500000).
const modalDb = await createTestD1();
try {
	const taxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph_final_umkm',
				nama: 'PPh Final UMKM (0.5%)',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true,
				useThreshold500Juta: true,
				thresholdAmount: 500000000
			}
		]
	};
	await modalDb.db
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nilai) VALUES ('pajak1', 'samarinda', 'pajak_config', ?)`
		)
		.bind(JSON.stringify({ schema_version: 2, revision: 1, settings: taxSettings }))
		.run();
	await modalDb.db.batch([
		modalDb.db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('usaha1', 'samarinda', '2026-09-10T02:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 400000000, 1, 'tx-usaha')`
		),
		modalDb.db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('modal1', 'samarinda', '2026-09-10T02:00:00.000Z', 'catat', 'in', 'lainnya', 200000000, 1, 'tx-modal')`
		),
		modalDb.db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('prive1', 'samarinda', '2026-09-10T03:00:00.000Z', 'catat', 'out', 'lainnya', 50000000, 1, 'tx-prive')`
		)
	]);
	const modal = await fetchReportDataSql(modalDb.db, 'samarinda', '2026-09-01', '2026-09-30');
	const modalCanonical = await buildLaporanAggregate(
		modalDb.db,
		branchContext('samarinda'),
		'2026-09-01',
		'2026-09-30'
	);
	assert.equal(modal.serverReportData.summary?.pajak, 0);
	assert.equal(modalCanonical.taxContext?.omzetUsaha, 400000000);
	assert.equal(modal.serverReportData.summary?.pendapatan, 600000000);
	// Prive bukan beban usaha: beban kanonik kosong walau kas keluar 50jt.
	assert.deepEqual(
		modalCanonical.bebanUsaha.map((b) => b.nominal),
		[]
	);
	console.log('ai-report-tests: modal bukan omzet passed');
} finally {
	await modalDb.close();
}

// AUD-038: sesi terkini ikut periode WITA, bukan hari ini.
// Sesi lama buka 22:00 WITA 1 Agu tutup 01:00 WITA 2 Agu (lintas midnight
// ikut periode bukanya); sesi aktif hari ini kas 999999 di luar rentang.
const sesiDb = await createTestD1();
try {
	await sesiDb.db.batch([
		sesiDb.db.prepare(
			`INSERT INTO sesi_toko (id, cabang_id, kas_awal, waktu_buka, waktu_tutup, is_active)
			 VALUES ('sesi-lama', 'samarinda', 50000, '2026-08-01T14:00:00.000Z', '2026-08-01T17:00:00.000Z', 0)`
		),
		sesiDb.db.prepare(
			`INSERT INTO sesi_toko (id, cabang_id, kas_awal, waktu_buka, waktu_tutup, is_active)
			 VALUES ('sesi-kini', 'samarinda', 999999, '2026-09-10T01:00:00.000Z', NULL, 1)`
		),
		sesiDb.db.prepare(
			`INSERT INTO buku_kas (id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id)
			 VALUES ('bk-agu', 'samarinda', '2026-08-01T15:00:00.000Z', 'catat', 'in', 'pendapatan_usaha', 1000, 1, 'tx-agu')`
		)
	]);
	const lama = await fetchReportDataSql(sesiDb.db, 'samarinda', '2026-08-01', '2026-08-31');
	assert.equal(lama.hasData, true);
	assert.equal(lama.serverReportData.sesiToko?.totalSesi, 1);
	assert.equal(lama.serverReportData.sesiToko?.sesiTerakhir?.kasAwal, 50000);
	assert.ok(
		String(lama.serverReportData.sesiToko?.sesiTerakhir?.waktuBuka || '').includes('2026-08-01')
	);
	// Rentang tanpa sesi: field diexclude, bukan sesi live.
	const kosong = await fetchReportDataSql(sesiDb.db, 'samarinda', '2026-09-01', '2026-09-09');
	assert.equal(kosong.serverReportData.sesiToko?.totalSesi, 0);
	assert.equal(kosong.serverReportData.sesiToko?.sesiTerakhir, undefined);
	// Rentang hari ini: sesi kini yang tampil.
	const kini = await fetchReportDataSql(sesiDb.db, 'samarinda', '2026-09-10', '2026-09-10');
	assert.equal(kini.serverReportData.sesiToko?.sesiTerakhir?.kasAwal, 999999);
	console.log('ai-report-tests: sesi periode historis passed');
} finally {
	await sesiDb.close();
}

// Gagal sumber merambat (bukan NO_DATA): tabel arsip hilang.
const broken = await createTestD1();
try {
	await broken.db.prepare(`DROP TABLE ringkasan_kas_arsip_harian`).run();
	await assert.rejects(fetchReportDataSql(broken.db, 'samarinda', '2026-09-09', '2026-09-12'));
	console.log('ai-report-tests: source error propagates passed');
} finally {
	await broken.close();
}
