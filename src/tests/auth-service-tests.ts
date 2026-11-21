import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { attemptLogin } from '../lib/server/services/authService';
import { createTestD1 } from './helpers/testD1';
import test from 'node:test';

// auth boundary: kontrak negatif login seragam + sukses sesi,
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

test('pendaftaran perangkat hanya pemilik cabang; verifier tidak masuk respons browser', async () => {
	const { POST } = await import('../routes/api/perangkat-kasir/+server');
	const { isCsrfProtectedRequest } = await import('../lib/server/csrfPolicy');
	assert.equal(isCsrfProtectedRequest('/api/perangkat-kasir', 'POST'), true);
	const { db, close } = await createTestD1();
	try {
		await seedProfil(db, 'kasir', crypto.randomUUID(), 'kasir');
		const token = crypto.randomUUID();
		const written: unknown[][] = [];
		let enrolled = 0;
		const submit = (role: string, branch: string) =>
			POST({
				request: new Request('https://test.invalid/api/perangkat-kasir', {
					method: 'POST',
					body: JSON.stringify({ username: 'kasir', branch })
				}),
				locals: { authSession: { role, branch: 'samarinda' } },
				cookies: { set: (...items: unknown[]) => written.push(items) },
				platform: {
					env: {
						DB_SAMARINDA_GROUP: db,
						REALTIME_HUB: {
							idFromName: (name: string) => name,
							get: (name: string) => ({
								fetch: async (req: Request) => {
									assert.equal(name, 'cashier:samarinda');
									const data = await req.json();
									assert.equal(data.role, 'kasir');
									assert.equal(data.userId, 'user-kasir');
									assert.match(data.verifier, /^\$2/);
									enrolled++;
									return Response.json({ ok: true, token }, { status: 201 });
								}
							})
						}
					}
				}
			} as never);
		await assert.rejects(async () => submit('kasir', 'samarinda'), { status: 403 });
		await assert.rejects(async () => submit('pemilik', 'berau'), { status: 403 });
		const res = await submit('pemilik', 'samarinda');
		assert.equal(res.status, 201);
		assert.deepEqual(await res.json(), { success: true });
		assert.equal(enrolled, 1);
		assert.equal(written[0][1], token);
		assert.equal((written[0][2] as { httpOnly: boolean }).httpOnly, true);
	} finally {
		await close();
	}
});

test('aktivasi pilot menolak selain pemilik Balikpapan staging dan memerlukan konfirmasi', async () => {
	const { PATCH } = await import('../routes/api/perangkat-kasir/+server');
	const { isCsrfProtectedRequest } = await import('../lib/server/csrfPolicy');
	assert.equal(isCsrfProtectedRequest('/api/perangkat-kasir', 'PATCH'), true);
	const activate = (
		role: string,
		branch: string,
		flag?: string,
		confirm?: string,
		fetch?: (request: Request) => Promise<Response>
	) =>
		PATCH({
			locals: { authSession: { role, branch } },
			platform: {
				env: {
					KIOSK_STAGING_PILOT: flag,
					REALTIME_HUB: fetch
						? {
								idFromName: (name: string) => name,
								get: (name: string) => {
									assert.equal(name, 'cashier:balikpapan');
									return { fetch };
								}
							}
						: undefined
				}
			},
			request: new Request('https://test.invalid/api/perangkat-kasir', {
				method: 'PATCH',
				body: JSON.stringify({ confirm })
			})
		} as never);
	await assert.rejects(
		async () => activate('kasir', 'balikpapan', 'balikpapan', 'balikpapan-staging'),
		{ status: 403 }
	);
	await assert.rejects(
		async () => activate('pemilik', 'berau', 'balikpapan', 'balikpapan-staging'),
		{ status: 404 }
	);
	await assert.rejects(
		async () => activate('pemilik', 'balikpapan', undefined, 'balikpapan-staging'),
		{ status: 404 }
	);
	await assert.rejects(async () => activate('pemilik', 'balikpapan', 'balikpapan'), {
		status: 400
	});
	const confirmation = 'rollback-balikpapan-staging';
	await assert.rejects(async () => activate('kasir', 'balikpapan', 'balikpapan', confirmation), {
		status: 403
	});
	await assert.rejects(async () => activate('pemilik', 'berau', 'balikpapan', confirmation), {
		status: 404
	});
	await assert.rejects(
		async () =>
			activate('pemilik', 'balikpapan', 'balikpapan', confirmation, async () =>
				Response.json({ ok: true })
			),
		{ status: 409 }
	);
	const result = await activate(
		'pemilik',
		'balikpapan',
		'balikpapan',
		confirmation,
		async (request) => {
			assert.equal(request.url, 'https://cashier.internal/projection/rollback-staging');
			assert.deepEqual(await request.json(), { branch: 'balikpapan' });
			return Response.json({ ok: true, status: 'rolled-back' });
		}
	);
	assert.deepEqual(await result.json(), { success: true });
});

