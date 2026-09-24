import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { writeStockPolicy } from '../lib/server/stockPolicy';
import { POST as BahanMutasiPost } from '../routes/api/bahan-mutasi/+server';
import { PATCH as BahanPatch, POST as BahanPost } from '../routes/api/bahan/+server';
import { POST as ProductSave } from '../routes/api/produk/save-atomic/+server';
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

function event(body: unknown) {
	return {
		request: new Request('https://test.invalid/api/x', {
			method: 'POST',
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
	await expectStatus(
		() =>
			ProductSave(
				event({
					produk: { id: 'guard-product', nama: 'Guard', harga: 10000, stok: 99, lacak_stok: true }
				}) as unknown as Parameters<typeof ProductSave>[0]
			),
		409
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

	console.log('stock-write-guards-tests: ignored-mode mutation boundaries passed');
} finally {
	await close();
}
