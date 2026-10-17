import assert from 'node:assert/strict';
import type { Cookies } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { MS_PER_DAY, MS_PER_HOUR } from '../lib/constants/time';
import { createTestD1 } from './helpers/testD1';
import {
	createAuthSession,
	getAuthSession,
	nextSessionExpiry,
	renewAuthSession,
	SESSION_COOKIE,
	sessionCookieOptions,
	type AuthSession
} from '../lib/server/sessionStore';
import { refreshSessionCookie } from '../lib/server/sessionRenewal';

// Sesi aktif diperpanjang (sliding), dibatasi throttle 1 jam dan batas mutlak 30 hari.
const TTL = 6 * MS_PER_HOUR;
const MAX_LIFETIME = 30 * MS_PER_DAY;
const now = Date.now();

// Kebijakan murni: tanpa DB.
assert.equal(nextSessionExpiry({ createdAt: now, expiresAt: now + TTL }, now), null, 'baru login');
assert.equal(
	nextSessionExpiry({ createdAt: now - MS_PER_HOUR, expiresAt: now + 5 * MS_PER_HOUR + 1 }, now),
	null,
	'masih dalam jendela throttle'
);
assert.equal(
	nextSessionExpiry({ createdAt: now - 2 * MS_PER_HOUR, expiresAt: now + 4 * MS_PER_HOUR }, now),
	now + TTL,
	'diperpanjang penuh'
);
const loginAt = now - MAX_LIFETIME + 2 * MS_PER_HOUR;
assert.equal(
	nextSessionExpiry({ createdAt: loginAt, expiresAt: now + MS_PER_HOUR / 2 }, now),
	loginAt + MAX_LIFETIME,
	'dipotong batas mutlak'
);
assert.equal(
	nextSessionExpiry({ createdAt: loginAt, expiresAt: loginAt + MAX_LIFETIME }, now),
	null,
	'sudah mentok di batas mutlak'
);
assert.equal(sessionCookieOptions(true, 90_500).maxAge, 90);
assert.equal(sessionCookieOptions(false).maxAge, TTL / 1000);

const { db, close } = await createTestD1();
const platform = { env: { DB_SAMARINDA_GROUP: db } } as unknown as App.Platform;

type CookieCall = { name: string; value: string; options: { maxAge?: number; secure?: boolean } };
function fakeCookies() {
	const calls: CookieCall[] = [];
	const cookies = {
		set: (name: string, value: string, options: CookieCall['options']) =>
			void calls.push({ name, value, options })
	} as unknown as Cookies;
	return { cookies, calls };
}

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
	const setTimes = (createdAt: number, expiresAt: number) =>
		db
			.prepare('UPDATE auth_sessions SET created_at = ?, expires_at = ? WHERE id = ?')
			.bind(createdAt, expiresAt, created.id)
			.run();
	const reload = async (): Promise<AuthSession> => (await getAuthSession(platform, created.id))!;

	// Baru login: belum perlu tulis D1 maupun cookie.
	assert.equal(await renewAuthSession(platform, created), null);
	const fresh = fakeCookies();
	assert.equal(await refreshSessionCookie(platform, fresh.cookies, created, true), created);
	assert.deepEqual(fresh.calls, []);

	// Sesi aktif yang sudah lewat jendela throttle: expiry tersimpan dan cookie ikut diperbarui.
	await setTimes(now - 2 * MS_PER_HOUR, now + 4 * MS_PER_HOUR);
	const active = fakeCookies();
	const renewed = await refreshSessionCookie(platform, active.cookies, await reload(), true);
	assert.ok(Math.abs(renewed.expiresAt - (Date.now() + TTL)) < 5_000);
	assert.equal((await reload()).expiresAt, renewed.expiresAt);
	assert.equal(active.calls.length, 1);
	assert.equal(active.calls[0].name, SESSION_COOKIE);
	assert.equal(active.calls[0].value, created.id);
	assert.equal(active.calls[0].options.secure, true);
	assert.ok(Math.abs((active.calls[0].options.maxAge ?? 0) - TTL / 1000) <= 5);

	// Sesi yang sudah kedaluwarsa tidak boleh dihidupkan lagi.
	const expired = { ...(await reload()), createdAt: now - 3 * MS_PER_HOUR, expiresAt: now - 1_000 };
	await setTimes(expired.createdAt, expired.expiresAt);
	assert.equal(await renewAuthSession(platform, expired), null);
	assert.equal(await getAuthSession(platform, created.id), null);

	// D1 gagal saat memperpanjang: request tetap jalan dengan sesi lama dan kegagalan tercatat.
	await setTimes(now - 2 * MS_PER_HOUR, now + 4 * MS_PER_HOUR);
	const stale = await reload();
	const failingDb = new Proxy(db, {
		get(target, prop) {
			if (prop === 'prepare') {
				return (sql: string) => {
					if (sql.includes('UPDATE auth_sessions')) throw new Error('D1 mati');
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, prop);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	}) as D1Database;
	const failing = fakeCookies();
	const failingPlatform = { env: { DB_SAMARINDA_GROUP: failingDb } } as unknown as App.Platform;
	assert.equal(await refreshSessionCookie(failingPlatform, failing.cookies, stale, true), stale);
	assert.deepEqual(failing.calls, []);
	const logged = await db
		.prepare("SELECT message FROM error_events WHERE source = 'session.renew'")
		.all<{ message: string }>();
	assert.deepEqual(
		logged.results.map((row) => row.message),
		['D1 mati']
	);

	console.log('session-renew-tests: policy/persist/cookie/expired/failure-logged passed');
} finally {
	await close();
}
