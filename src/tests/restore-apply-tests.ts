import assert from 'node:assert/strict';
import {
	buildRestoreSql,
	diffAgainstExisting,
	BK_FIELDS,
	TK_FIELDS
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { buildLaporanAggregate } from '../lib/server/reportQueries';

const { db, close } = await createTestD1();
const header = {
	id: 'bk',
	cabang_id: 'samarinda',
	waktu: '2025-12-01T01:00:00Z',
	sumber: 'catat',
	tipe: 'in',
	jenis: 'pendapatan_usaha',
	nominal: 40000,
	metode_bayar: 'tunai'
};
const archive = {
	meta: {
		schema_version: 2,
		archive_id: 'arc',
		branch: 'samarinda',
		counts: { buku_kas: 1, transaksi_kasir: 0 }
	},
	buku_kas: [header],
	transaksi_kasir: []
};
async function execute(input = archive) {
	const built = buildRestoreSql(input);
	return db.batch(built.statements.map((q) => db.prepare(q)));
}
async function reset() {
	await db.batch(
		[
			'DROP TRIGGER IF EXISTS fail_restore',
			...[
				'transaksi_kasir',
				'buku_kas',
				'pengaturan',
				'archive_jobs',
				'ringkasan_kas_arsip_harian',
				'ringkasan_penjualan_harian',
				'penjualan_produk_harian'
			].map((t) => `DELETE FROM ${t}`)
		].map((q) => db.prepare(q))
	);
	await db
		.prepare(
			"INSERT INTO ringkasan_kas_arsip_harian(id,cabang_id,archive_id,tanggal_wita,tipe,jenis,jumlah_transaksi,total_nominal,created_at) VALUES('sum','samarinda','arc','2025-12-01','in','pendapatan_usaha',1,40000,'2026-09-16')"
		)
		.run();
}
try {
	await reset();
	await execute();
	await execute();
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01')).summary.pendapatan,
		40000
	);
	// All content fields are compared, including payment, receipt, quantities and details.
	for (const field of BK_FIELDS) {
		assert.equal(
			diffAgainstExisting([header], new Map([['bk', { ...header, [field]: 'changed' }]]), BK_FIELDS)
				.conflict.length,
			1,
			field
		);
	}
	assert.equal(
		diffAgainstExisting(
			[{ id: 'tk', snapshot_tambahan: '[]' }],
			new Map([['tk', { id: 'tk', snapshot_tambahan: '[1]' }]]),
			TK_FIELDS
		).conflict.length,
		1
	);
	for (const change of ['metode_bayar', 'nominal']) {
		await reset();
		const builtBeforeConcurrentWrite = buildRestoreSql(archive);
		// A row appears AFTER the client preflight/generation but BEFORE atomic apply.
		await db
			.prepare(
				`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar) VALUES('bk','samarinda','2025-12-01T01:00:00Z','catat','in','pendapatan_usaha',?,?)`
			)
			.bind(change === 'nominal' ? 99999 : 40000, change === 'metode_bayar' ? 'non-tunai' : 'tunai')
			.run();
		await assert.rejects(() =>
			db.batch(builtBeforeConcurrentWrite.statements.map((q) => db.prepare(q)))
		);
		assert.equal(
			await db
				.prepare('SELECT total_nominal FROM ringkasan_kas_arsip_harian')
				.first('total_nominal'),
			40000
		);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM pengaturan').first('n'), 0);
	}
	await reset();
	await db
		.prepare(
			"CREATE TRIGGER fail_restore BEFORE INSERT ON buku_kas BEGIN SELECT RAISE(ABORT,'injected restore failure'); END"
		)
		.run();
	await assert.rejects(() => execute());
	assert.equal(
		await db.prepare('SELECT total_nominal FROM ringkasan_kas_arsip_harian').first('total_nominal'),
		40000
	);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0);
	await reset();
	const pos = { ...archive, buku_kas: [{ ...header, sumber: 'pos' }] };
	await assert.rejects(() => execute(pos)); // required retained POS summary missing
	assert.equal(
		await db.prepare('SELECT COUNT(*) AS n FROM ringkasan_kas_arsip_harian').first('n'),
		1
	);
	await db
		.prepare(
			"INSERT INTO ringkasan_penjualan_harian(id,cabang_id,tanggal_penjualan,jumlah_transaksi,jumlah_item,penjualan_kotor,penjualan_tunai) VALUES('day','samarinda','2025-12-01',1,1,40000,40000)"
		)
		.run();
	await execute(pos);
	await execute(pos);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01')).summary.pendapatan,
		40000
	);
	assert.throws(
		() => buildRestoreSql({ ...archive, buku_kas: [{ ...header, cabang_id: 'berau' }] }),
		/Cabang/
	);
	console.log(
		'restore-apply-tests: actual SQL normal/retry/full conflicts/preflight race/rollback/aggregates passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
