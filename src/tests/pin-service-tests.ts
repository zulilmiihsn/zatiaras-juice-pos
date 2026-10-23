import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { branchContext } from '../lib/server/branchResolver';
import { hashPin } from '../lib/server/pinHash';
import { changePinForBranch, verifyPinForBranch } from '../lib/server/services/pinService';
import { createAuthSession, deleteAuthSession, getAuthSession } from '../lib/server/sessionStore';
import { PROTECTED_PAGES, requirePageAccess } from '../lib/server/pageAccess';
import { GET as PIN_STATUS, POST as VERIFY_PIN } from '../routes/api/pin/verify/+server';
import { createTestD1 } from './helpers/testD1';

// pin boundary: negatif rate-limit/PIN lama/PIN sama/belum-konfigurasi
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

// 6. Change: PIN lama salah -> 400 (bukan 401, agar klien tidak menampilkan "sesi berakhir").
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('5678'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		await assert.rejects(
			changePinForBranch(platform as never, branch, sessionFor('pemilik', 's6'), '8765', '9753'),
			(err: unknown) =>
				(err as { status?: number }).status === 400 &&
				(err as { body?: { message?: string } }).body?.message === 'PIN lama salah'
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

// Login ulang membuat sesi baru; kuota tebakan PIN tetap dihitung per akun, dan tiap
// tebakan salah tercatat di audit untuk pemilik.
{
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('2580'));
		const platform = { env: { DB_SAMARINDA_GROUP: db } };
		const guess = (sessionNo: number) =>
			verifyPinForBranch(
				platform as never,
				branch,
				{ ...sessionFor('kasir', `brute-${sessionNo}`), userId: 'user-brute' },
				'9999',
				'laporan'
			);
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 21; attempt++) {
			// Lima tebakan per sesi: di bawah batas per sesi (10), jadi hanya batas akun yang menahan.
			const result = await guess(Math.floor(attempt / 5));
			statuses.push(result.ok ? 200 : result.status);
		}
		assert.deepEqual(statuses.slice(0, 20), Array(20).fill(403));
		assert.equal(statuses[20], 429);
		assert.equal(
			await db
				.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'pin.failed'")
				.first<number>('n'),
			20
		);
	} finally {
		await close();
	}
}

