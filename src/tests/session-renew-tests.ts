import assert from 'node:assert/strict';
import { MS_PER_DAY, MS_PER_HOUR } from '../lib/constants/time';
import { createTestD1 } from './helpers/testD1';
import {
	createAuthSession,
	getAuthSession,
	renewAuthSession,
	sessionCookieOptions
} from '../lib/server/sessionStore';

// Sesi aktif diperpanjang (sliding), dibatasi throttle 1 jam dan batas mutlak 30 hari.
const { db, close } = await createTestD1();
const platform = { env: { DB_SAMARINDA_GROUP: db } } as unknown as App.Platform;

try {
	await db
		.prepare(
			`INSERT INTO profil (id, cabang_id, role, username, password) VALUES ('renew-kasir', 'samarinda', 'kasir', 'renew-kasir', 'x')`
		)
		.run();
	const created = await createAuthSession(platform, {
		branch: 'samarinda',
		userId: 'renew-kasir',
		username: 'renew-kasir',
		role: 'kasir'
	});

	// Baru login: belum perlu tulis D1.
	assert.equal(await renewAuthSession(platform, created), null);

	const setTimes = (createdAt: number, expiresAt: number) =>
		db
			.prepare('UPDATE auth_sessions SET created_at = ?, expires_at = ? WHERE id = ?')
			.bind(createdAt, expiresAt, created.id)
			.run();

	// Sisa < 5 jam: diperpanjang penuh 6 jam dari sekarang.
	const now = Date.now();
	await setTimes(now - 2 * MS_PER_HOUR, now + 4 * MS_PER_HOUR);
	const stale = (await getAuthSession(platform, created.id))!;
	const renewed = await renewAuthSession(platform, stale);
	assert.ok(renewed);
	assert.ok(Math.abs(renewed.expiresAt - (Date.now() + 6 * MS_PER_HOUR)) < 5_000);
	assert.equal((await getAuthSession(platform, created.id))?.expiresAt, renewed.expiresAt);

	// Batas mutlak: perpanjangan dipotong, lalu berhenti saat sudah mentok.
	const loginAt = now - 30 * MS_PER_DAY + 2 * MS_PER_HOUR;
	await setTimes(loginAt, now + MS_PER_HOUR / 2);
	const capped = await renewAuthSession(platform, (await getAuthSession(platform, created.id))!);
	assert.equal(capped?.expiresAt, loginAt + 30 * MS_PER_DAY);
	assert.equal(await renewAuthSession(platform, capped!), null);

	// Sesi yang sudah kedaluwarsa tidak boleh dihidupkan lagi.
	await setTimes(now - 3 * MS_PER_HOUR, now - 1_000);
	assert.equal(
		await renewAuthSession(platform, {
			...stale,
			createdAt: now - 3 * MS_PER_HOUR,
			expiresAt: now - 1_000
		}),
		null
	);
	assert.equal(await getAuthSession(platform, created.id), null);

	assert.equal(sessionCookieOptions(true, 90_500).maxAge, 90);
	assert.equal(sessionCookieOptions(false).maxAge, (6 * MS_PER_HOUR) / 1000);

	console.log('session-renew-tests: sliding/throttle/cap/expired passed');
} finally {
	await close();
}
