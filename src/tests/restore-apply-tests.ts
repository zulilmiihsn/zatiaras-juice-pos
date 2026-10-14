import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeReceiptSnapshot } from '../lib/utils/receiptSnapshot.js';
import {
	buildRestoreChunks,
	diffAgainstExisting,
	BK_FIELDS,
	TK_FIELDS
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { applyRestoreFinal, applyRestorePlan, applyRestoreStages } from './helpers/restorePlan';
import { buildLaporanAggregate } from '../lib/server/reportQueries';
import { allocateNomorHarian } from '../lib/server/checkout/nomorHarian';

type RestoreArchive = Parameters<typeof buildRestoreChunks>[0];
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
	return applyRestorePlan(db, buildRestoreChunks(input));
}
async function reset() {
	await db.batch(
		[
			'DROP TRIGGER IF EXISTS fail_restore',
			'DROP TRIGGER IF EXISTS fail_restore_marker',
			...[
				'archive_restore_rows',
				'archive_restore_jobs',
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
			product_id: 'juice-fixture',
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

// Reproduced valid JSON is not a valid receipt or a valid business row.
const beforeMalformedPreflight = await snapshotRestoreState();
for (const change of [
	{ receipt_snapshot: 'null' },
	{ receipt_snapshot: '{}' },
	{ jumlah: 'not-a-quantity' },
	{ jumlah: true },
	{ created_at: 'not-a-date' },
	{ created_at: '2025-02-30T00:00:00Z' },
	{ preparation_completed_at: 'not-a-date' },
	{ stock_policy_mode: 'tracked', stock_policy_revision: true },
	{ preparation_revision: true },
	{ deskripsi: { invalid: 'object' } }
]) {
	const malformed: RestoreArchive = {
		...numberedArchive,
		meta: { ...numberedArchive.meta, schema_version: 3 },
		buku_kas: [{ ...numberedHeader, ...change }]
	};
	assert.throws(
		() => buildRestoreChunks(malformed),
		/tidak valid|Snapshot|Revision/,
		`Malformed archive accepted: ${Object.keys(change)}`
	);
}
const receiptForValidation = JSON.parse(numberedReceiptSnapshot) as {
	total_amount: unknown;
	items: Array<{ jumlah: unknown; nominal: unknown }>;
};
for (const change of [
	{ ...receiptForValidation, total_amount: 50000 },
	{ ...receiptForValidation, change: 0 },
	{ ...receiptForValidation, settings: [] },
	{ ...receiptForValidation, items: [{ ...receiptForValidation.items[0], nominal: 30000 }] },
	{ ...receiptForValidation, items: [{ ...receiptForValidation.items[0], jumlah: true }] }
]) {
	assert.throws(
		() =>
			buildRestoreChunks({
				...numberedArchive,
				buku_kas: [{ ...numberedHeader, receipt_snapshot: JSON.stringify(change) }]
			}),
		/Snapshot|snapshot|struk/,
		'Malformed receipt totals/quantity accepted'
	);
}

for (const change of [
	{ jumlah: 1.5 },
	{ nominal: true },
	{ created_at: 'not-a-date' },
	{ snapshot_tambahan: 'null' },
	{ snapshot_hpp: 'not-json' }
]) {
	const malformed: RestoreArchive = {
		...numberedArchive,
		transaksi_kasir: [{ ...numberedArchive.transaksi_kasir![0], ...change }]
	};
	assert.throws(
		() => buildRestoreChunks(malformed),
		/tidak valid/,
		`Malformed detail accepted: ${Object.keys(change)}`
	);
}
assert.deepEqual(
	await snapshotRestoreState(),
	beforeMalformedPreflight,
	'Malformed whole-archive preflight changed live state'
);

function cliPreflightRegressions() {
	const directory = mkdtempSync(join(tmpdir(), 'zatiaras-restore-preflight-'));
	const file = join(directory, 'archive fixture.json');
	try {
		for (const [input, status, message] of [
			[numberedArchive, 0, /DRY RUN.*Validation complete/s],
			[
				{
					...numberedArchive,
					transaksi_kasir: [{ ...numberedArchive.transaksi_kasir![0], nominal: 40001 }]
				},
				1,
				/tidak cocok/
			],
			[
				{
					...numberedArchive,
					transaksi_kasir: [{ ...numberedArchive.transaksi_kasir![0], snapshot_hpp: '[]' }]
				},
				1,
				/snapshot_hpp.*tidak valid/
			]
		] as Array<[RestoreArchive, number, RegExp]>) {
			writeFileSync(file, JSON.stringify(input));
			const result = spawnSync(
				process.execPath,
				['scripts/restore-archive.mjs', '--file', file, '--dry-run'],
				{ encoding: 'utf8', timeout: 30000 }
			);
			assert.equal(result.status, status, result.stdout + result.stderr);
			assert.match(result.stdout + result.stderr, message);
			assert.doesNotMatch(
				result.stdout,
				/\[RESTORE\]/,
				'CLI dry-run must never enter target mutation'
			);
		}
		const mismatch = spawnSync(
			process.execPath,
			[
				'scripts/restore-archive.mjs',
				'--file',
				file,
				'--dry-run',
				'--expect-sha256',
				'0'.repeat(64)
			],
			{ encoding: 'utf8', timeout: 30000 }
		);
		assert.equal(mismatch.status, 1);
		assert.match(mismatch.stderr, /CHECKSUM MISMATCH/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

async function preflightInvariantRegressions() {
	await seedNumberedRestore();
	const before = await snapshotRestoreState();
	assert.doesNotThrow(() => buildRestoreChunks(numberedArchive), 'Positive canonical control');
	for (const change of [
		{ nominal: 40001 },
		{ jumlah: 3 },
		{ harga: 19000 },
		{ harga_dasar: 19000 },
		{ total_tambahan: 1 },
		{ transaction_id: 'different-sale' },
		{ snapshot_hpp: '[]' },
		{ snapshot_hpp: '{"total":true}' },
		{ snapshot_hpp: '{"total":12000,"ingredients":{}}' },
		{ snapshot_tambahan: '[{"nama":"Extra","harga":true}]' }
	]) {
		const malformed: RestoreArchive = {
			...numberedArchive,
			transaksi_kasir: [{ ...numberedArchive.transaksi_kasir![0], ...change }]
		};
		await assert.rejects(
			() => execute(malformed),
			/tidak valid|tidak cocok/,
			`Preflight accepted ${JSON.stringify(change)}`
		);
		assert.deepEqual(
			await snapshotRestoreState(),
			before,
			'Invalid whole-archive preflight changed live state'
		);
	}
	// Total alone cannot prove that the immutable receipt describes the restored lines.
	const changedReceipt = JSON.parse(numberedReceiptSnapshot) as {
		items: Array<{ product_id: string; harga: number }>;
	};
	changedReceipt.items[0].product_id = 'different-product';
	await assert.rejects(
		() =>
			execute({
				...numberedArchive,
				buku_kas: [{ ...numberedHeader, receipt_snapshot: JSON.stringify(changedReceipt) }]
			}),
		/tidak cocok|tidak valid/
	);
	assert.deepEqual(await snapshotRestoreState(), before);
	// Late invalid detail must reject the entire source, not commit its valid first sale.
	await assert.rejects(
		() =>
			execute({
				...numberedArchive,
				meta: { ...numberedArchive.meta, counts: { buku_kas: 2, transaksi_kasir: 2 } },
				buku_kas: [
					numberedHeader,
					{ ...numberedHeader, id: 'last-header', nomor_harian: 8, idempotency_key: 'last-key' }
				],
				transaksi_kasir: [
					numberedArchive.transaksi_kasir![0],
					{
						...numberedArchive.transaksi_kasir![0],
						id: 'last-detail',
						buku_kas_id: 'last-header',
						nominal: 40001
					}
				]
			}),
		/tidak valid|tidak cocok/
	);
	assert.deepEqual(await snapshotRestoreState(), before);
	assert.throws(
		() =>
			buildRestoreChunks({
				...numberedArchive,
				meta: { ...numberedArchive.meta, schema_version: 3, counts: undefined }
			}),
		/Counts/,
		'Current v3 must declare full source counts'
	);
	for (const change of [
		{ sumber: ['pos'] },
		{ jenis: ['pendapatan_usaha'] },
		{ stock_policy_mode: ['tracked'], stock_policy_revision: 0 },
		{ stock_replay_disposition: ['normal'] },
		{ nomor_harian: '0x07' }
	]) {
		await assert.rejects(
			() => execute({ ...numberedArchive, buku_kas: [{ ...numberedHeader, ...change }] }),
			/tidak valid/
		);
		assert.deepEqual(await snapshotRestoreState(), before);
	}
	// Both known current and explicit legacy snapshots stay exact; topping HPP is not in the base recipe snapshot.
	for (const version of [1, 2, 3]) {
		for (const hpp of [
			{ nominal_hpp: 12000.125, snapshot_hpp: '{"total":12000.125}' },
			{
				nominal_hpp: 13000.125,
				snapshot_hpp: JSON.stringify({
					product_id: 'juice-fixture',
					product_name: 'Jus fixture',
					porsi: 'reguler',
					jumlah: 2,
					hpp_per_item: 6000.0625,
					nominal_hpp: 12000.125,
					ingredients: [
						{
							bahan_id: 'ingredient-fixture',
							nama: 'Fixture',
							satuan: 'gram',
							jumlah_per_item: 2.1234,
							biaya_per_satuan: 3.4567
						}
					]
				})
			}
		]) {
			await seedNumberedRestore();
			await execute({
				...numberedArchive,
				meta: { ...numberedArchive.meta, schema_version: version },
				transaksi_kasir: [{ ...numberedArchive.transaksi_kasir![0], ...hpp }]
			});
			const detail = await db
				.prepare('SELECT nominal_hpp,snapshot_hpp FROM transaksi_kasir')
				.first();
			assert.deepEqual(detail && { ...detail }, hpp, 'Never round or rewrite historical HPP bytes');
		}
	}
	// Legacy NULL is unknown, not an instruction to synthesize a receipt/HPP from a catalog.
	await seedNumberedRestore();
	await execute({
		...numberedArchive,
		buku_kas: [{ ...numberedHeader, receipt_snapshot: null, jumlah: null }],
		transaksi_kasir: [
			{
				...numberedArchive.transaksi_kasir![0],
				harga: null,
				harga_dasar: null,
				total_tambahan: null,
				snapshot_hpp: null,
				snapshot_tambahan: null
			}
		]
	});
	assert.deepEqual(
		{ ...(await db.prepare('SELECT receipt_snapshot,jumlah FROM buku_kas').first()) },
		{ receipt_snapshot: null, jumlah: null }
	);
	// Preserve one-to-one receipt lines as a multiset, not database row order.
	const rawReceipt = JSON.parse(numberedReceiptSnapshot) as {
		items: Array<Record<string, unknown>>;
	};
	const splitReceipt = {
		...rawReceipt,
		items: [
			{ ...rawReceipt.items[0], jumlah: 1, nominal: 20000 },
			{ ...rawReceipt.items[0], jumlah: 1, nominal: 20000, gula: 'manis' }
		]
	};
	await seedNumberedRestore();
	await execute({
		...numberedArchive,
		meta: { ...numberedArchive.meta, counts: { buku_kas: 1, transaksi_kasir: 2 } },
		buku_kas: [{ ...numberedHeader, receipt_snapshot: JSON.stringify(splitReceipt) }],
		transaksi_kasir: [
			{ ...numberedArchive.transaksi_kasir![0], jumlah: 1, nominal: 20000, gula: 'manis' },
			{ ...numberedArchive.transaksi_kasir![0], id: 'second-line', jumlah: 1, nominal: 20000 }
		]
	});
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transaksi_kasir').first('n'), 2);
	// Optional legacy addon IDs are unknown, but conflicting known IDs must fail.
	const addonReceipt = {
		...rawReceipt,
		total_amount: 42000,
		change: 8000,
		items: [
			{
				...rawReceipt.items[0],
				harga: 21000,
				nominal: 42000,
				total_tambahan: 1000,
				tambahan: [{ id: 'known-addon', nama: 'Extra', harga: 1000 }]
			}
		]
	};
	const addonArchive = {
		...numberedArchive,
		buku_kas: [
			{ ...numberedHeader, nominal: 42000, receipt_snapshot: JSON.stringify(addonReceipt) }
		],
		transaksi_kasir: [
			{
				...numberedArchive.transaksi_kasir![0],
				harga: 21000,
				nominal: 42000,
				total_tambahan: 1000,
				snapshot_tambahan: '[{"nama":"Extra","harga":1000}]'
			}
		]
	};
	await seedNumberedRestore();
	await execute(addonArchive);
	const beforeAddonConflict = await snapshotRestoreState();
	await assert.rejects(
		() =>
			execute({
				...addonArchive,
				transaksi_kasir: [
					{
						...addonArchive.transaksi_kasir[0],
						snapshot_tambahan: '[{"id":"different-addon","nama":"Extra","harga":1000}]'
					}
				]
			}),
		/tidak cocok/
	);
	assert.deepEqual(await snapshotRestoreState(), beforeAddonConflict);
	// Unknown legacy identity must not greedily consume the only receipt line matching a known identity.
	const partialReceipt = {
		...rawReceipt,
		items: [
			{ ...rawReceipt.items[0], jumlah: 1, nominal: 20000 },
			{ ...rawReceipt.items[0], jumlah: 1, nominal: 20000, product_id: 'second-product' }
		]
	};
	await seedNumberedRestore();
	await db.batch([
		db.prepare(
			"UPDATE penjualan_produk_harian SET jumlah=1,penjualan_kotor=20000,penjualan_tunai=20000 WHERE id='product-day'"
		),
		db.prepare(
			"INSERT INTO penjualan_produk_harian(id,cabang_id,tanggal_penjualan,produk_id,nama_produk,jumlah,penjualan_kotor,penjualan_tunai,jumlah_transaksi) VALUES('custom-day','samarinda','2025-12-01','custom:Jus fixture','Jus fixture',1,20000,20000,1)"
		)
	]);
	await execute({
		...numberedArchive,
		meta: { ...numberedArchive.meta, counts: { buku_kas: 1, transaksi_kasir: 2 } },
		buku_kas: [{ ...numberedHeader, receipt_snapshot: JSON.stringify(partialReceipt) }],
		transaksi_kasir: [
			{
				...numberedArchive.transaksi_kasir![0],
				id: 'unknown-legacy-line',
				jumlah: 1,
				nominal: 20000,
				produk_id: null
			},
			{ ...numberedArchive.transaksi_kasir![0], jumlah: 1, nominal: 20000 }
		]
	});
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transaksi_kasir').first('n'), 2);
}

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

/** Job arsip selesai + ringkasan manualnya untuk archive_id terpisah dari 'arc'. */
async function seedSeparateArchive(archiveId: string) {
	await db
		.prepare(
			"INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,created_at,updated_at) SELECT ?,cabang_id,before_year,cutoff,'completed',owner_token,lease_expires_at,created_at,updated_at FROM archive_jobs WHERE id='arc'"
		)
		.bind(archiveId)
		.run();
	await db
		.prepare(
			"INSERT INTO ringkasan_kas_arsip_harian(id,cabang_id,archive_id,tanggal_wita,tipe,jenis,jumlah_transaksi,total_nominal,created_at) VALUES(?,'samarinda',?,'2025-12-01','in','pendapatan_usaha',1,40000,'2026-10-02')"
		)
		.bind(`${archiveId}-summary`, archiveId)
		.run();
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

async function stagedPosParityRegressions() {
	await seedNumberedRestore();
	await execute(numberedArchive);
	const protectedRows = async () => ({
		headers: (
			await db.prepare(`SELECT id,${BK_FIELDS.join(',')} FROM buku_kas ORDER BY id`).all()
		).results.map((row) => ({ ...row })),
		details: (
			await db.prepare(`SELECT id,${TK_FIELDS.join(',')} FROM transaksi_kasir ORDER BY id`).all()
		).results.map((row) => ({ ...row })),
		counter: await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'),
		report: (await buildLaporanAggregate(db, 'samarinda', '2025-12-01', '2025-12-01')).summary
	});
	const expected = await protectedRows();
	await seedNumberedRestore();
	const beforeStage = await snapshotRestoreState();
	const planned = buildRestoreChunks(numberedArchive, { now: '2026-10-07T00:00:00Z' }, 1);
	for (const stage of planned.chunks) {
		await db.batch(stage.statements.map((sql) => db.prepare(sql)));
		assert.deepEqual(await snapshotRestoreState(), beforeStage);
	}
	await assert.rejects(applyRestoreFinal(db, planned, ["SELECT json('late-pos-final-failure')"]));
	assert.deepEqual(await snapshotRestoreState(), beforeStage);
	await applyRestoreFinal(db, planned);
	assert.deepEqual(
		await protectedRows(),
		expected,
		'Atomic staged POS must retain every receipt/preparation/policy/provenance/number/HPP field and report parity'
	);
	const committed = await snapshotRestoreState();
	await applyRestorePlan(db, planned);
	assert.deepEqual(await snapshotRestoreState(), committed);
	await reset();
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
				buildRestoreChunks({ ...numberedArchive, buku_kas: [{ ...numberedHeader, ...malformed }] }),
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
				buildRestoreChunks({
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
				buildRestoreChunks({
					...numberedArchive,
					buku_kas: [{ ...numberedHeader, tanggal_nomor: date }]
				}),
			/Tanggal nomor row bk tidak valid/
		);
	}
	assert.throws(
		() =>
			buildRestoreChunks({
				...numberedArchive,
				buku_kas: [{ ...numberedHeader, sumber: 'catat' }]
			}),
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
		// Arsip terpisah: archive_id sama dengan isi lain sudah ditolak lebih awal
		// (RESTORE_SOURCE_CONFLICT); di sini yang diuji guard final atomik.
		await seedSeparateArchive('arc-conflict');
		const conflictingArchive = {
			...numberedArchive,
			meta: { ...numberedArchive.meta, archive_id: 'arc-conflict' },
			buku_kas: [{ ...numberedHeader, ...changed }]
		};
		assert.equal(
			diffAgainstExisting(conflictingArchive.buku_kas, new Map([['bk', existing]]), BK_FIELDS)
				.conflict.length,
			1
		);
		const before = await snapshotRestoreState();
		// Sentinel guard SQLite tampil sebagai "malformed JSON"; tahapnya yang dibuktikan:
		// staging lolos (tak ada konflik sumber), batch final atomik yang menolak.
		const conflictPlan = buildRestoreChunks(conflictingArchive);
		await applyRestoreStages(db, conflictPlan);
		await assert.rejects(() => applyRestoreFinal(db, conflictPlan));
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
		meta: { ...numberedArchive.meta, counts: { buku_kas: 2, transaksi_kasir: 2 } },
		buku_kas: [
			{
				...numberedHeader,
				id: 'first-in-batch',
				transaction_id: 'first-sale',
				idempotency_key: 'first-key',
				nomor_harian: 6
			},
			numberedHeader
		],
		transaksi_kasir: [
			{
				...numberedArchive.transaksi_kasir![0],
				id: 'first-detail',
				buku_kas_id: 'first-in-batch',
				transaction_id: 'first-sale'
			},
			numberedArchive.transaksi_kasir![0]
		]
	};
	assert.doesNotThrow(
		() => buildRestoreChunks(collisionArchive),
		'Collision must reach actual SQL, not fail preflight'
	);
	await assert.rejects(() => execute(collisionArchive), /UNIQUE constraint failed/);
	assert.deepEqual(await snapshotRestoreState(), collisionBefore);
	assert.throws(
		() =>
			buildRestoreChunks({
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
	// Arsip terpisah: jalur chunk (benar) menolak archive_id sama dengan isi berbeda.
	await seedSeparateArchive('arc-late');
	await db
		.prepare(
			"INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES('samarinda','2025-12-01',2)"
		)
		.run();
	const lateHeader = { ...numberedHeader, id: 'late-sale' };
	const lateArchive: RestoreArchive = {
		...numberedArchive,
		meta: { ...numberedArchive.meta, archive_id: 'arc-late' },
		buku_kas: [lateHeader],
		transaksi_kasir: numberedArchive.transaksi_kasir?.map((row) => ({
			...row,
			buku_kas_id: lateHeader.id
		}))
	};
	const built = buildRestoreChunks(lateArchive);
	const lateBefore = await snapshotRestoreState();
	try {
		await db
			.prepare(
				"CREATE TRIGGER fail_restore_marker BEFORE INSERT ON pengaturan WHEN NEW.kunci = 'archive_restore_arc-late' BEGIN SELECT CASE WHEN (SELECT terakhir FROM pos_nomor_harian WHERE cabang_id='samarinda' AND tanggal='2025-12-01')=7 THEN RAISE(ABORT, 'injected late restore failure') ELSE RAISE(ABORT, 'restore counter did not advance before marker') END; END"
			)
			.run();
		await assert.rejects(() => applyRestorePlan(db, built), /injected late restore failure/);
		assert.deepEqual(await snapshotRestoreState(), lateBefore);
		assert.equal(await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'), 2);
	} finally {
		await db.prepare('DROP TRIGGER IF EXISTS fail_restore_marker').run();
	}
}
try {
	cliPreflightRegressions();
	await preflightInvariantRegressions();
	await stagedPosParityRegressions();
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
		const builtBeforeConcurrentWrite = buildRestoreChunks(archive);
		// A row appears AFTER the client preflight/generation but BEFORE atomic apply.
		await db
			.prepare(
				`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar) VALUES('bk','samarinda','2025-12-01T01:00:00Z','catat','in','pendapatan_usaha',?,?)`
			)
			.bind(change === 'nominal' ? 99999 : 40000, change === 'metode_bayar' ? 'non-tunai' : 'tunai')
			.run();
		await assert.rejects(() => applyRestorePlan(db, builtBeforeConcurrentWrite));
		assert.equal(
			await db
				.prepare('SELECT total_nominal FROM ringkasan_kas_arsip_harian')
				.first('total_nominal'),
			40000
		);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM pengaturan').first('n'), 0);
	}
	// Baris identik sudah ada di live (dipulihkan arsip lain): job baru tetap menjalankan
	// guard + INSERT final di atas baris itu, sukses tanpa duplikat dan tanpa menimpa.
	await reset();
	await execute();
	const firstRestore = await db.prepare('SELECT * FROM buku_kas').first();
	await seedSeparateArchive('arc-identical');
	await execute({ ...archive, meta: { ...archive.meta, archive_id: 'arc-identical' } });
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
	assert.deepEqual(await db.prepare('SELECT * FROM buku_kas').first(), firstRestore);
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
		() => buildRestoreChunks({ ...archive, buku_kas: [{ ...header, cabang_id: 'berau' }] }),
		/Cabang/
	);
	assert.throws(
		() =>
			buildRestoreChunks({
				...archive,
				buku_kas: [{ ...header, stock_policy_mode: 'ignored', stock_policy_revision: null }]
			}),
		/Pasangan policy/
	);
	// Preflight seluruh field bisnis — invalid = zero live-ledger changes.
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
			() => buildRestoreChunks({ ...archive, buku_kas: [{ ...header, ...mutate }] }),
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
		() => buildRestoreChunks({ ...archive, buku_kas: [{ id: 'tanpa-nominal' }] }),
		/Nominal/,
		'field hilang'
	);
	await reset();
	assert.throws(
		() =>
			buildRestoreChunks({
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
		assert.throws(
			() => buildRestoreChunks({ ...archive, transaksi_kasir: [detail] }),
			pattern,
			name
		);
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
