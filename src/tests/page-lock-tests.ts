import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { GET as BUKU_KAS_GET } from '../routes/api/buku-kas/+server';
import { GET as SESI_TOKO_GET } from '../routes/api/sesi-toko/+server';
import { GET as TRANSAKSI_KASIR_GET } from '../routes/api/transaksi-kasir/+server';
import { GET as DASHBOARD_STATS_GET } from '../routes/api/dashboard/stats/+server';
import { GET as DASHBOARD_WEEKLY_GET } from '../routes/api/dashboard/weekly/+server';
import { GET as DASHBOARD_SELLERS_GET } from '../routes/api/dashboard/best-sellers/+server';
import { GET as DASHBOARD_HOURS_GET } from '../routes/api/dashboard/pos-kas-7hari/+server';
import { GET as ORDER_HISTORY_GET } from '../routes/api/pos/history/+server';
import { createTestD1 } from './helpers/testD1';

// Kunci PIN halaman (beranda/catat) tidak boleh bisa dilewati lewat endpoint data sebelah.
const { db, close } = await createTestD1();
mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T04:00:00.000Z') });

function session(role: string) {
	return {
		id: `session-${role}`,
		userId: `${role}-1`,
		username: role,
		role,
		branch: 'samarinda',
		createdAt: 0,
		expiresAt: Date.now() + 60_000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}

type Handler = (event: never) => unknown;

function event(query: string, role: string | null, unlockedPages: string[] = []) {
	return {
		url: new URL(`http://localhost/api/x?${query}`),
		platform: { env: { DB_SAMARINDA_GROUP: db } },
		locals: {
			authSession: role
				? {
						...session(role),
						unlockedPages,
						unlockExpiresAt: unlockedPages.length ? Date.now() + 60_000 : 0
					}
				: null
		}
	} as never;
}

async function status(
	handler: Handler,
	query: string,
	role: string | null,
	unlockedPages: string[] = []
): Promise<number> {
	try {
		const response = (await handler(event(query, role, unlockedPages))) as Response;
		return response.status;
	} catch (error) {
		const httpStatus = (error as { status?: number }).status;
		if (typeof httpStatus === 'number') return httpStatus;
		throw error;
	}
}

try {
	await db
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, pin_hash, halaman_terkunci)
			 VALUES ('settings-lock', 'samarinda', NULL, 'hash-terkonfigurasi', '["beranda","catat","pengaturan"]')`
		)
		.run();
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO sesi_toko (id, cabang_id, kas_awal, waktu_buka, waktu_tutup, is_active, created_at, updated_at)
			 VALUES ('sesi-lama', 'samarinda', 0, ?, ?, 0, ?, ?), ('sesi-aktif', 'samarinda', 0, ?, NULL, 1, ?, ?)`
		)
		.bind(now, now, now, now, now, now, now)
		.run();

	// Laci shift berjalan tetap terbaca kasir (buka/tutup toko).
	assert.equal(await status(SESI_TOKO_GET, 'summary=1&id=sesi-aktif', 'kasir'), 200);
	assert.equal(await status(BUKU_KAS_GET, 'id_sesi_toko=sesi-aktif', 'kasir'), 200);
	// Cetak ulang struk per transaksi tidak memerlukan PIN.
	assert.equal(await status(TRANSAKSI_KASIR_GET, 'transaction_id=trx-1', 'kasir'), 200);

	// Operational order history stays usable even when the financial pages require the owner's PIN.
	const fixtures = [
		['order-today-b', 'samarinda', '2026-10-23T05:00:00.000Z', 'pos', 'in', 'qris', 'Rina Beta'],
		['order-today-a', 'samarinda', '2026-10-23T04:00:00.000Z', 'pos', 'in', 'tunai', 'Rina Alpha'],
		[
			'order-yesterday',
			'samarinda',
			'2026-10-21T20:00:00.000Z',
			'pos',
			'in',
			'tunai',
			'Riwayat Kemarin'
		],
		[
			'order-week-start',
			'samarinda',
			'2026-10-16T16:00:00.000Z',
			'pos',
			'in',
			'tunai',
			'Batas Tujuh Hari'
		],
		[
			'order-too-old',
			'samarinda',
			'2026-10-16T15:59:59.999Z',
			'pos',
			'in',
			'tunai',
			'Tidak Terbaca'
		],
		[
			'order-next-day',
			'samarinda',
			'2026-10-23T16:00:00.000Z',
			'pos',
			'in',
			'tunai',
			'Hari Berikutnya'
		],
		[
			'manual-private',
			'samarinda',
			'2026-10-23T05:30:00.000Z',
			'catat',
			'in',
			'tunai',
			'Keuangan Pemilik'
		],
		[
			'outgoing-private',
			'samarinda',
			'2026-10-23T05:30:00.000Z',
			'pos',
			'out',
			'tunai',
			'Pengeluaran'
		],
		[
			'other-branch-private',
			'balikpapan',
			'2026-10-23T05:30:00.000Z',
			'pos',
			'in',
			'tunai',
			'Cabang Lain'
		]
	];
	for (const [id, branch, waktu, sumber, tipe, metode, nama] of fixtures) {
		await db
			.prepare(
				`INSERT INTO buku_kas
			(id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id, deskripsi, nama_pelanggan, metode_bayar, mutation_token, request_fingerprint, stock_policy_mode, stock_policy_revision)
			VALUES (?, ?, ?, ?, ?, 'penjualan', 25000, ?, ?, ?, ?, 'internal-cas-marker', 'internal-fingerprint', 'tracked', 0)`
			)
			.bind(id, branch, waktu, sumber, tipe, id, nama, nama, metode)
			.run();
	}
	type OrderPage = {
		data: Array<Record<string, unknown>>;
		hasMore: boolean;
		nextCursor: string | null;
	};
	async function orders(query = '', role = 'kasir'): Promise<OrderPage> {
		const response = await ORDER_HISTORY_GET(event('pagination=cursor&' + query, role));
		assert.equal(response.status, 200);
		return (await response.json()) as OrderPage;
	}
	const today = await orders();
	assert.deepEqual(
		today.data.map((row) => row.id),
		['order-today-b', 'order-today-a']
	);
	for (const row of today.data) {
		assert.equal(row.sumber, 'pos');
		assert.equal(row.tipe, 'in');
		for (const field of [
			'mutation_token',
			'request_fingerprint',
			'id_sesi_toko',
			'stock_policy_revision'
		])
			assert.equal(Object.hasOwn(row, field), false, 'internal ledger fields stay private');
	}
	assert.deepEqual(
		(await orders('rentang=7-hari')).data.map((row) => row.id),
		['order-today-b', 'order-today-a', 'order-yesterday', 'order-week-start']
	);
	assert.deepEqual(
		(await orders('search=Alpha')).data.map((row) => row.id),
		['order-today-a']
	);
	assert.deepEqual(
		(await orders('metode=qris')).data.map((row) => row.id),
		['order-today-b']
	);
	const first = await orders('limit=1');
	assert.equal(first.hasMore, true);
	assert.ok(first.nextCursor);
	const next = await orders('limit=1&cursor=' + encodeURIComponent(first.nextCursor));
	assert.deepEqual(
		next.data.map((row) => row.id),
		['order-today-a']
	);
	assert.equal(next.hasMore, false);
	assert.equal(next.nextCursor, null);
	assert.equal(await status(ORDER_HISTORY_GET, '', null), 401);
	assert.equal(await status(ORDER_HISTORY_GET, '', 'staff'), 403);
	assert.equal(await status(ORDER_HISTORY_GET, 'branch=berau', 'kasir'), 403);
	for (const query of [
		'rentang=semua',
		'start=2000-01-01',
		'sumber=catat',
		'tipe=out',
		'id_sesi_toko=sesi-aktif',
		'limit=201',
		'limit=0',
		'cursor=invalid',
		'metode=asing',
		'pagination=semua'
	]) {
		assert.equal(await status(ORDER_HISTORY_GET, query, 'kasir'), 400, query);
	}
	for (const role of ['pemilik', 'admin'])
		assert.equal(await status(ORDER_HISTORY_GET, '', role), 200);
	assert.equal(await status(BUKU_KAS_GET, 'pagination=cursor', 'kasir'), 403);
	assert.equal(await status(BUKU_KAS_GET, 'sumber=pos&pagination=cursor', 'kasir'), 403);
	const concurrent = await Promise.all([
		orders('metode=tunai'),
		orders('metode=qris'),
		orders('rentang=7-hari')
	]);
	assert.deepEqual(
		concurrent[0].data.map((row) => row.id),
		['order-today-a']
	);
	assert.deepEqual(
		concurrent[1].data.map((row) => row.id),
		['order-today-b']
	);
	assert.equal(concurrent[2].data.length, 4);

	// Shift lain dan daftar rentang adalah data omzet: terkunci untuk kasir.
	assert.equal(await status(SESI_TOKO_GET, 'summary=1&id=sesi-lama', 'kasir'), 403);
	assert.equal(await status(BUKU_KAS_GET, 'id_sesi_toko=sesi-lama', 'kasir'), 403);
	assert.equal(
		await status(
			TRANSAKSI_KASIR_GET,
			'start=2026-01-01T00:00:00.000Z&end=2027-01-01T00:00:00.000Z',
			'kasir'
		),
		403
	);

	// Dashboard hanya terbuka untuk sesi yang memiliki akses beranda pada cabangnya.
	for (const handler of [
		DASHBOARD_STATS_GET,
		DASHBOARD_WEEKLY_GET,
		DASHBOARD_SELLERS_GET,
		DASHBOARD_HOURS_GET
	]) {
		const range = 'start=2026-10-01T00:00:00.000Z&end=2026-10-07T23:59:59.000Z';
		assert.equal(await status(handler, range, 'kasir'), 403, 'dashboard stays locked before PIN');
		assert.equal(
			await status(handler, range, 'kasir', ['beranda']),
			200,
			'verified PIN unlocks dashboard reads'
		);
		assert.equal(
			await status(handler, range, 'kasir', ['catat']),
			403,
			'another page unlock is insufficient'
		);
		assert.equal(
			await status(handler, `branch=berau&${range}`, 'kasir', ['beranda']),
			403,
			'PIN cannot change branch scope'
		);
		assert.equal(await status(handler, range, 'pemilik'), 200, 'owner dashboard remains available');
	}
	// Pemilik tidak terkena kunci halaman.
	assert.equal(await status(SESI_TOKO_GET, 'summary=1&id=sesi-lama', 'pemilik'), 200);
	assert.equal(await status(BUKU_KAS_GET, 'id_sesi_toko=sesi-lama', 'pemilik'), 200);
	assert.equal(
		await status(
			TRANSAKSI_KASIR_GET,
			'start=2026-01-01T00:00:00.000Z&end=2027-01-01T00:00:00.000Z',
			'pemilik'
		),
		200
	);

	console.log('page-lock-tests: active shift open, other shifts and ranges locked for kasir');
} finally {
	mock.timers.reset();
	await close();
}
