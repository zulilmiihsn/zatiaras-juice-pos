import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createTestD1 } from './helpers/testD1';
import { POST } from '../routes/api/gantikeamanan/+server';

const { db, close } = await createTestD1();
try {
	// 0040: UNIQUE (cabang_id, username) ada pada skema aktual.
	const indexRow = (await db
		.prepare(
			`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_profil_branch_username'`
		)
		.first()) as { sql?: string } | null;
	assert.ok(
		indexRow?.sql?.toUpperCase().includes('UNIQUE'),
		'idx_profil_branch_username harus UNIQUE'
	);

	const branch = 'samarinda';
	const platform = { env: { DB_SAMARINDA_GROUP: db } } as unknown as App.Platform;

	async function seedUser(id: string, username: string, password: string, cabang = branch) {
		const hash = await bcrypt.hash(password, 10);
		await db
			.prepare(
				`INSERT INTO profil (id, cabang_id, role, username, password) VALUES (?, ?, 'kasir', ?, ?)`
			)
			.bind(id, cabang, username, hash)
			.run();
		await db
			.prepare(
				`INSERT INTO auth_sessions (id, cabang_id, user_id, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, 'kasir', 0, 9999999999)`
			)
			.bind(`sess-${id}`, cabang, id, username)
			.run();
	}

	function postEvent(body: unknown, sessionUsername = 'admin-acting') {
		return {
			request: new Request('https://test.invalid/api/gantikeamanan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			getClientAddress: () => `127.0.0.${Math.floor(Math.random() * 200) + 10}`,
			locals: {
				authSession: {
					id: 'sess-admin',
					userId: 'admin-1',
					username: sessionUsername,
					role: 'pemilik',
					branch,
					createdAt: 0,
					expiresAt: 9999999999,
					unlockedPages: [],
					unlockExpiresAt: 0
				}
			},
			platform
		};
	}

	// Cabang berbeda boleh pakai username sama.
	await seedUser('u-balik-1', 'sama', 'KuatPass1', 'balikpapan');
	await seedUser('u-berau-1', 'sama', 'KuatPass1', 'berau');
	const crossCount = await db
		.prepare(`SELECT COUNT(*) AS n FROM profil WHERE username = 'sama'`)
		.first<number>('n');
	assert.equal(crossCount, 2);

	// Duplikat legacy satu cabang ditolak DB langsung.
	await seedUser('u-dup-1', 'ganda', 'KuatPass1');
	await assert.rejects(
		db
			.prepare(
				`INSERT INTO profil (id, cabang_id, role, username, password) VALUES ('u-dup-2', 'samarinda', 'kasir', 'ganda', 'x')`
			)
			.run(),
		/UNIQUE/i
	);

	// Race: dua akun berebut username baru yang sama. Tepat satu menang.
	await seedUser('u-race-a', 'race-a', 'KuatPass1');
	await seedUser('u-race-b', 'race-b', 'KuatPass1');
	const claim = 'rebutan';
	const results = await Promise.allSettled([
		POST(
			postEvent({
				usernameLama: 'race-a',
				passwordLama: 'KuatPass1',
				usernameBaru: claim,
				branch
			}) as never
		),
		POST(
			postEvent({
				usernameLama: 'race-b',
				passwordLama: 'KuatPass1',
				usernameBaru: claim,
				branch
			}) as never
		)
	]);
	const okResponses = [];
	const conflictResponses = [];
	for (const r of results) {
		assert.equal(r.status, 'fulfilled');
		const res = (r as PromiseFulfilledResult<Response>).value;
		const json = (await res.json()) as { success: boolean; code?: string };
		if (res.status === 200 && json.success) okResponses.push(json);
		else if (json.code === 'USERNAME_EXISTS') conflictResponses.push(json);
		else assert.fail(`status tak terduga ${res.status} ${JSON.stringify(json)}`);
	}
	assert.equal(okResponses.length, 1);
	assert.equal(conflictResponses.length, 1);

	// Pemenang exactly satu baris; loser tidak berubah; sesi loser utuh.
	const winnerCount = await db
		.prepare(`SELECT COUNT(*) AS n FROM profil WHERE cabang_id = 'samarinda' AND username = ?`)
		.bind(claim)
		.first<number>('n');
	assert.equal(winnerCount, 1);
	const loserName = (
		(await db
			.prepare(`SELECT username AS u FROM profil WHERE id = 'u-race-a'`)
			.first<{ u: string }>()) as { u: string }
	).u;
	const otherName = (
		(await db
			.prepare(`SELECT username AS u FROM profil WHERE id = 'u-race-b'`)
			.first<{ u: string }>()) as { u: string }
	).u;
	assert.ok([loserName, otherName].includes(claim));
	assert.ok([loserName, otherName].some((v) => v !== claim));
	const loserId = loserName !== claim ? 'u-race-a' : 'u-race-b';
	const loserSession = await db
		.prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?`)
		.bind(loserId)
		.first<number>('n');
	assert.equal(loserSession, 1);
	const loserPasswordOk = await db
		.prepare(`SELECT password AS p FROM profil WHERE id = ?`)
		.bind(loserId)
		.first<{ p: string }>();
	assert.ok(await bcrypt.compare('KuatPass1', (loserPasswordOk as { p: string }).p));

	// Kontrak stabil: kode tetap USERNAME_EXISTS untuk klaim ulang.
	const loserCurrent = (
		(await db
			.prepare(`SELECT username AS u FROM profil WHERE id = ?`)
			.bind(loserId)
			.first<{ u: string }>()) as { u: string }
	).u;
	const retry = (await POST(
		postEvent({
			usernameLama: loserCurrent,
			passwordLama: 'KuatPass1',
			usernameBaru: claim,
			branch
		}) as never
	)) as Response;
	const retryJson = (await retry.json()) as { code?: string };
	assert.equal(retryJson.code, 'USERNAME_EXISTS');

	console.log('credential-username-tests: unique per cabang, race 409, session utuh passed');
} finally {
	await close();
}