test('hanya pemilik menyiapkan katalog harga untuk cabangnya', async () => {
	const { PUT } = await import('../routes/api/perangkat-kasir/+server');
	const { isCsrfProtectedRequest } = await import('../lib/server/csrfPolicy');
	const { verifyPosPricingToken } = await import('../lib/server/posPricingToken');
	assert.equal(isCsrfProtectedRequest('/api/perangkat-kasir', 'PUT'), true);
	const { db, close } = await createTestD1();
	try {
		const id = crypto.randomUUID();
		await db
			.prepare(
				`INSERT INTO produk(id,cabang_id,nama,harga,stok,is_active) VALUES (?,'samarinda','Jus Uji',10000,5,1)`
			)
			.bind(id)
			.run();
		const env = {
			DB_SAMARINDA_GROUP: db,
			POS_PRICE_SIGNING_KEY: crypto.randomUUID(),
			REALTIME_HUB: {
				idFromName: (name: string) => name,
				get: (name: unknown) => ({
					fetch: async (req: Request) => {
						assert.equal(name, 'cashier:samarinda');
						const { branch, catalog } = await req.json();
						assert.equal(branch, 'samarinda');
						assert.equal(catalog.branch, branch);
						const product = catalog.products.find((item: { id: string }) => item.id === id);
						const token = await verifyPosPricingToken<{ id: string; harga: number }>(
							env,
							product.price_token,
							{ kind: 'catalog_product', branch }
						);
						assert.equal(token.data.id, id);
						assert.equal(token.data.harga, 10000);
						return Response.json({ ok: true, status: 'updated' });
					}
				})
			}
		};
		const prepare = (role: string) =>
			PUT({ locals: { authSession: { role, branch: 'samarinda' } }, platform: { env } } as never);
		await assert.rejects(async () => prepare('kasir'), { status: 403 });
		assert.deepEqual(await (await prepare('pemilik')).json(), { success: true });
	} finally {
		await close();
	}
});

test('login membedakan kuota baca profil dari kesalahan DB biasa setelah rate limit lolos', async () => {
	for (const [message, expected] of [
		['D1_ERROR: daily read limit exceeded', 503],
		['D1_ERROR: database unavailable', 500]
	] as const) {
		const { db, close } = await createTestD1();
		try {
			const wrapped = {
				prepare(sql: string) {
					if (/\bfrom\s+[`"]?profil\b/i.test(sql)) throw new Error(message);
					return db.prepare(sql);
				},
				batch: db.batch.bind(db)
			};
			const result = await attemptLogin(
				{ env: { DB_SAMARINDA_GROUP: wrapped } } as never,
				{ username: 'kasir', password: 'fixture', branch: 'samarinda' },
				'10.9.0.1'
			);
			assert.equal(result.status, expected);
			assert.equal(result.sessionId, undefined);
			assert.equal(
				result.headers?.['x-kiosk-login'],
				expected === 503 ? 'd1-daily-limit' : undefined
			);
		} finally {
			await close();
		}
	}
});

test('kuota tulis sesi memicu mode kios hanya setelah password benar', async () => {
	const { db, close } = await createTestD1();
	try {
		const password = crypto.randomUUID();
		await seedProfil(db, 'kasir', password, 'kasir');
		const platform = {
			env: {
				DB_SAMARINDA_GROUP: {
					prepare(sql: string) {
						if (/INSERT INTO auth_sessions/i.test(sql))
							throw new Error('D1_ERROR: daily write limit exceeded');
						return db.prepare(sql);
					},
					batch: db.batch.bind(db)
				}
			}
		} as never;
		const attempt = (value: string) =>
			attemptLogin(
				platform,
				{ branch: 'samarinda', username: 'kasir', password: value },
				'10.9.0.2'
			);
		assert.equal((await attempt('invalid')).headers?.['x-kiosk-login'], undefined);
		assert.equal((await attempt(password)).headers?.['x-kiosk-login'], 'd1-daily-limit');
		const { parseSessionBranch } = await import('../lib/server/authSessionReader');
		const { parseKioskSession } = await import('../lib/server/kioskSession');
		const sid = crypto.randomUUID();
		const cookie = `operasional:samarinda:${sid}`;
		assert.equal(parseSessionBranch(cookie), null);
		assert.deepEqual(parseKioskSession(cookie), { branch: 'samarinda', sid });
	} finally {
		await close();
	}
});

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

await test('login rejects nontext credentials and malformed branch values before database access', async () => {
	for (const patch of [
		{ username: 1 },
		{ username: ['owner'] },
		{ username: { toString: 'invalid' } },
		{ password: 42 },
		{ password: [] },
		{ password: { toString: 'invalid' } },
		{ branch: ['samarinda'] },
		{ branch: { toString: 'invalid' } }
	]) {
		const result = await attemptLogin(
			undefined,
			{ username: 'owner', password: 'Rahasia42', branch: 'samarinda', ...patch },
			'10.9.0.5'
		);
		assert.equal(result.status, 400);
		assert.equal(result.sessionId, undefined);
	}
});
