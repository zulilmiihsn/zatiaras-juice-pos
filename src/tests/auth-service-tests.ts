import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { attemptLogin } from '../lib/server/services/authService';
import { createTestD1 } from './helpers/testD1';

// AUD-053 auth boundary: kontrak negatif login seragam + sukses sesi,
// lewat service yang dipakai route tipis.
async function seedProfil(
	db: { prepare: (sql: string) => { bind: (...a: unknown[]) => { run: () => Promise<unknown> } } },
	username: string,
	passwordPlain: string,
	role: string
) {
	await db
		.prepare(
			`INSERT INTO profil (id, cabang_id, username, password, role, updated_at)
			 VALUES (?, 'samarinda', ?, ?, ?, ?)`
		)
		.bind(
			`user-${username}`,
			username,
			await bcrypt.hash(passwordPlain, 4),
			role,
			new Date().toISOString()
		)
		.run();
}

// 1. Sukses: 200 + sessionId + cookie payload user.
{
	const { db, close } = await createTestD1();
	try {
		await seedProfil(db, 'owner', 'Rahasia42', 'pemilik');
		const result = await attemptLogin(
			{ env: { DB_SAMARINDA_GROUP: db } } as never,
			{ username: 'owner', password: 'Rahasia42', branch: 'samarinda' },
			'10.9.0.1'
		);
		assert.equal(result.status, 200);
		assert.equal((result.body as { success: boolean }).success, true);
		assert.ok(result.sessionId);
		assert.equal(((result.body as { user: { role: string } }).user || {}).role, 'pemilik');
	} finally {
		await close();
	}
}

// 2. User tak dikenal vs password salah: pesan + kode SERAGAM (anti-enumeration).
{
	const { db, close } = await createTestD1();
	try {
		await seedProfil(db, 'owner', 'Rahasia42', 'pemilik');
		const platform = { env: { DB_SAMARINDA_GROUP: db } } as never;
		const unknown = await attemptLogin(
			platform,
			{ username: 'hantu', password: 'Rahasia42', branch: 'samarinda' },
			'10.9.0.2'
		);
		const wrong = await attemptLogin(
			platform,
			{ username: 'owner', password: 'Salah99', branch: 'samarinda' },
			'10.9.0.2'
		);
		for (const r of [unknown, wrong]) {
			assert.equal(r.status, 401);
			assert.deepEqual(r.body, {
				success: false,
				code: 'INVALID_CREDENTIALS',
				message: 'Username atau password salah.'
			});
			assert.equal(r.sessionId, undefined);
		}
	} finally {
		await close();
	}
}

// 3. Role unknown di DB: fail-closed 401 seragam, tanpa sesi.
{
	const { db, close } = await createTestD1();
	try {
		await seedProfil(db, 'aneh', 'Rahasia42', 'superadmin');
		const result = await attemptLogin(
			{ env: { DB_SAMARINDA_GROUP: db } } as never,
			{ username: 'aneh', password: 'Rahasia42', branch: 'samarinda' },
			'10.9.0.3'
		);
		assert.equal(result.status, 401);
		assert.equal((result.body as { code: string }).code, 'INVALID_CREDENTIALS');
		assert.equal(result.sessionId, undefined);
	} finally {
		await close();
	}
}

// 4. Field kosong + cabang invalid: 400.
{
	const { db, close } = await createTestD1();
	try {
		const platform = { env: { DB_SAMARINDA_GROUP: db } } as never;
		const empty = await attemptLogin(
			platform,
			{ username: '', password: '', branch: 'samarinda' },
			'10.9.0.4'
		);
		assert.equal(empty.status, 400);
		assert.equal((empty.body as { code: string }).code, 'VALIDATION_ERROR');
		const badBranch = await attemptLogin(
			platform,
			{ username: 'x', password: 'y', branch: 'atlantis' },
			'10.9.0.4'
		);
		assert.equal(badBranch.status, 400);
		assert.equal((badBranch.body as { code: string }).code, 'INVALID_BRANCH');
	} finally {
		await close();
	}
}

console.log('auth-service: ok');
