import assert from 'node:assert/strict';
import { GET as BUKU_KAS_GET } from '../routes/api/buku-kas/+server';
import { GET as SESI_TOKO_GET } from '../routes/api/sesi-toko/+server';
import { GET as TRANSAKSI_KASIR_GET } from '../routes/api/transaksi-kasir/+server';
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

async function status(handler: Handler, query: string, role: string): Promise<number> {
	try {
		const response = (await handler({
			url: new URL(`http://localhost/api/x?${query}`),
			platform: { env: { DB_SAMARINDA_GROUP: db } },
			locals: { authSession: session(role) }
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
