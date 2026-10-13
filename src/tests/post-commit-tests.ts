import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { performance } from 'node:perf_hooks';
import {
	settlePostCommitEffects,
	POST_COMMIT_EFFECTS_TIMEOUT_MS
} from '../lib/server/postCommit.js';
import {
	publishBranchEvent,
	REALTIME_PUBLISH_TIMEOUT_MS
} from '../lib/server/realtimePublisher.js';
import { executeCheckout } from '../lib/server/checkout/checkoutUseCase';
import { flushAuditLogOutbox } from '../lib/server/auditLog';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { branchContext } from '../lib/server/branchResolver';
import { POST } from '../routes/api/pos/transaction/+server';
import { createTestD1 } from './helpers/testD1';
const BRANCH = branchContext('samarinda');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const NOW = Date.parse('2026-07-01T04:00:00.000Z');
mock.timers.enable({ apis: ['Date'], now: NOW });
async function fixture() {
	const owned = await createTestD1();
	const { db } = owned;
	await db.batch([
		db.prepare(
			"INSERT INTO produk(id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES('postcommit-produk','samarinda','Jus PostCommit',12000,20,1,0,1)"
		),
		db.prepare(
			"INSERT INTO pengaturan(id,cabang_id,kunci,nama_toko,alamat,telepon,instagram,ucapan) VALUES('settings-postcommit','samarinda',NULL,'Toko','Alamat','081','@t','Thanks')"
		)
	]);
	const env = {
		DB_SAMARINDA_GROUP: db,
		POS_PRICE_SIGNING_KEY: 'dummy-postcommit-signing-key-32-bytes-abcdef',
		POS_PRICE_SIGNING_KEY_ID: 'test'
	} as App.Platform['env'];
	const source = { product_id: 'postcommit-produk', jumlah: 1 };
	const quote = await signPosPricingToken(env, {
		kind: 'checkout_quote',
		branch: BRANCH,
		data: {
			items: [
				{
					source,
					product_name: 'Jus PostCommit',
					product_price: 12000,
					add_ons: [],
					line_total: 12000
				}
			],
			total_amount: 12000,
			total_qty: 1
		},
		ttlMs: 60000
	});
	const session = { userId: 'owner-pc', username: 'owner', role: 'pemilik' };
	const body = (key: string) => ({
		idempotency_key: key,
		metode_bayar: 'tunai',
		cash_received: 12000,
		items: [source],
		quote_token: quote
	});
	const checkout = (key: string, platform: App.Platform = { env }) =>
		executeCheckout({ db, branch: BRANCH, session, platform, rawBody: body(key) });
	const http = async (key: string, platform: App.Platform = { env }) =>
		POST({
			request: new Request('http://localhost/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body(key))
			}),
			platform,
			locals: { authSession: { ...session, branch: BRANCH } }
		} as unknown as Parameters<typeof POST>[0]);
	const count = (table: string) =>
		db
			.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id=?`)
			.bind(BRANCH)
			.first<number>('n');
	return { ...owned, env, checkout, http, count };
}
try {
	await test('legacy promise settle stays bounded/rejection safe and timers complete', async () => {
		const fast = performance.now();
		await settlePostCommitEffects([Promise.resolve(1), Promise.resolve(2)], 1000);
		assert.ok(performance.now() - fast < 1000);
		let release!: () => void;
		const hanging = new Promise<void>((resolve) => {
			release = resolve;
		});
		const start = performance.now();
		await settlePostCommitEffects([hanging], 150);
		const elapsed = performance.now() - start;
		assert.ok(elapsed >= 100 && elapsed < 1500, `Bounded wait: ${elapsed}`);
		release();
		await hanging;
		await settlePostCommitEffects([Promise.reject(new Error('downstream down'))], 150);
		assert.ok(POST_COMMIT_EFFECTS_TIMEOUT_MS <= 5000);
		assert.ok(REALTIME_PUBLISH_TIMEOUT_MS <= POST_COMMIT_EFFECTS_TIMEOUT_MS);
	});
	for (const phase of ['BEFORE', 'AFTER'])
		await test(`audit ${phase} insert failure rolls financial commit/intent back and same key recovers`, async () => {
			const f = await fixture();
			try {
				await f.db
					.prepare(
						`CREATE TRIGGER fail_owned_audit ${phase} INSERT ON audit_log_outbox BEGIN SELECT RAISE(ABORT,'OWNED_AUDIT_INTENT_FAILURE'); END;`
					)
					.run();
				await assert.rejects(
					f.checkout('audit-failed-key'),
					/OWNED_AUDIT_INTENT_FAILURE/,
					'Audit durability failure must reject business batch, not silently commit'
				);
				for (const table of [
					'buku_kas',
					'transaksi_kasir',
					'produk_mutasi',
					'antrean_notification_events',
					'audit_log_outbox',
					'audit_logs'
				])
					assert.equal(await f.count(table), 0, table);
				assert.equal(
					await f.db
						.prepare("SELECT stok FROM produk WHERE id='postcommit-produk'")
						.first<number>('stok'),
					20
				);
				await f.db.prepare('DROP TRIGGER fail_owned_audit').run();
				const sale = await f.checkout('audit-failed-key');
				assert.equal(sale.idempotent, false);
				assert.equal(await f.count('audit_log_outbox'), 1);
			} finally {
				await f.close();
			}
		});
	await test('durable intent survives delivery outage, replay/concurrency do not duplicate, canonical drain recovers envelope', async () => {
		const f = await fixture();
		try {
			await f.db
				.prepare(
					"CREATE TRIGGER fail_owned_audit_sink BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'OWNED_AUDIT_DELIVERY_OUTAGE'); END;"
				)
				.run();
			const [a, b] = await Promise.all([f.checkout('audit-once'), f.checkout('audit-once')]);
			assert.equal(a.data.buku_kas_id, b.data.buku_kas_id);
			assert.equal([a, b].filter((value) => !value.idempotent).length, 1);
			assert.equal((await f.checkout('audit-once')).idempotent, true);
			assert.equal(await f.count('buku_kas'), 1);
			assert.equal(await f.count('antrean_notification_events'), 1);
			assert.equal(await f.count('audit_log_outbox'), 1);
			assert.equal(await f.count('audit_logs'), 0);
			const row = await f.db
				.prepare('SELECT id,payload,created_at FROM audit_log_outbox WHERE cabang_id=?')
				.bind(BRANCH)
				.first<{ id: string; payload: string; created_at: string }>();
			assert.ok(row);
			const payload = JSON.parse(row.payload) as {
				entityId: string;
				transactionId: string;
				amount: number;
				session: { userId: string };
				metadata: { nomorHarian: number };
			};
			assert.equal(payload.entityId, a.data.buku_kas_id);
			assert.equal(payload.transactionId, a.data.transaction_id);
			assert.equal(payload.amount, 12000);
			assert.equal(payload.session.userId, 'owner-pc');
			assert.equal(payload.metadata.nomorHarian, a.data.nomor_harian);
			assert.equal(await flushAuditLogOutbox(f.db, BRANCH), 0);
			assert.equal(
				await f.count('audit_log_outbox'),
				1,
				'Delivery outage cannot erase committed intent'
			);
			await f.db.prepare('DROP TRIGGER fail_owned_audit_sink').run();
			assert.equal(await flushAuditLogOutbox(f.db, BRANCH), 1);
			assert.equal(await flushAuditLogOutbox(f.db, BRANCH), 0);
			assert.equal(await f.count('audit_logs'), 1);
			const log = await f.db
				.prepare('SELECT id,entity_id,transaction_id,amount FROM audit_logs WHERE cabang_id=?')
				.bind(BRANCH)
				.first<{ id: string; entity_id: string; transaction_id: string; amount: number }>();
			assert.deepEqual(
				{ ...log },
				{
					id: row.id,
					entity_id: a.data.buku_kas_id,
					transaction_id: a.data.transaction_id,
					amount: 12000
				}
			);
		} finally {
			await f.close();
		}
	});
	await test('actual handler with execution context responds while realtime is held; retained tasks then settle', async () => {
		const f = await fixture();
		const releases: Array<() => void> = [];
		const signals: AbortSignal[] = [];
		const retained: Promise<unknown>[] = [];
		let published!: () => void;
		const ready = new Promise<void>((resolve) => {
			published = resolve;
		});
		let response: Promise<Response> | undefined;
		try {
			f.env.REALTIME_HUB = {
				idFromName: () => 'id',
				get: () => ({
					fetch: (request: Request) => {
						if (new URL(request.url).pathname === '/rate-limit')
							return Promise.resolve(
								Response.json({
									allowed: true,
									limit: 100,
									count: 1,
									retryAfterSeconds: 0,
									resetAt: NOW + 5000
								})
							);
						assert.equal(
							new URL(request.url).pathname,
							'/publish',
							'Hold only the actual post-commit consumer'
						);
						return new Promise<Response>((resolve, reject) => {
							signals.push(request.signal);
							const abort = () => reject(request.signal.reason);
							request.signal.addEventListener('abort', abort, { once: true });
							releases.push(() => {
								request.signal.removeEventListener('abort', abort);
								resolve(new Response(null, { status: 204 }));
							});
							if (signals.length === 2) published();
						});
					}
				})
			};
			response = f.http('context-key', {
				env: f.env,
				context: {
					waitUntil: (task) => {
						retained.push(task);
					}
				}
			});
			await ready;
			const observed = await Promise.race([
				response.then(() => true),
				sleep(500).then(() => false)
			]);
			assert.equal(
				observed,
				true,
				'Actual Response must not await held realtime when waitUntil is available'
			);
			assert.ok(retained.length > 0);
			assert.equal((await response).status, 200);
			assert.equal(await f.count('audit_log_outbox'), 1);
			assert.ok(
				signals.every((signal) => !signal.aborted),
				`Publish still owned by context: ${JSON.stringify(signals.map((signal) => ({ aborted: signal.aborted, reason: signal.reason instanceof Error ? signal.reason.message : String(signal.reason) })))}`
			);
		} finally {
			for (const release of releases) release();
			await response;
			await Promise.allSettled(retained);
			await f.close();
		}
	});
	await test('actual HTTP without context remains bounded, aborts held publish, preserves committed sale and replay intent', async () => {
		const f = await fixture();
		const releases: Array<() => void> = [];
		const signals: AbortSignal[] = [];
		try {
			f.env.REALTIME_HUB = {
				idFromName: () => 'id',
				get: () => ({
					fetch: (request: Request) => {
						if (new URL(request.url).pathname === '/rate-limit')
							return Promise.resolve(
								Response.json({
									allowed: true,
									limit: 100,
									count: 1,
									retryAfterSeconds: 0,
									resetAt: NOW + 5000
								})
							);
						assert.equal(new URL(request.url).pathname, '/publish');
						signals.push(request.signal);
						return new Promise<Response>((resolve) =>
							releases.push(() => resolve(new Response(null, { status: 204 })))
						);
					}
				})
			};
			const start = performance.now();
			const response = await f.http('fallback-key');
			assert.equal(response.status, 200);
			assert.ok(
				performance.now() - start <
					POST_COMMIT_EFFECTS_TIMEOUT_MS + REALTIME_PUBLISH_TIMEOUT_MS + 5000
			);
			assert.equal(signals.length, 2);
			assert.ok(
				signals.every((signal) => signal.aborted),
				'Both actual requests are aborted even when mock ignores signals'
			);
			assert.equal(await f.count('buku_kas'), 1);
			assert.equal(await f.count('audit_log_outbox'), 1);
			const retry = await f.http('fallback-key');
			assert.equal(retry.status, 200);
			assert.equal((await retry.json()).idempotent, true);
			assert.equal(await f.count('buku_kas'), 1);
			assert.equal(await f.count('audit_log_outbox'), 1);
		} finally {
			for (const release of releases) release();
			await f.close();
		}
	});
	await test('publisher fast success clears abort timer rather than aborting completed request later', async () => {
		let signal: AbortSignal | undefined;
		await publishBranchEvent(
			{
				REALTIME_HUB: {
					idFromName: () => 'id',
					get: () => ({
						fetch: async (request: Request) => {
							signal = request.signal;
							return new Response(null, { status: 204 });
						}
					})
				}
			},
			BRANCH,
			'buku_kas',
			'insert',
			{},
			30
		);
		assert.ok(signal);
		await sleep(80);
		assert.equal(signal.aborted, false, 'No outstanding auto-abort timer after fast success');
	});
	await test('signal-aware settle timeout actively cancels and throwing execution context falls back bounded', async () => {
		let aborted = false;
		const tasks = [
			(signal: AbortSignal) =>
				new Promise<void>((_resolve, reject) => {
					signal.addEventListener(
						'abort',
						() => {
							aborted = true;
							reject(signal.reason);
						},
						{ once: true }
					);
				})
		];
		const started = performance.now();
		await settlePostCommitEffects(tasks, 40, {
			waitUntil: () => {
				throw new Error('Context unavailable');
			}
		});
		assert.equal(aborted, true);
		assert.ok(performance.now() - started < 1000);
	});
	console.log(
		'post-commit-tests: durable intent/atomic failure/replay/drain/actual HTTP context/cancel/timer cleanup',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	mock.timers.reset();
}
