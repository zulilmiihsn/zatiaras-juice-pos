import assert from 'node:assert/strict';
import { DELETE as PRODUK_DELETE, PATCH as PRODUK_PATCH } from '../routes/api/produk/+server';
import { DELETE as KATEGORI_DELETE } from '../routes/api/kategori/+server';
import { DELETE as BAHAN_DELETE } from '../routes/api/bahan/+server';
import { POST as TAMBAHAN_POST } from '../routes/api/tambahan/+server';
import { createTestD1 } from './helpers/testD1';

// Route katalog: validasi field di server, dan hapus menu/kategori tanpa baris yatim.
const { db, close } = await createTestD1();

const owner = {
	id: 'session-pemilik',
	userId: 'pemilik-1',
	username: 'pemilik',
	role: 'pemilik',
	branch: 'samarinda',
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [],
	unlockExpiresAt: 0
};

async function del(handler: (event: never) => unknown, id: string): Promise<number> {
	try {
		const response = (await handler({
			url: new URL(`http://localhost/api/x?id=${id}`),
			platform: { env: { DB_SAMARINDA_GROUP: db } },
			locals: { authSession: owner }
		} as never)) as Response;
		return response.status;
	} catch (error) {
		const httpStatus = (error as { status?: number }).status;
		if (typeof httpStatus === 'number') return httpStatus;
		throw error;
	}
}

async function write(
	handler: (event: never) => unknown,
	method: string,
	body: unknown
): Promise<number> {
	try {
		const response = (await handler({
			url: new URL('http://localhost/api/x'),
			request: new Request('http://localhost/api/x', { method, body: JSON.stringify(body) }),
			platform: { env: { DB_SAMARINDA_GROUP: db } },
			locals: { authSession: owner }
		} as never)) as Response;
		return response.status;
	} catch (error) {
		const httpStatus = (error as { status?: number }).status;
		if (typeof httpStatus === 'number') return httpStatus;
		throw error;
	}
}

const count = (sql: string) => db.prepare(sql).first<number>('n');

try {
	await db.batch([
		db.prepare("INSERT INTO kategori (id, cabang_id, nama) VALUES ('kat-1', 'samarinda', 'Jus')"),
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, kategori_id, is_active)
			 VALUES ('p-1', 'samarinda', 'Jus Mangga', 10000, 'kat-1', 1)`
		),
		db.prepare(
			"INSERT INTO bahan (id, cabang_id, nama, satuan) VALUES ('b-1', 'samarinda', 'Mangga', 'gram')"
		),
		db.prepare(
			"INSERT INTO bahan (id, cabang_id, nama, satuan) VALUES ('b-yatim', 'samarinda', 'Jeruk', 'gram')"
		),
		db.prepare(
			`INSERT INTO resep_produk (id, cabang_id, produk_id, bahan_id, jumlah_per_item)
			 VALUES ('r-1', 'samarinda', 'p-1', 'b-1', 100),
			        ('r-yatim', 'samarinda', 'p-sudah-dihapus', 'b-yatim', 50)`
		)
	]);

	// Harga negatif/bukan angka dan nama kosong ditolak sebelum menyentuh DB.
	assert.equal(await write(TAMBAHAN_POST, 'POST', { payload: { nama: 'Keju', harga: -500 } }), 400);
	assert.equal(await write(TAMBAHAN_POST, 'POST', { payload: { nama: '  ', harga: 500 } }), 400);
	assert.equal(await write(TAMBAHAN_POST, 'POST', { payload: { nama: 'Keju', harga: 500 } }), 200);
	assert.equal(
		await write(PRODUK_PATCH, 'PATCH', { where: { id: 'p-1' }, payload: { harga: 'gratis' } }),
		400
	);
	assert.equal(
		await write(PRODUK_PATCH, 'PATCH', { where: { id: 'p-1' }, payload: { harga: 12000 } }),
		200
	);

	// Bahan yang masih dipakai resep menu aktif tetap dilindungi.
	assert.equal(await del(BAHAN_DELETE, 'b-1'), 409);
	// Resep yatim dari penghapusan produk lama tidak memblokir hapus bahan.
	assert.equal(await del(BAHAN_DELETE, 'b-yatim'), 200);

	// Hapus kategori: produk dilepas dan kategori terhapus dalam satu langkah.
	assert.equal(await del(KATEGORI_DELETE, 'kat-1'), 200);
	assert.equal(await count("SELECT COUNT(*) AS n FROM kategori WHERE id = 'kat-1'"), 0);
	assert.equal(
		await count("SELECT COUNT(*) AS n FROM produk WHERE id = 'p-1' AND kategori_id IS NULL"),
		1
	);

	// Hapus produk ikut menghapus resepnya, sehingga bahannya bisa dihapus.
	assert.equal(await del(PRODUK_DELETE, 'p-1'), 200);
	assert.equal(await count("SELECT COUNT(*) AS n FROM resep_produk WHERE produk_id = 'p-1'"), 0);
	assert.equal(await del(BAHAN_DELETE, 'b-1'), 200);

	console.log(
		'catalog-route-tests: field validation, recipes removed with product, atomic category delete'
	);
} finally {
	await close();
}
