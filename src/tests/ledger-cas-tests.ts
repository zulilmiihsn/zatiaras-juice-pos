import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATCH } from '../routes/api/buku-kas/+server';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const platform = {
	env: { DB_SAMARINDA_GROUP: db, DB_BALIKPAPAN_GROUP: db, DB_BERAU_GROUP: db }
} as unknown as App.Platform;
const session = {
	id: 'samarinda:cas-owner',
	branch: 'samarinda',
	userId: 'cas-owner',
	username: 'owner',
	role: 'pemilik',
	expiresAt: 4102444800000
};
const status = (expected: number) => (error: unknown) =>
	Boolean(error && typeof error === 'object' && 'status' in error && error.status === expected);
async function seed(id: string, branch = 'samarinda', source = 'catat', revision = 0) {
	await db
		.prepare(
			`INSERT INTO buku_kas
		(id,cabang_id,tipe,jenis,sumber,nominal,waktu,metode_bayar,deskripsi,revision,stock_policy_mode,stock_policy_revision)
		VALUES (?,?,'in','pendapatan_usaha',?,10000,'2026-07-01T00:00:00.000Z','tunai','Awal',?,?,?)`
		)
		.bind(
			id,
			branch,
			source,
			revision,
			source === 'pos' ? 'tracked' : null,
			source === 'pos' ? 0 : null
		)
		.run();
}
async function snapshot() {
	const ledger = await db.prepare('SELECT * FROM buku_kas ORDER BY id').all();
	const audit = await db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
	const outbox = await db.prepare('SELECT * FROM audit_log_outbox ORDER BY id').all();
	return JSON.parse(
		JSON.stringify({ ledger: ledger.results, audit: audit.results, outbox: outbox.results })
	);
}
async function patch(
	id: string,
	payload: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
	role = 'pemilik'
) {
	return PATCH({
		request: new Request('http://owned.invalid/api/buku-kas', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ branch: 'samarinda', where: { id }, payload, ...overrides })
		}),
		platform,
		locals: { authSession: { ...session, role } }
	} as unknown as Parameters<typeof PATCH>[0]);
}
try {
	await test('manual CAS accepts current revision and canonical money, not client revision assignment', async () => {
		await seed('current');
		const result = await patch('current', { revision: 0, nominal: '25000.6', deskripsi: 'Baru' });
		assert.equal(result.status, 200);
		const row = await db
			.prepare("SELECT nominal,revision,deskripsi FROM buku_kas WHERE id='current'")
			.first();
		assert.deepEqual({ ...row }, { nominal: 25001, revision: 1, deskripsi: 'Baru' });
	});
	await test('stale consent 0 against live revision1 is409 with no ledger/audit/outbox mutation', async () => {
		await seed('stale', 'samarinda', 'catat', 1);
		const before = await snapshot();
		await assert.rejects(
			patch('stale', { revision: 0, nominal: 500, deskripsi: 'Stale' }),
			status(409)
		);
		assert.deepEqual(await snapshot(), before);
	});
	await test('two concurrent callers sharing expected revision have one commit and one409', async () => {
		await seed('race');
		const results = await Promise.allSettled([
			patch('race', { revision: 0, nominal: 15000, deskripsi: 'A' }),
			patch('race', { revision: 0, nominal: 20000, deskripsi: 'B' })
		]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		const rejected = results.filter((r) => r.status === 'rejected');
		assert.equal(rejected.length, 1);
		assert.ok(rejected[0].status === 'rejected' && status(409)(rejected[0].reason));
		const row = await db
			.prepare("SELECT revision,nominal FROM buku_kas WHERE id='race'")
			.first<{ revision: number; nominal: number }>();
		assert.equal(row?.revision, 1);
		assert.ok(row?.nominal === 15000 || row?.nominal === 20000);
	});
	await test('missing/malformed expected revisions fail400 before mutation', async () => {
		await seed('invalid');
		for (const revision of [undefined, null, true, '0', -1, 0.5, Number.MAX_SAFE_INTEGER, [], {}]) {
			const before = await snapshot();
			await assert.rejects(patch('invalid', { revision, nominal: 500 }), status(400));
			assert.deepEqual(await snapshot(), before);
		}
	});
	await test('body branch mismatch and foreign target cannot redirect the mutation, including admin', async () => {
		await seed('local');
		await seed('foreign', 'berau');
		const before = await snapshot();
		await assert.rejects(patch('foreign', { revision: 0, nominal: 500 }), status(404));
		for (const role of ['pemilik', 'admin']) {
			await assert.rejects(
				patch('local', { revision: 0, nominal: 500 }, { branch: 'berau' }, role),
				status(403)
			);
		}
		assert.deepEqual(await snapshot(), before);
	});
	await test('kasir and anonymous negative authority retain complete source', async () => {
		const before = await snapshot();
		await assert.rejects(patch('local', { revision: 0, nominal: 500 }, {}, 'kasir'), status(403));
		await assert.rejects(
			async () =>
				PATCH({ locals: { authSession: null } } as unknown as Parameters<typeof PATCH>[0]),
			status(401)
		);
		assert.deepEqual(await snapshot(), before);
	});
	await test('late database update fault has no business/effects mutation', async () => {
		await seed('fault');
		await db
			.prepare(
				"CREATE TRIGGER owned_cas_fault BEFORE UPDATE ON buku_kas WHEN OLD.id='fault' BEGIN SELECT RAISE(ABORT,'OWNED_CAS_UPDATE_FAULT'); END"
			)
			.run();
		const before = await snapshot();
		await assert.rejects(patch('fault', { revision: 0, nominal: 12000 }), (error: unknown) => {
			// Drizzle wraps SQL errors; require the injected cause, not just any rejection.
			let current = error;
			for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
				if (current.message.includes('OWNED_CAS_UPDATE_FAULT')) return true;
				current = current.cause;
			}
			return false;
		});
		assert.deepEqual(await snapshot(), before);
		await db.prepare('DROP TRIGGER owned_cas_fault').run();
	});
	await test('POS payment-only legacy caller remains valid without manual revision payload', async () => {
		await seed('pos-method', 'samarinda', 'pos');
		assert.equal((await patch('pos-method', { metode_bayar: 'non-tunai' })).status, 200);
		const row = await db
			.prepare("SELECT metode_bayar,revision FROM buku_kas WHERE id='pos-method'")
			.first();
		assert.deepEqual({ ...row }, { metode_bayar: 'non-tunai', revision: 1 });
	});
} finally {
	await close();
}
