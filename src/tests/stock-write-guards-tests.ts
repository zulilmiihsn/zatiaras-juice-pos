import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { writeStockPolicy } from '../lib/server/stockPolicy';
import { POST as BahanMutasiPost } from '../routes/api/bahan-mutasi/+server';
import { PATCH as BahanPatch, POST as BahanPost } from '../routes/api/bahan/+server';
import { POST as ProductSave } from '../routes/api/produk/save-atomic/+server';
import { PATCH as ProductPatch, POST as ProductPost } from '../routes/api/produk/+server';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const owner = { userId: 'owner-1', role: 'pemilik' };

function session() {
	return {
		id: 'session-owner',
		userId: 'owner-1',
		username: 'owner',
		role: 'pemilik',
		branch: 'samarinda',
		createdAt: 0,
		expiresAt: Date.now() + 60_000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}

function event(body: unknown, method: 'POST' | 'PATCH' = 'POST') {
	return {
		request: new Request('https://test.invalid/api/x', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		url: new URL('https://test.invalid/api/x'),
		locals: { authSession: session() },
		platform: { env: { DB_SAMARINDA_GROUP: db } }
	};
}

async function expectStatus(run: () => unknown, status: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === status
	);
}

try {
	await db.batch([
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('guard-product', 'samarinda', 'Guard', 10000, 3, 1, 0, 1)`
		),
		db.prepare(
			`INSERT INTO bahan (id, cabang_id, nama, satuan, stok_saat_ini, is_active)
			 VALUES ('guard-bahan', 'samarinda', 'Guard Bahan', 'gram', 10, 1)`
		)
	]);

	// Tracked: manual mutation allowed.
	await BahanMutasiPost(
		event({ payload: { bahan_id: 'guard-bahan', delta_jumlah: 1 } }) as unknown as Parameters<
			typeof BahanMutasiPost
		>[0]
	);
	await expectStatus(
		() =>
			ProductPatch(
				event({ payload: { stok: 20 }, where: { id: 'guard-product' } }, 'PATCH') as never
			),
		409
	);

	// AUD-008: form basi tak menimpa saldo. Buka (stok 3) -> checkout susutkan
	// jadi 1 -> simpan metadata dengan stok tangkapan 3: saldo tetap 1.
	await db.prepare(`UPDATE produk SET stok = 1 WHERE id = 'guard-product'`).run();
	const staleSave = (await ProductSave(
		event({
			produk: { id: 'guard-product', nama: 'Guard Stale', harga: 11000, stok: 3, lacak_stok: true }
		}) as unknown as Parameters<typeof ProductSave>[0]
	)) as Response;
	assert.equal(staleSave.status, 200);
	assert.equal(
		await db.prepare("SELECT stok FROM produk WHERE id = 'guard-product'").first<number>('stok'),
		1
	);
	assert.equal(
		await db.prepare("SELECT nama FROM produk WHERE id = 'guard-product'").first<string>('nama'),
		'Guard Stale'
	);
	await db.prepare(`UPDATE produk SET stok = 3, nama = 'Guard' WHERE id = 'guard-product'`).run();

	// AUD-009: PATCH metadata bahan menolak field saldo; mutasi bersamaan utuh.
	await db.prepare(`UPDATE bahan SET stok_saat_ini = 7 WHERE id = 'guard-bahan'`).run();
	await expectStatus(
		() =>
			BahanPatch({
				...event({
					payload: { nama: 'Guard Bahan', stok_saat_ini: 10 },
					where: { id: 'guard-bahan' }
				}),
				request: new Request('https://test.invalid/api/x', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						payload: { nama: 'Guard Bahan', stok_saat_ini: 10 },
						where: { id: 'guard-bahan' }
					})
				})
			} as unknown as Parameters<typeof BahanPatch>[0]),
		400
	);
	assert.equal(
		await db
			.prepare("SELECT stok_saat_ini FROM bahan WHERE id = 'guard-bahan'")
			.first<number>('stok_saat_ini'),
		7
	);
	const bahanMetaOk = (await BahanPatch({
		...event({ payload: {}, where: { id: 'guard-bahan' } }),
		request: new Request('https://test.invalid/api/x', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload: { nama: 'Guard Bahan Meta' }, where: { id: 'guard-bahan' } })
		})
	} as unknown as Parameters<typeof BahanPatch>[0])) as Response;
	assert.equal(bahanMetaOk.status, 200);
	assert.equal(
		await db
			.prepare("SELECT stok_saat_ini FROM bahan WHERE id = 'guard-bahan'")
			.first<number>('stok_saat_ini'),
		7
	);
	await expectStatus(
		() =>
			ProductPatch(
				event({ payload: { stok: 20 }, where: { id: 'guard-product' } }, 'PATCH') as never
			),
		409
	);

	await writeStockPolicy(db, samarinda, {
		expectedRevision: 0,
		mode: 'ignored',
		actor: owner,
		now: '2026-09-24T07:00:00.000Z'
	});

	// Ignored: mutation, bahan stock create/patch, product stock edit rejected.
	await expectStatus(
		() =>
			BahanMutasiPost(
				event({ payload: { bahan_id: 'guard-bahan', delta_jumlah: 1 } }) as unknown as Parameters<
					typeof BahanMutasiPost
				>[0]
			),
		409
	);
	await expectStatus(
		() =>
			BahanPost(
				event({
					payload: { nama: 'Baru', satuan: 'gram', stok_saat_ini: 5 }
				}) as unknown as Parameters<typeof BahanPost>[0]
			),
		409
	);
	await expectStatus(
		() =>
			BahanPatch({
				...event({ payload: { stok_saat_ini: 11 }, where: { id: 'guard-bahan' } }),
				request: new Request('https://test.invalid/api/x', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ payload: { stok_saat_ini: 11 }, where: { id: 'guard-bahan' } })
				})
			} as unknown as Parameters<typeof BahanPatch>[0]),
		409
	);
	// Ignored: edit metadata dengan stok basi diabaikan (200, saldo utuh);
	// hanya ubah flag lacak yang ditolak.
	const staleIgnored = (await ProductSave(
		event({
			produk: { id: 'guard-product', nama: 'Guard', harga: 10000, stok: 99, lacak_stok: true }
		}) as unknown as Parameters<typeof ProductSave>[0]
	)) as Response;
	assert.equal(staleIgnored.status, 200);
	await expectStatus(
		() =>
			ProductPost(
				event({ payload: { id: 'direct-ignored', nama: 'Direct', harga: 1000, stok: 5 } }) as never
			),
		409
	);
	await expectStatus(
		() =>
			ProductPost(
				event({
					payload: [
						{ id: 'direct-first', nama: 'First', harga: 1000 },
						{ id: 'direct-second', nama: 'Second', harga: 1000, lacak_stok: true }
					]
				}) as never
			),
		409
	);
	await expectStatus(
		() =>
			ProductPatch(
				event({ payload: { stok: 20 }, where: { id: 'guard-product' } }, 'PATCH') as never
			),
		409
	);
	await expectStatus(
		() =>
			ProductPatch(
				event({ payload: { lacak_stok: false }, where: { ids: 'guard-product' } }, 'PATCH') as never
			),
		409
	);
	assert.equal(
		await db.prepare("SELECT stok FROM produk WHERE id = 'guard-product'").first<number>('stok'),
		3
	);
	assert.equal(
		await db
			.prepare("SELECT lacak_stok FROM produk WHERE id = 'guard-product'")
			.first<number>('lacak_stok'),
		1
	);
	assert.equal(
		await db
			.prepare("SELECT COUNT(*) AS n FROM produk WHERE id LIKE 'direct-%'")
			.first<number>('n'),
		0
	);

	// Ignored: metadata-only product update and costing-only bahan update pass.
	const metadataOk = (await ProductSave(
		event({
			produk: { id: 'guard-product', nama: 'Guard Baru', harga: 12000, stok: 3, lacak_stok: true }
		}) as unknown as Parameters<typeof ProductSave>[0]
	)) as Response;
	assert.equal(metadataOk.status, 200);
	const costingOk = (await BahanPatch({
		...event({ payload: {}, where: { id: 'guard-bahan' } }),
		request: new Request('https://test.invalid/api/x', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				payload: { nama: 'Guard Bahan Baru' },
				where: { id: 'guard-bahan' }
			})
		})
	} as unknown as Parameters<typeof BahanPatch>[0])) as Response;
	assert.equal(costingOk.status, 200);
	const genericMetadataOk = (await ProductPatch(
		event(
			{ payload: { nama: 'Guard via metadata' }, where: { id: 'guard-product' } },
			'PATCH'
		) as never
	)) as Response;
	assert.equal(genericMetadataOk.status, 200);
	const genericCreateOk = (await ProductPost(
		event({ payload: { id: 'metadata-only', nama: 'Tanpa stok', harga: 1000 } }) as never
	)) as Response;
	assert.equal(genericCreateOk.status, 200);
	assert.deepEqual(
		{
			...(await db
				.prepare("SELECT stok, lacak_stok FROM produk WHERE id = 'metadata-only'")
				.first())
		},
		{ stok: 0, lacak_stok: 0 }
	);
	assert.equal(
		await db.prepare("SELECT nama FROM produk WHERE id = 'guard-product'").first<string>('nama'),
		'Guard via metadata'
	);

	console.log('stock-write-guards-tests: ignored-mode mutation boundaries passed');
} finally {
	await close();
}
