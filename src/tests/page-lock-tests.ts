import assert from 'node:assert/strict';
import { GET as BUKU_KAS_GET } from '../routes/api/buku-kas/+server';
import { GET as SESI_TOKO_GET } from '../routes/api/sesi-toko/+server';
import { GET as TRANSAKSI_KASIR_GET } from '../routes/api/transaksi-kasir/+server';
import { GET as DASHBOARD_STATS_GET } from '../routes/api/dashboard/stats/+server';
import { GET as DASHBOARD_WEEKLY_GET } from '../routes/api/dashboard/weekly/+server';
import { GET as DASHBOARD_SELLERS_GET } from '../routes/api/dashboard/best-sellers/+server';
import { GET as DASHBOARD_HOURS_GET } from '../routes/api/dashboard/pos-kas-7hari/+server';
import { createTestD1 } from './helpers/testD1';

// Kunci PIN halaman (beranda/catat) tidak boleh bisa dilewati lewat endpoint data sebelah.
const { db, close } = await createTestD1();

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

async function status(
	handler: Handler,
	query: string,
	role: string,
	unlockedPages: string[] = []
): Promise<number> {
	try {
		const response = (await handler({
			url: new URL(`http://localhost/api/x?${query}`),
			platform: { env: { DB_SAMARINDA_GROUP: db } },
			locals: {
				authSession: {
					...session(role),
					unlockedPages,
					unlockExpiresAt: unlockedPages.length ? Date.now() + 60_000 : 0
				}
			}
		} as never)) as Response;
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
			 VALUES ('settings-lock', 'samarinda', NULL, 'hash-terkonfigurasi', '["beranda","catat"]')`
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
	await close();
}
