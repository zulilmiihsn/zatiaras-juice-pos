import assert from 'node:assert/strict';
import { decodeReceiptSnapshot } from '../lib/utils/receiptSnapshot.js';
import {
	buildRestoreSql,
	diffAgainstExisting,
	BK_FIELDS,
	TK_FIELDS
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { buildLaporanAggregate } from '../lib/server/reportQueries';
import { allocateNomorHarian } from '../lib/server/checkout/nomorHarian';

type RestoreArchive = Parameters<typeof buildRestoreSql>[0];
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
async function execute(input: RestoreArchive = archive) {
	const built = buildRestoreSql(input);
	return db.batch(built.statements.map((q) => db.prepare(q)));
}
async function reset() {
	await db.batch(
		[
			'DROP TRIGGER IF EXISTS fail_restore',
			'DROP TRIGGER IF EXISTS fail_restore_marker',
			...[
				'transaksi_kasir',
				'buku_kas',
				'pengaturan',
				'archive_jobs',
				'pos_nomor_harian',
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

const numberedReceiptSnapshot = JSON.stringify({
	schema_version: 1,
	items: [
		{
			product_id: 'product-fixture',
			nama: 'Jus fixture',
			jumlah: 2,
			harga: 20_000,
			nominal: 40_000,
			harga_dasar: 20_000,
			total_tambahan: 0,
			tambahan: [],
			gula: null,
			es: null,
			catatan: null
		}
	],
	total_amount: 40_000,
	total_qty: 2,
	cash_received: 50_000,
	change: 10_000,
	metode_bayar: 'tunai',
	committed_at: '2025-12-01T01:00:00.000Z',
	customer_name: 'Fixture customer',
	settings: { nama_toko: 'Fixture at sale', alamat: 'Old address', ucapan: 'Thank you' }
});

const numberedHeader = {
	...header,
	sumber: 'pos',
	jumlah: 2,
	transaction_id: 'sale-restore',
	idempotency_key: 'restore-sale-key',
	receipt_snapshot: numberedReceiptSnapshot,
	preparation_state: 'done',
	preparation_revision: 3,
	preparation_completed_at: '2025-12-01T01:05:00.000Z',
	preparation_completed_by: 'kasir-fixture',
	nomor_harian: 7,
	tanggal_nomor: '2025-12-01',
	created_at: '2025-12-01T01:00:00Z'
};
const numberedArchive: RestoreArchive = {
	...archive,
	meta: { ...archive.meta, counts: { buku_kas: 1, transaksi_kasir: 1 } },
	buku_kas: [numberedHeader],
	transaksi_kasir: [
		{
			id: 'tk-numbered',
			cabang_id: 'samarinda',
			buku_kas_id: 'bk',
			produk_id: 'juice-fixture',
			nama_produk: 'Jus fixture',
			jumlah: 2,
			nominal: 40000,
			harga: 20000,
			harga_dasar: 20000,
			total_tambahan: 0,
			snapshot_tambahan: '[]',
			nominal_hpp: 12000,
			snapshot_hpp: '{"total":12000}',
			transaction_id: 'sale-restore',
			created_at: '2025-12-01T01:00:00Z'
		}
	]
};

async function seedNumberedRestore() {
	await reset();
	await db.batch(
		[
			"UPDATE ringkasan_kas_arsip_harian SET archive_id='other-arc' WHERE id='sum'",
			"INSERT INTO ringkasan_penjualan_harian(id,cabang_id,tanggal_penjualan,jumlah_transaksi,jumlah_item,penjualan_kotor,penjualan_tunai,total_hpp) VALUES('day','samarinda','2025-12-01',1,2,40000,40000,12000)",
			"INSERT INTO penjualan_produk_harian(id,cabang_id,tanggal_penjualan,produk_id,nama_produk,jumlah,penjualan_kotor,penjualan_tunai,jumlah_transaksi) VALUES('product-day','samarinda','2025-12-01','juice-fixture','Jus fixture',2,40000,40000,1)",
			"INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,created_at,updated_at) VALUES('arc','samarinda',2026,'2026-01-01','completed','restore-fixture',0,'2026-10-02T00:00:00Z','2026-10-02T00:00:00Z')"
		].map((q) => db.prepare(q))
	);
}

async function snapshotRestoreState() {
	const tables = [
		'buku_kas',
		'transaksi_kasir',
		'pos_nomor_harian',
		'ringkasan_kas_arsip_harian',
		'ringkasan_penjualan_harian',
		'penjualan_produk_harian',
		'pengaturan',
		'archive_jobs'
	];
	return Object.fromEntries(
		await Promise.all(
			tables.map(async (table) => {
				const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
				return [table, results.map((row) => ({ ...row }))];
			})
		)
	);
}

async function numberedRestoreRegressions() {
	// Modern restore preserves the permanent sale identity and completion/receipt content.
	for (const initialCounter of [null, 12]) {
		await seedNumberedRestore();
		if (initialCounter !== null) {
			await db
				.prepare(
					"INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES('samarinda','2025-12-01',?)"
				)
				.bind(initialCounter)
				.run();
		}
		const summaryBefore = await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01');
		await execute(numberedArchive);
		await execute(numberedArchive);
		const restored = await db
			.prepare(
				'SELECT id,transaction_id,idempotency_key,nomor_harian,tanggal_nomor,receipt_snapshot,nominal,jumlah,preparation_state,preparation_revision,preparation_completed_at,preparation_completed_by FROM buku_kas'
			)
			.first();
		assert.deepEqual(
			restored && { ...restored },
			Object.fromEntries(
				Object.keys(restored ?? {}).map((key) => [
					key,
					numberedHeader[key as keyof typeof numberedHeader]
				])
			),
			'Modern daily number and permanent sale content must survive restore/retry'
		);
		const restoredReceipt = decodeReceiptSnapshot(restored?.receipt_snapshot);
		assert.equal(restoredReceipt?.total_amount, 40_000, 'receipt total survives archive restore');
		assert.equal(restoredReceipt?.cash_received, 50_000, 'cash received survives archive restore');
		assert.equal(restoredReceipt?.change, 10_000, 'change survives archive restore');
		assert.equal(restoredReceipt?.settings?.nama_toko, 'Fixture at sale');
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transaksi_kasir').first('n'), 1);
		const detail = await db
			.prepare('SELECT jumlah,nominal,harga,snapshot_hpp,nominal_hpp FROM transaksi_kasir')
			.first();
		assert.deepEqual(detail && { ...detail }, {
			jumlah: 2,
			nominal: 40000,
			harga: 20000,
			snapshot_hpp: '{"total":12000}',
			nominal_hpp: 12000
		});
		assert.deepEqual(
			await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01'),
			summaryBefore
		);
		const expectedCounter = initialCounter ?? 7;
		assert.equal(
			await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'),
			expectedCounter
		);
		assert.equal(await allocateNomorHarian(db, 'samarinda', '2025-12-01'), expectedCounter + 1);
		assert.equal(
			await db.prepare("SELECT status FROM archive_jobs WHERE id='arc'").first('status'),
			'restored'
		);
	}

	// Legacy data stays unnumbered and never causes counter allocation.
	for (const legacyFields of [{}, { nomor_harian: null, tanggal_nomor: null }]) {
		await seedNumberedRestore();
		const { nomor_harian: _number, tanggal_nomor: _date, ...legacyHeader } = numberedHeader;
		await execute({ ...numberedArchive, buku_kas: [{ ...legacyHeader, ...legacyFields }] });
		const legacy = await db.prepare('SELECT nomor_harian,tanggal_nomor FROM buku_kas').first();
		assert.deepEqual(legacy && { ...legacy }, { nomor_harian: null, tanggal_nomor: null });
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM pos_nomor_harian').first('n'), 0);
	}

	await seedNumberedRestore();
	const beforeInvalid = await snapshotRestoreState();
	for (const malformed of [{ nomor_harian: null }, { tanggal_nomor: undefined }]) {
		assert.throws(
			() =>
				buildRestoreSql({ ...numberedArchive, buku_kas: [{ ...numberedHeader, ...malformed }] }),
			/Pasangan nomor harian row bk tidak lengkap/
		);
	}
	for (const nomor of [
		0,
		-1,
		1.5,
		Infinity,
		NaN,
		'',
		'   ',
		'no-number',
		true,
		{},
		Number.MAX_SAFE_INTEGER + 1
	]) {
		assert.throws(
			() =>
				buildRestoreSql({
					...numberedArchive,
					buku_kas: [{ ...numberedHeader, nomor_harian: nomor }]
				}),
			/Nomor harian row bk tidak valid/
		);
	}
	for (const date of [
		'2026-02-30',
		'2025-02-29',
		'2026-13-01',
		'2026-1-01',
		'2026-10-02T00:00:00Z',
		20261002
	]) {
		assert.throws(
			() =>
				buildRestoreSql({
					...numberedArchive,
					buku_kas: [{ ...numberedHeader, tanggal_nomor: date }]
				}),
			/Tanggal nomor row bk tidak valid/
		);
	}
	assert.throws(
		() =>
			buildRestoreSql({ ...numberedArchive, buku_kas: [{ ...numberedHeader, sumber: 'catat' }] }),
		/Nomor harian row bk hanya untuk POS/
	);
	assert.deepEqual(await snapshotRestoreState(), beforeInvalid);
	for (const nomor of ['007', 1000]) {
		await seedNumberedRestore();
		await execute({ ...numberedArchive, buku_kas: [{ ...numberedHeader, nomor_harian: nomor }] });
		assert.equal(
			await db.prepare('SELECT nomor_harian FROM buku_kas').first('nomor_harian'),
			Number(nomor)
		);
		assert.equal(
			await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'),
			Number(nomor)
		);
	}

	// Preflight and atomic guards both reject changing official numbers on the same sale.
	for (const changed of [{ nomor_harian: 8 }, { tanggal_nomor: '2025-12-02' }]) {
		await seedNumberedRestore();
		await execute(numberedArchive);
		const existing = await db.prepare('SELECT * FROM buku_kas').first<Record<string, unknown>>();
		assert.ok(existing);
		const conflictingArchive = {
			...numberedArchive,
			buku_kas: [{ ...numberedHeader, ...changed }]
		};
		assert.equal(
			diffAgainstExisting(conflictingArchive.buku_kas, new Map([['bk', existing]]), BK_FIELDS)
				.conflict.length,
			1
		);
		const before = await snapshotRestoreState();
		await assert.rejects(() => execute(conflictingArchive));
		assert.deepEqual(await snapshotRestoreState(), before);
	}

	// A collision at INSERT must roll back earlier header/detail and archive cleanup.
	await seedNumberedRestore();
	await db
		.prepare(
			"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,nomor_harian,tanggal_nomor,stock_policy_mode,stock_policy_revision) VALUES('collision','samarinda','2025-12-01T02:00:00Z','pos','in','pendapatan_usaha',9000,7,'2025-12-01','tracked',0)"
		)
		.run();
	await db
		.prepare(
			"INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES('samarinda','2025-12-01',2)"
		)
		.run();
	const collisionBefore = await snapshotRestoreState();
	const collisionArchive: RestoreArchive = {
		...numberedArchive,
		meta: { ...numberedArchive.meta, counts: { buku_kas: 2, transaksi_kasir: 1 } },
		buku_kas: [
			{ ...numberedHeader, id: 'first-in-batch', idempotency_key: 'first-key', nomor_harian: 6 },
			numberedHeader
		]
	};
	await assert.rejects(() => execute(collisionArchive));
	assert.deepEqual(await snapshotRestoreState(), collisionBefore);
	assert.throws(
		() =>
			buildRestoreSql({
				...numberedArchive,
				meta: { ...numberedArchive.meta, counts: { buku_kas: 2, transaksi_kasir: 1 } },
				buku_kas: [
					numberedHeader,
					{ ...numberedHeader, id: 'duplicate-number', nomor_harian: '007' }
				]
			}),
		/Nomor harian duplikat dalam arsip: samarinda\/2025-12-01\/7/
	);

	// This failure is after INSERTs and counter advancement, not the preflight guard.
	await seedNumberedRestore();
	await execute(archive);
	await db.prepare("UPDATE archive_jobs SET status='completed' WHERE id='arc'").run();
	await db
		.prepare(
			"INSERT INTO ringkasan_kas_arsip_harian(id,cabang_id,archive_id,tanggal_wita,tipe,jenis,jumlah_transaksi,total_nominal,created_at) VALUES('late-summary','samarinda','arc','2025-12-01','in','pendapatan_usaha',1,40000,'2026-10-02')"
		)
		.run();
	await db
		.prepare(
			"INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES('samarinda','2025-12-01',2)"
		)
		.run();
	const lateHeader = { ...numberedHeader, id: 'late-sale' };
	const lateArchive: RestoreArchive = {
		...numberedArchive,
		buku_kas: [lateHeader],
		transaksi_kasir: numberedArchive.transaksi_kasir?.map((row) => ({
			...row,
			buku_kas_id: lateHeader.id
		}))
	};
	const built = buildRestoreSql(lateArchive);
	const lateBefore = await snapshotRestoreState();
	try {
		await db
			.prepare(
				"CREATE TRIGGER fail_restore_marker BEFORE INSERT ON pengaturan WHEN NEW.kunci = 'archive_restore_arc' BEGIN SELECT CASE WHEN (SELECT terakhir FROM pos_nomor_harian WHERE cabang_id='samarinda' AND tanggal='2025-12-01')=7 THEN RAISE(ABORT, 'injected late restore failure') ELSE RAISE(ABORT, 'restore counter did not advance before marker') END; END"
			)
			.run();
		await assert.rejects(
			() => db.batch(built.statements.map((q) => db.prepare(q))),
			/injected late restore failure/
		);
		assert.deepEqual(await snapshotRestoreState(), lateBefore);
		assert.equal(await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'), 2);
	} finally {
		await db.prepare('DROP TRIGGER IF EXISTS fail_restore_marker').run();
	}
}
try {
	await reset();
	await execute();
	await execute();
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
	assert.equal(
		await db.prepare('SELECT restored_from_archive FROM buku_kas').first('restored_from_archive'),
		1
	);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01')).summary.pendapatan,
		40000
	);
	// Receipt/payment changes must conflict rather than silently overwrite a sale.
	for (const changed of [{ metode_bayar: 'non-tunai' }, { receipt_snapshot: '{"total":1}' }]) {
		assert.equal(
			diffAgainstExisting([header], new Map([['bk', { ...header, ...changed }]]), BK_FIELDS)
				.conflict.length,
			1
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
	assert.throws(
		() =>
			buildRestoreSql({
				...archive,
				buku_kas: [{ ...header, stock_policy_mode: 'ignored', stock_policy_revision: null }]
			}),
		/Pasangan policy/
	);
	// AUD-042: preflight seluruh field bisnis — invalid = zero live-ledger changes.
	for (const [name, mutate, pattern] of [
		['not-a-date', { waktu: 'not-a-date' }, /Waktu/],
		['credit', { tipe: 'credit' }, /Tipe/],
		['pairing', { jenis: 'beban_usaha' }, /Pasangan tipe\/jenis/],
		['sumber', { sumber: 'inventaris' }, /Sumber/],
		['negatif', { nominal: -100 }, /Nominal/],
		['nan', { nominal: 'bukan-angka' }, /Nominal/],
		['receipt-rusak', { receipt_snapshot: '{rusak' }, /Snapshot struk/]
	] as Array<[string, Record<string, unknown>, RegExp]>) {
		await reset();
		assert.throws(
			() => buildRestoreSql({ ...archive, buku_kas: [{ ...header, ...mutate }] }),
			pattern,
			name
		);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0, name);
		assert.equal(
			await db.prepare('SELECT COUNT(*) AS n FROM ringkasan_kas_arsip_harian').first('n'),
			1,
			name
		);
	}
	await reset();
	assert.throws(
		() => buildRestoreSql({ ...archive, buku_kas: [{ id: 'tanpa-nominal' }] }),
		/Nominal/,
		'field hilang'
	);
	await reset();
	assert.throws(
		() =>
			buildRestoreSql({
				...archive,
				meta: { ...archive.meta, counts: { buku_kas: 99, transaksi_kasir: 0 } }
			}),
		/Counts/,
		'count mismatch'
	);
	// Detail invalid (orphan/qty/cabang) juga zero-change.
	for (const [name, detail, pattern] of [
		['orphan', { id: 'tk', jumlah: 1, nominal: 100 }, /Orphan/],
		['qty-nol', { id: 'tk', buku_kas_id: 'bk', jumlah: 0, nominal: 100 }, /Jumlah/],
		[
			'cabang-detail',
			{ id: 'tk', buku_kas_id: 'bk', cabang_id: 'berau', jumlah: 1, nominal: 100 },
			/Cabang detail/
		]
	] as Array<[string, Record<string, unknown>, RegExp]>) {
		await reset();
		assert.throws(() => buildRestoreSql({ ...archive, transaksi_kasir: [detail] }), pattern, name);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 0, name);
	}
	// Rp100000 valid terlihat benar di laporan setelah restore.
	await reset();
	await db
		.prepare('UPDATE ringkasan_kas_arsip_harian SET total_nominal = 100000 WHERE id = ?')
		.bind('sum')
		.run();
	const validSeratus = {
		...archive,
		meta: { ...archive.meta, counts: { buku_kas: 1, transaksi_kasir: 0 } },
		buku_kas: [{ ...header, id: 'bk100', nominal: 100000 }],
		transaksi_kasir: []
	};
	await execute(validSeratus);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01')).summary.pendapatan,
		100000
	);
	await numberedRestoreRegressions();
	console.log(
		'restore-apply-tests: actual SQL retry/parity/number validation/counters/collision/late rollback/aggregates passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
