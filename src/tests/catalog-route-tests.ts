import assert from 'node:assert/strict';
import { DELETE as PRODUK_DELETE, PATCH as PRODUK_PATCH } from '../routes/api/produk/+server';
import { DELETE as KATEGORI_DELETE } from '../routes/api/kategori/+server';
import { DELETE as BAHAN_DELETE, POST as BAHAN_POST } from '../routes/api/bahan/+server';
import { PUT as RESEP_PUT } from '../routes/api/resep-produk/+server';
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
	body: unknown,
	query = ''
): Promise<number> {
	try {
		const response = (await handler({
			url: new URL(`http://localhost/api/x${query}`),
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
		// samarinda2 berbagi shard dengan samarinda: ID-nya ada di database yang sama.
		db.prepare(
			"INSERT INTO bahan (id, cabang_id, nama, satuan) VALUES ('b-s2', 'samarinda2', 'Susu', 'ml')"
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

	// Resep: jumlah wajib angka positif, porsi reguler/jumbo, bahan milik cabang yang sama.
	const resep = (items: Array<Record<string, unknown>>) =>
		write(RESEP_PUT, 'PUT', { payload: items }, '?produk_id=p-1');
	assert.equal(await resep([{ bahan_id: 'b-1', jumlah_per_item: 'abc' }]), 400);
	assert.equal(await resep([{ bahan_id: 'b-1', jumlah_per_item: 10, porsi: 'besar' }]), 400);
	assert.equal(await resep([{ bahan_id: 'b-s2', jumlah_per_item: 10 }]), 400);
	assert.equal(
		await resep([
			{ bahan_id: 'b-1', jumlah_per_item: 120, porsi: 'jumbo', cabang_id: 'samarinda2' }
		]),
		200
	);
	assert.equal(
		await count(
			"SELECT COUNT(*) AS n FROM resep_produk WHERE produk_id = 'p-1' AND cabang_id = 'samarinda' AND porsi = 'jumbo'"
		),
		1
	);

	// Bahan: yield bukan angka ditolak, kolom milik server (biaya per satuan) tidak bisa diisi.
	assert.equal(
		await write(BAHAN_POST, 'POST', { payload: { nama: 'Gula', yield_persen: 'abc' } }),
		400
	);
	assert.equal(
		await write(BAHAN_POST, 'POST', {
			payload: {
				id: 'b-gula',
				nama: 'Gula',
				jumlah_beli_terakhir: 1000,
				biaya_beli_terakhir: 20000,
				biaya_per_satuan: 1
			}
		}),
		200
	);
	assert.equal(
		await count("SELECT COUNT(*) AS n FROM bahan WHERE id = 'b-gula' AND biaya_per_satuan = 20"),
		1
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
