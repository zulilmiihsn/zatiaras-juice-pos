import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { hashPin } from '../lib/server/pinHash';
import { changePinForBranch, verifyPinForBranch } from '../lib/server/services/pinService';
import { createTestD1 } from './helpers/testD1';

// AUD-053 pin boundary: negatif rate-limit/PIN lama/PIN sama/belum-konfigurasi
// + migrasi legacy + sukses, lewat service yang dipakai route tipis.
const branch = branchContext('samarinda');

const sessionFor = (role: 'kasir' | 'pemilik', id: string) => ({
	id,
	userId: `user-${id}`,
	username: role,
	role,
	branch: 'samarinda' as const,
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [] as string[],
	unlockExpiresAt: 0
});

async function seedPengaturan(
	db: { prepare: (sql: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } },
	pin: string | null,
	pinHash: string | null
) {
	await db
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, pin, pin_hash, nilai, updated_at)
			 VALUES (?, ?, NULL, ?, ?, NULL, ?)
			 ON CONFLICT(id) DO UPDATE SET pin = excluded.pin, pin_hash = excluded.pin_hash`
		)
		.bind('pengaturan-samarinda', 'samarinda', pin, pinHash, new Date().toISOString())
		.run();
}

// 1. Verify: PIN salah -> 403, bukan bocor info.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('1234'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		const result = await verifyPinForBranch(
			platform as never,
			branch,
			sessionFor('kasir', 's1'),
			'9999',
			'laporan'
		);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.status, 403);
			assert.equal(result.message, 'PIN salah');
		}
	} finally {
		await close();
	}
}

// 2. Verify: PIN default 1234 = belum dikonfigurasi -> 409.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, '1234', null);
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		const result = await verifyPinForBranch(
			platform as never,
			branch,
			sessionFor('kasir', 's2'),
			'1234',
			'laporan'
		);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 409);
	} finally {
		await close();
	}
}

// 3. Verify: format salah -> throw 400.
{
	const { db, close } = await createTestD1();
	try {
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		await assert.rejects(
			verifyPinForBranch(platform as never, branch, sessionFor('kasir', 's3'), '12', 'laporan'),
			(err: unknown) => (err as { status?: number }).status === 400
		);
		await assert.rejects(
			verifyPinForBranch(
				platform as never,
				branch,
				sessionFor('kasir', 's3'),
				'1234',
				'bukan-halaman'
			),
			(err: unknown) => (err as { status?: number }).status === 400
		);
	} finally {
		await close();
	}
}

// 4. Verify: PIN legacy plaintext valid -> ok + migrasi ke hash.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, '5678', null);
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		const result = await verifyPinForBranch(
			platform as never,
			branch,
			sessionFor('kasir', 's4'),
			'5678',
			'laporan'
		);
		assert.equal(result.ok, true);
		const row = (await db
			.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id = ? AND kunci IS NULL LIMIT 1')
			.bind('samarinda')
			.first()) as { pin: string | null; pin_hash: string | null };
		assert.equal(row.pin, null);
		assert.ok(row.pin_hash && row.pin_hash.length > 20);
	} finally {
		await close();
	}
}

// 5. Verify: 11x salah beruntun -> 429 di akhir (batas 10).
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('1234'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		let last: unknown;
		for (let i = 0; i < 11; i += 1) {
			last = await verifyPinForBranch(
				platform as never,
				branch,
				sessionFor('kasir', 's5'),
				'9999',
				'laporan'
			);
		}
		assert.equal((last as { ok: boolean }).ok, false);
		assert.equal((last as { status: number }).status, 429);
	} finally {
		await close();
	}
}

// 6. Change: PIN lama salah -> 401.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('5678'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		await assert.rejects(
			changePinForBranch(platform as never, branch, sessionFor('pemilik', 's6'), '8765', '9753'),
			(err: unknown) => (err as { status?: number }).status === 401
		);
	} finally {
		await close();
	}
}

// 7. Change: PIN baru sama -> 400.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('5678'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		await assert.rejects(
			changePinForBranch(platform as never, branch, sessionFor('pemilik', 's7'), '5678', '5678'),
			(err: unknown) =>
				(err as { status?: number }).status === 400 &&
				(err as { body?: { message?: string } }).body?.message === 'PIN baru harus berbeda'
		);
	} finally {
		await close();
	}
}

// 8. Change: sukses -> ok + hash baru terverifikasi.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('5678'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		const result = await changePinForBranch(
			platform as never,
			branch,
			sessionFor('pemilik', 's8'),
			'5678',
			'9753'
		);
		assert.deepEqual(result, { ok: true, pinConfigured: true });
		const check = await verifyPinForBranch(
			platform as never,
			branch,
			sessionFor('kasir', 's8b'),
			'9753',
			'laporan'
		);
		assert.equal(check.ok, true);
	} finally {
		await close();
	}
}

console.log('pin-service: ok');