// Satu verifikasi membuka seluruh halaman selama tepat 60 detik pada sesi yang sama.
{
	mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T04:00:00.000Z') });
	const { db, close } = await createTestD1();
	try {
		await seedPengaturan(db, null, await hashPin('2580'));
		await db
			.prepare('UPDATE pengaturan SET halaman_terkunci = ? WHERE cabang_id = ? AND kunci IS NULL')
			.bind(JSON.stringify(PROTECTED_PAGES), branch)
			.run();
		await db
			.prepare(
				`INSERT INTO profil (id, cabang_id, role, username, password)
				 VALUES ('pin-kasir', 'samarinda', 'kasir', 'pin-kasir', 'fixture'),
				 ('pin-kasir-berau', 'berau', 'kasir', 'pin-kasir-berau', 'fixture')`
			)
			.run();
		await db
			.prepare(
				`INSERT INTO pengaturan (id, cabang_id, kunci, pin_hash, halaman_terkunci)
				 SELECT 'pin-settings-berau', 'berau', NULL, pin_hash, halaman_terkunci
				 FROM pengaturan WHERE cabang_id = ? AND kunci IS NULL`
			)
			.bind(branch)
			.run();
		const platform = {
			env: { DB_SAMARINDA_GROUP: db, DB_BERAU_GROUP: db }
		} as unknown as App.Platform;
		const payload = {
			branch: 'samarinda' as const,
			userId: 'pin-kasir',
			username: 'pin-kasir',
			role: 'kasir'
		};
		const session = await createAuthSession(platform, payload);
		const other = await createAuthSession(platform, payload);
		const otherBranch = await createAuthSession(platform, {
			...payload,
			branch: 'berau',
			userId: 'pin-kasir-berau',
			username: 'pin-kasir-berau'
		});
		const verifiedAt = Date.now();
		const response = await VERIFY_PIN({
			platform,
			locals: { authSession: session },
			request: new Request('http://localhost/api/pin/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pin: '2580', page: 'beranda' })
			})
		} as never);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, expiresAt: verifiedAt + 60_000 });
		const reload = async () => {
			const current = await getAuthSession(platform, session.id);
			assert.ok(current);
			return current;
		};
		const status = async (authSession: Awaited<ReturnType<typeof reload>> | null, query = '') =>
			PIN_STATUS({
				locals: { authSession },
				url: new URL(`http://localhost/api/pin/verify${query}`)
			} as never);
		const currentStatus = await status(await reload());
		assert.equal(currentStatus.headers.get('Cache-Control'), 'no-store');
		assert.deepEqual(await currentStatus.json(), { ok: true, expiresAt: verifiedAt + 60_000 });
		assert.deepEqual(await (await status(other)).json(), { ok: true, expiresAt: 0 });
		for (const [current, query, expected] of [
			[null, '', 401],
			[{ ...session, role: 'pemilik' }, '', 403],
			[{ ...session, role: 'staff' }, '', 403],
			[session, '?branch=berau', 403]
		] as const) {
			await assert.rejects(
				status(current, query),
				(error: unknown) => (error as { status?: number }).status === expected
			);
		}
		for (const page of PROTECTED_PAGES) await requirePageAccess(db, await reload(), page);
		assert.equal((await getAuthSession(platform, other.id))?.unlockExpiresAt, 0);
		await assert.rejects(
			requirePageAccess(db, other, 'laporan'),
			(error: unknown) => (error as { status?: number }).status === 403
		);
		await assert.rejects(
			requirePageAccess(db, otherBranch, 'laporan'),
			(error: unknown) => (error as { status?: number }).status === 403
		);
		mock.timers.tick(59_999);
		for (const page of PROTECTED_PAGES) await requirePageAccess(db, await reload(), page);
		assert.deepEqual(await (await status(await reload())).json(), {
			ok: true,
			expiresAt: verifiedAt + 60_000
		});
		assert.equal((await reload()).unlockExpiresAt, verifiedAt + 60_000);
		const wrong = await verifyPinForBranch(platform, branch, await reload(), '9999', 'laporan');
		assert.equal(wrong.ok, false);
		if (!wrong.ok) assert.equal(wrong.status, 403);
		assert.equal((await reload()).unlockExpiresAt, verifiedAt + 60_000);
		mock.timers.tick(1);
		assert.deepEqual(await (await status(await reload())).json(), { ok: true, expiresAt: 0 });
		for (const page of PROTECTED_PAGES) {
			await assert.rejects(
				requirePageAccess(db, await reload(), page),
				(error: unknown) => (error as { status?: number }).status === 403
			);
		}
		const renewed = await verifyPinForBranch(platform, branch, await reload(), '2580', 'catat');
		assert.deepEqual(renewed, { ok: true, expiresAt: verifiedAt + 120_000 });
		const current = await reload();
		const concurrent = await Promise.all([
			verifyPinForBranch(platform, branch, current, '2580', 'laporan'),
			verifyPinForBranch(platform, branch, current, '2580', 'pengaturan')
		]);
		assert.deepEqual(concurrent, [renewed, renewed]);
		assert.deepEqual((await reload()).unlockedPages, [...PROTECTED_PAGES]);
		assert.equal(
			(await verifyPinForBranch(platform, branchContext('berau'), otherBranch, '2580', 'catat')).ok,
			true
		);
		await changePinForBranch(platform, branch, { ...session, role: 'pemilik' }, '2580', '9753');
		assert.deepEqual(await (await status(await reload())).json(), { ok: true, expiresAt: 0 });
		for (const page of PROTECTED_PAGES) {
			await assert.rejects(
				requirePageAccess(db, await reload(), page),
				(error: unknown) => (error as { status?: number }).status === 403
			);
		}
		const otherBranchAfterChange = await getAuthSession(platform, otherBranch.id);
		assert.ok(otherBranchAfterChange);
		for (const page of PROTECTED_PAGES) await requirePageAccess(db, otherBranchAfterChange, page);
		await deleteAuthSession(platform, session.id);
		assert.equal(await getAuthSession(platform, session.id), null);
	} finally {
		mock.timers.reset();
		await close();
	}
}

console.log('pin-service: ok');
