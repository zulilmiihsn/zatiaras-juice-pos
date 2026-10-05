import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { branchContext } from '../lib/server/branchResolver';
import { executeCheckout } from '../lib/server/checkout/checkoutUseCase';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import {
	buildOrderCreatedStatement,
	deviceById,
	eventHead
} from '../lib/server/orderNotifications/repository';
import {
	acknowledgeNotifications,
	listNotifications,
	registerNotificationDevice,
	resolveCheckoutNotificationOrigin,
	revokeNotificationSession
} from '../lib/server/orderNotifications/useCase';
import { dispatchOrderNotifications } from '../lib/server/orderNotifications/delivery';
import {
	notificationConfig,
	sendWebPush,
	validateSubscription
} from '../lib/server/orderNotifications/webPush';
import { GET as feedGet } from '../routes/api/antrean/notifikasi/+server';
import {
	POST as devicePost,
	DELETE as deviceDelete
} from '../routes/api/antrean/notifikasi/perangkat/+server';
import { POST as ackPost } from '../routes/api/antrean/notifikasi/ack/+server';
import { GET as configGet } from '../routes/api/antrean/notifikasi/config/+server';
import type { AuthSession } from '../lib/server/sessionStore';
import type { OrderPushMessage, OrderPushSubscription } from '../lib/types/orderNotifications';
import { createTestD1 } from './helpers/testD1';

const first = await createTestD1();
const second = await createTestD1();
const db = first.db,
	remote = second.db;
const branch = branchContext('samarinda'),
	other = branchContext('balikpapan');
const now = Date.parse('2026-10-04T01:00:00.000Z');
const realNow = Date.now;
Date.now = () => now;
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
	'sign',
	'verify'
]);
const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
const env = {
	DB_SAMARINDA_GROUP: db,
	DB_BALIKPAPAN_GROUP: remote,
	VAPID_PUBLIC_KEY: encode(publicRaw),
	VAPID_PRIVATE_KEY: privateJwk.d!,
	VAPID_SUBJECT: 'mailto:notification-test@example.invalid',
	POS_PRICE_SIGNING_KEY: encode(crypto.getRandomValues(new Uint8Array(32))),
	POS_PRICE_SIGNING_KEY_ID: 'test'
};
const subscription: OrderPushSubscription = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/notification-test',
	keys: { p256dh: encode(publicRaw), auth: encode(crypto.getRandomValues(new Uint8Array(16))) }
};
const deviceTokens = new Map<number, string>();
function identity(index: number) {
	let token = deviceTokens.get(index);
	if (!token) {
		token = crypto.randomUUID();
		deviceTokens.set(index, token);
	}
	return {
		device_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
		device_token: token
	};
}
function session(index: number, branchId = 'samarinda'): AuthSession {
	return {
		id: `${branchId}.notify-session-${index}`,
		userId: `notify-user-${branchId}-${index}`,
		username: `notify-${index}`,
		role: 'pemilik',
		branch: branchId,
		createdAt: now,
		expiresAt: now + 86400000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}
async function seedSession(value: AuthSession, database = db): Promise<void> {
	await database.batch([
		database
			.prepare(
				'INSERT OR IGNORE INTO profil(id,cabang_id,role,username,password) VALUES (?,?,?,?,?)'
			)
			.bind(value.userId, value.branch!, value.role, value.username, 'fixture-no-login'),
		database
			.prepare(
				`INSERT OR REPLACE INTO auth_sessions(id,cabang_id,user_id,username,role,created_at,expires_at,unlocked_pages,unlock_expires_at)
   VALUES (?,?,?,?,?,?,?,'[]',0)`
			)
			.bind(
				value.id,
				value.branch!,
				value.userId,
				value.username,
				value.role,
				value.createdAt,
				value.expiresAt
			)
	]);
}
async function reset(): Promise<void> {
	for (const database of [db, remote])
		await database.batch(
			[
				'antrean_notification_deliveries',
				'antrean_notification_events',
				'antrean_notification_devices',
				'auth_sessions',
				'profil',
				'transaksi_kasir',
				'buku_kas',
				'produk'
			].map((table) => database.prepare(`DELETE FROM ${table}`))
		);
}
async function seedOrder(
	key: string,
	origin: string | null = null,
	database = db,
	branchId = branch
): Promise<number> {
	const created = '2026-10-04T01:00:00.000Z';
	await database.batch([
		database
			.prepare(
				`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,jumlah,deskripsi,
   transaction_id,idempotency_key,stock_policy_mode,stock_policy_revision,stock_replay_disposition,
   preparation_state,preparation_revision,restored_from_archive,created_at,updated_at)
   VALUES (?,? ,?,'pos','in','pendapatan_usaha',15000,1,'Notifikasi',?,?,'tracked',0,'normal','pending',0,0,?,?)`
			)
			.bind(`bk-${key}`, branchId, created, `transaction-${key}`, key, created, created),
		buildOrderCreatedStatement(database, branchId, {
			bukuKasId: `bk-${key}`,
			idempotencyKey: key,
			originDeviceId: origin,
			createdAt: created
		})
	]);
	return eventHead(database, branchId);
}
async function register(
	index: number,
	options: { push?: boolean; sound?: boolean; session?: AuthSession } = {}
): Promise<AuthSession> {
	const current = options.session ?? session(index);
	await seedSession(current, current.branch === 'balikpapan' ? remote : db);
	await registerNotificationDevice(env, current.branch === 'balikpapan' ? other : branch, current, {
		...identity(index),
		sound_enabled: options.sound ?? true,
		...(options.push
			? {
					subscription: { ...subscription, endpoint: `${subscription.endpoint}/${index}` }
				}
			: {})
	});
	return current;
}
async function status(run: () => unknown, expected: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === expected
	);
}
function event(
	method: string,
	path: string,
	current: AuthSession | null,
	body?: unknown,
	headers: Record<string, string> = {}
) {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		locals: { authSession: current },
		platform: { env },
		request: new Request(url, {
			method,
			headers: { ...headers, 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		})
	};
}
async function deliveries(database: D1Database = db) {
	return (
		await database
			.prepare(
				'SELECT event_id,device_id,context_id,state,attempts,next_attempt_at,lease_until FROM antrean_notification_deliveries ORDER BY device_id,event_id'
			)
			.all<{
				event_id: string;
				device_id: string;
				context_id: string;
				state: string;
				attempts: number;
				next_attempt_at: number;
				lease_until: number;
			}>()
	).results;
}
try {
	// Real cryptographic readiness rejects an invalid/mismatched pair and unsafe subscription endpoints/points.
	assert.deepEqual(await notificationConfig({}), {
		push_configured: false,
		vapid_public_key: null
	});
	assert.equal((await notificationConfig(env)).push_configured, true);
	const mismatched = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const wrong = await crypto.subtle.exportKey('jwk', mismatched.privateKey);
	assert.equal(
		(await notificationConfig({ ...env, VAPID_PRIVATE_KEY: wrong.d })).push_configured,
		false
	);
	assert.deepEqual(await notificationConfig({ ...env, VAPID_SUBJECT: 'http://localhost' }), {
		push_configured: false,
		vapid_public_key: null
	});
	for (const endpoint of [
		'http://fcm.googleapis.com/a',
		'https://127.0.0.1/a',
		'https://fcm.googleapis.com.attacker.invalid/a',
		'https://user@fcm.googleapis.com/a',
		'https://fcm.googleapis.com:8443/a'
	]) {
		await assert.rejects(validateSubscription({ ...subscription, endpoint }));
	}
	await assert.rejects(
		validateSubscription({
			...subscription,
			keys: { ...subscription.keys, p256dh: encode(new Uint8Array(65).fill(4)) }
		})
	);
	await assert.rejects(
		validateSubscription({
			...subscription,
			keys: { ...subscription.keys, auth: encode(new Uint8Array(17)) }
		})
	);
	const oldFetch = globalThis.fetch;
	const pushMessage: OrderPushMessage = {
		version: 1,
		type: 'order_created',
		branch,
		user_id: 'u',
		device_id: identity(1).device_id,
		sequence: 1,
		event_id: 'generic-event',
		order_id: 'generic-order',
		origin_device_id: null,
		sound_enabled: false
	};
	try {
		let providerCalls = 0;
		globalThis.fetch = async () => {
			providerCalls++;
			return Response.redirect('https://attacker.invalid/target', 302);
		};
		await assert.rejects(sendWebPush(env, subscription, pushMessage));
		assert.equal(providerCalls, 1);
	} finally {
		globalThis.fetch = oldFetch;
	}

	// Auth and branch rejection happen before any database dependency; body cannot select another branch.
	for (const role of ['admin', 'tamu']) {
		for (const handler of [feedGet, configGet, devicePost, deviceDelete, ackPost]) {
			const method =
				handler === feedGet || handler === configGet
					? 'GET'
					: handler === deviceDelete
						? 'DELETE'
						: 'POST';
			const input = event(
				method,
				'/api/antrean/notifikasi',
				{ ...session(1), role },
				method === 'GET' ? undefined : {}
			);
			input.platform = { env: {} } as typeof input.platform;
			await status(() => handler(input as never), 403);
		}
	}
	await status(() => configGet(event('GET', '/api/antrean/notifikasi/config', null) as never), 401);
	await status(
		() =>
			configGet(
				event('GET', '/api/antrean/notifikasi/config?branch=balikpapan', session(1)) as never
			),
		403
	);
	await status(
		() =>
			devicePost(
				event('POST', '/api/antrean/notifikasi/perangkat', session(1), {
					...identity(1),
					sound_enabled: 'yes'
				}) as never
			),
		400
	);

	const interruptedRequest = event('POST', '/api/antrean/notifikasi/perangkat', session(1));
	const interruptedBody = {
		method: 'POST',
		duplex: 'half',
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"device_id":'));
			},
			pull(controller) {
				controller.error(new Error('connection reset'));
			}
		})
	};
	interruptedRequest.request = new Request(interruptedRequest.url, interruptedBody);
	interruptedRequest.platform = { env: {} } as typeof interruptedRequest.platform;
	await status(() => devicePost(interruptedRequest as never), 400);

	// A native subscription cannot target two logical identities, even if both callers own their IDs.
	await reset();
	await register(1, { push: true });
	const competing = await register(2);
	const existingEndpoint = JSON.parse(
		(await deviceById(env, identity(1).device_id))!.subscription!
	);
	await status(
		() =>
			registerNotificationDevice(env, branch, competing, {
				...identity(2),
				sound_enabled: true,
				subscription: existingEndpoint
			}),
		409
	);
	assert.equal((await deviceById(env, identity(2).device_id))!.subscription, null);
	await db
		.prepare('UPDATE antrean_notification_devices SET expires_at=0 WHERE device_id=?')
		.bind(identity(1).device_id)
		.run();
	const recovered = await registerNotificationDevice(env, branch, competing, {
		...identity(2),
		sound_enabled: true,
		subscription: existingEndpoint
	});
	assert.equal(recovered.push_active, true);
	assert.equal((await deviceById(env, identity(1).device_id))!.active, 0);
	const nextRecipient = await register(3);
	await registerNotificationDevice(env, branch, competing, {
		...identity(2),
		sound_enabled: true,
		subscription: null
	});
	const competingClaims = await Promise.allSettled([
		registerNotificationDevice(env, branch, competing, {
			...identity(2),
			sound_enabled: true,
			subscription: existingEndpoint
		}),
		registerNotificationDevice(env, branch, nextRecipient, {
			...identity(3),
			sound_enabled: true,
			subscription: existingEndpoint
		})
	]);
	assert.equal(competingClaims.filter((result) => result.status === 'fulfilled').length, 1);
	const rejected = competingClaims.find((result) => result.status === 'rejected');
	assert.ok(rejected?.status === 'rejected');
	assert.equal(rejected.reason.status, 409);

	// Initial enable has no history. Two-event burst replays page-by-page, including completed/archive cancellation metadata.
	await reset();
	await seedOrder('historical');
	const viewer = await register(1);
	const baseline = (await deviceById(env, identity(1).device_id))!.baseline_cursor;
	assert.equal(baseline, await eventHead(db, branch));
	const one = await seedOrder('burst-one');
	const two = await seedOrder('burst-two');
	await seedOrder('other-branch', null, remote, other);
	const page1 = await listNotifications(env, branch, viewer, identity(1), 0, 1);
	assert.deepEqual(
		page1.items.map((row) => [row.order_id, row.sequence]),
		[['bk-burst-one', one]]
	);
	assert.equal(page1.has_more, true);
	const page2 = await listNotifications(env, branch, viewer, identity(1), page1.next_cursor, 1);
	assert.deepEqual(
		page2.items.map((row) => [row.order_id, row.sequence]),
		[['bk-burst-two', two]]
	);
	assert.equal(page2.has_more, false);
	await db
		.prepare(
			"UPDATE buku_kas SET preparation_state='done',preparation_completed_at=?,preparation_completed_by=? WHERE cabang_id=? AND id=?"
		)
		.bind('2026-10-04T02:00:00.000Z', viewer.userId, branch, 'bk-burst-one')
		.run();
	await db
		.prepare('DELETE FROM buku_kas WHERE cabang_id=? AND id=?')
		.bind(branch, 'bk-burst-two')
		.run();
	assert.deepEqual(
		(await listNotifications(env, branch, viewer, identity(1), baseline, 100)).items.map(
			(row) => row.is_pending
		),
		[false, false]
	);
	await status(() => listNotifications(env, other, viewer, identity(1), 0, 100), 403);
	await status(
		() =>
			listNotifications(
				env,
				branch,
				viewer,
				{ ...identity(1), device_token: identity(2).device_token },
				0,
				100
			),
		403
	);
	await status(
		() =>
			registerNotificationDevice(env, branch, viewer, {
				...identity(1),
				device_token: identity(2).device_token,
				sound_enabled: true
			}),
		403
	);
	await acknowledgeNotifications(env, branch, viewer, {
		...identity(1),
		cursor: two,
		kind: 'seen'
	});
	await acknowledgeNotifications(env, branch, viewer, {
		...identity(1),
		cursor: one,
		kind: 'seen'
	});
	assert.equal((await deviceById(env, identity(1).device_id))!.seen_cursor, two);
	await status(
		() =>
			acknowledgeNotifications(env, branch, viewer, {
				...identity(1),
				cursor: two + 100,
				kind: 'seen'
			}),
		400
	);

	// Global ownership survives rebind across shards; exactly one current context, same-context refresh keeps unseen state.
	await reset();
	const original = await register(1, { push: true });
	const unseen = await seedOrder('refresh-unseen');
	const previous = (await deviceById(env, identity(1).device_id))!;
	const refreshed = { ...original, id: 'samarinda.notification-refresh' };
	await seedSession(refreshed);
	const refreshResult = await registerNotificationDevice(env, branch, refreshed, {
		...identity(1),
		sound_enabled: false
	});
	assert.equal(refreshResult.baseline_cursor, previous.baseline_cursor);
	assert.equal(refreshResult.acknowledged_cursor, previous.seen_cursor);
	assert.equal(refreshResult.push_active, true);
	assert.equal(
		(await listNotifications(env, branch, refreshed, identity(1), 0, 100)).items[0].sequence,
		unseen
	);
	await db
		.prepare('UPDATE antrean_notification_devices SET expires_at=0 WHERE device_id=?')
		.bind(identity(1).device_id)
		.run();
	const afterExpiry = await registerNotificationDevice(env, branch, refreshed, {
		...identity(1),
		sound_enabled: false
	});
	assert.equal(afterExpiry.baseline_cursor, unseen);
	assert.equal(afterExpiry.acknowledged_cursor, unseen);
	assert.equal(afterExpiry.push_active, false);
	assert.notEqual((await deviceById(env, identity(1).device_id))!.context_id, previous.context_id);
	const rebound = session(2, 'balikpapan');
	await seedSession(rebound, remote);
	await seedOrder('rebind-old', null, remote, other);
	await registerNotificationDevice(env, other, rebound, { ...identity(1), sound_enabled: true });
	const owned = (await deviceById(env, identity(1).device_id))!;
	assert.equal(owned.cabang_id, 'balikpapan');
	assert.notEqual(owned.context_id, previous.context_id);
	assert.equal(owned.subscription, null);
	assert.equal(owned.baseline_cursor, await eventHead(remote, other));
	await status(() => listNotifications(env, branch, refreshed, identity(1), 0, 100), 403);
	assert.equal(
		(
			await resolveCheckoutNotificationOrigin(
				env,
				branch,
				original,
				identity(1).device_id,
				identity(1).device_token
			)
		).originDeviceId,
		null
	);
	await Promise.all([
		registerNotificationDevice(env, branch, refreshed, { ...identity(1), sound_enabled: true }),
		registerNotificationDevice(env, other, rebound, { ...identity(1), sound_enabled: true })
	]);
	const active = (
		await db
			.prepare(
				'SELECT cabang_id,context_id FROM antrean_notification_devices WHERE device_id=? AND active=1'
			)
			.bind(identity(1).device_id)
			.all()
	).results;
	assert.equal(active.length, 1);
	assert.ok(['samarinda', 'balikpapan'].includes(String(active[0].cabang_id)));

	// Actual checkout commits one event atomically; idempotent retry does not duplicate or modify its verified origin.
	await reset();
	const originSession = await register(1);
	await db
		.prepare(
			"INSERT INTO produk(id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES ('notify-product','samarinda','Jus',15000,0,0,0,1)"
		)
		.run();
	const source = { product_id: 'notify-product', jumlah: 1 };
	const quote = await signPosPricingToken(env, {
		kind: 'checkout_quote',
		branch: 'samarinda',
		ttlMs: 60000,
		data: {
			items: [
				{ source, product_name: 'Jus', product_price: 15000, add_ons: [], line_total: 15000 }
			],
			total_amount: 15000,
			total_qty: 1
		}
	});
	const body = {
		idempotency_key: 'notify-real-checkout',
		metode_bayar: 'tunai',
		cash_received: 15000,
		items: [source],
		quote_token: quote,
		origin_device_id: identity(1).device_id,
		origin_device_token: identity(1).device_token
	};
	const sale = await executeCheckout({
		db,
		branch,
		session: originSession,
		platform: { env: { ...env, VAPID_PRIVATE_KEY: undefined } },
		rawBody: body
	});
	const retry = await executeCheckout({
		db,
		branch,
		session: originSession,
		platform: { env: { ...env, VAPID_PRIVATE_KEY: undefined } },
		rawBody: { ...body, origin_device_token: identity(2).device_token }
	});
	assert.equal(sale.idempotent, false);
	assert.equal(retry.idempotent, true);
	const persisted = (
		await db
			.prepare(
				'SELECT e.origin_device_id,e.buku_kas_id,b.nominal FROM antrean_notification_events e INNER JOIN buku_kas b ON b.cabang_id=e.cabang_id AND b.id=e.buku_kas_id WHERE e.cabang_id=? AND e.idempotency_key=?'
			)
			.bind(branch, body.idempotency_key)
			.all<{ origin_device_id: string; buku_kas_id: string; nominal: number }>()
	).results;
	assert.equal(persisted.length, 1);
	assert.equal(persisted[0].origin_device_id, identity(1).device_id);
	assert.equal(persisted[0].nominal, 15000);
	assert.equal(
		(await listNotifications(env, branch, originSession, identity(1), 0, 100)).items.length,
		0
	);
	// Registry failure during actual checkout preserves a private hash proof; recovery still excludes the source.
	await register(2);
	let registryFailures = 0;
	const outageDb = new Proxy(db, {
		get(target, property, receiver) {
			if (property === 'prepare')
				return (query: string) => {
					if (query === 'SELECT * FROM antrean_notification_devices WHERE device_id=?') {
						registryFailures++;
						throw new Error('injected registry outage');
					}
					return target.prepare(query);
				};
			return Reflect.get(target, property, receiver);
		}
	});
	const outageBody = { ...body, idempotency_key: 'notify-outage-checkout' };
	const outageSale = await executeCheckout({
		db,
		branch,
		session: originSession,
		platform: { env: { ...env, DB_SAMARINDA_GROUP: outageDb, VAPID_PRIVATE_KEY: undefined } },
		rawBody: outageBody
	});
	assert.equal(outageSale.idempotent, false);
	assert.equal(registryFailures, 1);
	const deferred = await db
		.prepare(
			'SELECT origin_device_id,claimed_origin_device_id,origin_device_token_hash FROM antrean_notification_events WHERE cabang_id=? AND idempotency_key=?'
		)
		.bind(branch, outageBody.idempotency_key)
		.first<{
			origin_device_id: string | null;
			claimed_origin_device_id: string;
			origin_device_token_hash: string;
		}>();
	assert.equal(deferred!.origin_device_id, null);
	assert.equal(deferred!.claimed_origin_device_id, identity(1).device_id);
	assert.equal(
		deferred!.origin_device_token_hash,
		(await deviceById(env, identity(1).device_id))!.token_hash
	);
	assert.notEqual(deferred!.origin_device_token_hash, identity(1).device_token);
	assert.equal(
		(await listNotifications(env, branch, originSession, identity(1), 0, 100)).items.length,
		0
	);
	const receiverFeed = await listNotifications(env, branch, session(2), identity(2), 0, 100);
	assert.equal(receiverFeed.items.length, 1);
	assert.equal(receiverFeed.items[0].origin_device_id, null);
	assert.equal('origin_device_token_hash' in receiverFeed.items[0], false);
	assert.equal('claimed_origin_device_id' in receiverFeed.items[0], false);
	await registerNotificationDevice(env, branch, originSession, {
		...identity(1),
		sound_enabled: true,
		subscription: { ...subscription, endpoint: `${subscription.endpoint}/1` }
	});
	await registerNotificationDevice(env, branch, session(2), {
		...identity(2),
		sound_enabled: true,
		subscription: { ...subscription, endpoint: `${subscription.endpoint}/2` }
	});
	const outageSent: OrderPushMessage[] = [];
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async (_subscription, message) => {
			outageSent.push(message);
			return new Response(null, { status: 201 });
		}
	});
	assert.deepEqual(
		outageSent.map((message) => message.device_id),
		[identity(2).device_id]
	);
	assert.equal(outageSent[0].origin_device_id, null);
	assert.equal('origin_device_token_hash' in outageSent[0], false);
	assert.equal('claimed_origin_device_id' in outageSent[0], false);
	// A forged target ID with the wrong secret cannot suppress either target feed or push.
	const spoofBody = {
		...body,
		idempotency_key: 'notify-spoof-checkout',
		origin_device_id: identity(2).device_id,
		origin_device_token: identity(99).device_token
	};
	await executeCheckout({
		db,
		branch,
		session: originSession,
		platform: { env: { ...env, VAPID_PRIVATE_KEY: undefined } },
		rawBody: spoofBody
	});
	const spoofFeed = await listNotifications(
		env,
		branch,
		session(2),
		identity(2),
		receiverFeed.next_cursor,
		100
	);
	assert.equal(spoofFeed.items.length, 1);
	assert.equal(spoofFeed.items[0].origin_device_id, null);
	const spoofSent: OrderPushMessage[] = [];
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async (_subscription, message) => {
			spoofSent.push(message);
			return new Response(null, { status: 201 });
		}
	});
	assert.deepEqual(spoofSent.map((message) => message.device_id).sort(), [
		identity(1).device_id,
		identity(2).device_id
	]);
	// Event insertion shares the transaction: deliberately aborting it rolls the sale/header back too.
	await db
		.prepare(
			`CREATE TRIGGER notify_test_event_failure BEFORE INSERT ON antrean_notification_events WHEN NEW.idempotency_key='notify-rollback' BEGIN SELECT RAISE(ABORT,'injected notification event failure'); END`
		)
		.run();
	try {
		await assert.rejects(
			executeCheckout({
				db,
				branch,
				session: originSession,
				platform: { env: { ...env, VAPID_PRIVATE_KEY: undefined } },
				rawBody: { ...body, idempotency_key: 'notify-rollback' }
			})
		);
		assert.equal(
			await db
				.prepare(
					"SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id='samarinda' AND idempotency_key='notify-rollback'"
				)
				.first('n'),
			0
		);
	} finally {
		await db.prepare('DROP TRIGGER notify_test_event_failure').run();
	}

	// Recipients are branch/current-session scoped; origin, delivered, seen and expired recipients do not send.
	await reset();
	const origin = await register(1, { push: true });
	const audible = await register(2, { push: true });
	await register(3, { push: true, sound: false });
	const acknowledged = await register(4, { push: true });
	const expired = await register(5, { push: true });
	await register(6, { push: true, session: session(6, 'balikpapan') });
	const sequence = await seedOrder('recipient-order', identity(1).device_id);
	await acknowledgeNotifications(env, branch, acknowledged, {
		...identity(4),
		cursor: sequence,
		kind: 'delivered'
	});
	await db
		.prepare('DELETE FROM auth_sessions WHERE cabang_id=? AND id=?')
		.bind(branch, expired.id)
		.run();
	const sent: OrderPushMessage[] = [];
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async (_subscription, message) => {
			sent.push(message);
			return new Response(null, { status: 201 });
		}
	});
	assert.deepEqual(sent.map((message) => message.device_id).sort(), [
		identity(2).device_id,
		identity(3).device_id
	]);
	assert.equal(
		sent.find((message) => message.device_id === identity(3).device_id)!.sound_enabled,
		false
	);
	assert.equal(sent[0].origin_device_id, identity(1).device_id);
	assert.equal((await deviceById(env, identity(4).device_id))!.seen_cursor, 0);
	await dispatchOrderNotifications(env, branch, {
		now: now + 60000,
		send: async () => {
			throw new Error('duplicate sent delivery');
		}
	});
	assert.equal((await deliveries()).filter((row) => row.state === 'sent').length, 2);
	await acknowledgeNotifications(env, branch, audible, {
		...identity(2),
		cursor: sequence,
		kind: 'seen'
	});
	assert.equal((await deviceById(env, identity(3).device_id))!.seen_cursor, 0);
	assert.equal(
		(
			await resolveCheckoutNotificationOrigin(
				env,
				branch,
				origin,
				identity(1).device_id,
				identity(1).device_token
			)
		).originDeviceId,
		identity(1).device_id
	);
	await revokeNotificationSession({ env }, branch, origin.id);
	assert.equal((await deviceById(env, identity(1).device_id))!.active, 0);
	assert.equal(
		(
			await resolveCheckoutNotificationOrigin(
				env,
				branch,
				origin,
				identity(1).device_id,
				identity(1).device_token
			)
		).originDeviceId,
		null
	);

	// 404/410 remove only the matching subscription. Retryable provider outcomes survive process restarts and are bounded.
	for (const providerStatus of [404, 410, 429, 503]) {
		await reset();
		await register(1, { push: true });
		await seedOrder(`provider-${providerStatus}`);
		let sends = 0;
		await dispatchOrderNotifications(env, branch, {
			now,
			send: async () => {
				sends++;
				return new Response(null, {
					status: providerStatus,
					headers: providerStatus === 429 ? { 'Retry-After': '120' } : {}
				});
			}
		});
		const delivery = (await deliveries())[0];
		assert.equal(sends, 1);
		if (providerStatus === 404 || providerStatus === 410) {
			assert.equal(delivery.state, 'cancelled');
			assert.equal((await deviceById(env, identity(1).device_id))!.subscription, null);
		} else {
			assert.equal(delivery.state, 'pending');
			assert.equal(delivery.attempts, 1);
			assert.equal(delivery.next_attempt_at, now + (providerStatus === 429 ? 120000 : 30000));
			await dispatchOrderNotifications(env, branch, {
				now: delivery.next_attempt_at - 1,
				send: async () => {
					sends++;
					return new Response(null, { status: 201 });
				}
			});
			assert.equal(sends, 1);
			await dispatchOrderNotifications(env, branch, {
				now: delivery.next_attempt_at,
				send: async () => {
					sends++;
					return new Response(null, { status: 201 });
				}
			});
			assert.equal((await deliveries())[0].state, 'sent');
			assert.equal(sends, 2);
		}
	}
	await reset();
	await register(1, { push: true });
	await seedOrder('unknown-provider');
	for (let attempt = 1; attempt <= 8; attempt++) {
		const time = attempt === 1 ? now : (await deliveries())[0].next_attempt_at;
		await dispatchOrderNotifications(env, branch, {
			now: time,
			send: async () => {
				throw new Error('unknown provider outcome');
			}
		});
		assert.equal((await deliveries())[0].attempts, attempt);
	}
	assert.equal((await deliveries())[0].state, 'failed');
	await dispatchOrderNotifications(env, branch, {
		now: now + 20000000,
		send: async () => {
			assert.fail('bounded retries exceeded');
		}
	});
	assert.equal((await deliveries())[0].attempts, 8);

	await reset();
	const expiredDevice = await register(1, { push: true });
	await seedOrder('session-expired');
	await db
		.prepare('UPDATE auth_sessions SET expires_at=? WHERE cabang_id=? AND id=?')
		.bind(now, branch, expiredDevice.id)
		.run();
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async () => {
			assert.fail('expired session received push');
		}
	});
	assert.equal((await deliveries())[0].state, 'cancelled');
	await reset();
	await register(1, { push: true });
	await seedOrder('malformed-subscription');
	await db
		.prepare('UPDATE antrean_notification_devices SET subscription=? WHERE device_id=?')
		.bind('{malformed', identity(1).device_id)
		.run();
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async () => {
			assert.fail('malformed subscription sent');
		}
	});
	assert.equal((await deliveries())[0].state, 'pending');
	assert.equal((await deliveries())[0].attempts, 1);

	// Failed deliveries are cancelled after seen, completion, archive or rebind rather than retried on stale context.
	for (const cancellation of ['seen', 'completed', 'archived', 'rebound', 'role']) {
		await reset();
		const current = await register(1, { push: true });
		const head = await seedOrder(`cancel-${cancellation}`);
		await dispatchOrderNotifications(env, branch, {
			now,
			send: async () => new Response(null, { status: 503 })
		});
		if (cancellation === 'seen')
			await acknowledgeNotifications(env, branch, current, {
				...identity(1),
				cursor: head,
				kind: 'seen'
			});
		if (cancellation === 'completed')
			await db
				.prepare(
					"UPDATE buku_kas SET preparation_state='done',preparation_completed_at=?,preparation_completed_by=? WHERE cabang_id=? AND id=?"
				)
				.bind('2026-10-04T02:00:00.000Z', current.userId, branch, `bk-cancel-${cancellation}`)
				.run();
		if (cancellation === 'archived')
			await db
				.prepare('DELETE FROM buku_kas WHERE cabang_id=? AND id=?')
				.bind(branch, `bk-cancel-${cancellation}`)
				.run();
		if (cancellation === 'rebound') {
			const next = session(2, 'balikpapan');
			await seedSession(next, remote);
			await registerNotificationDevice(env, other, next, {
				...identity(1),
				sound_enabled: true,
				subscription
			});
		}
		if (cancellation === 'role')
			await db
				.prepare("UPDATE profil SET role='admin' WHERE cabang_id=? AND id=?")
				.bind(branch, current.userId)
				.run();
		await dispatchOrderNotifications(env, branch, {
			now: now + 30000,
			send: async () => {
				assert.fail(`sent after ${cancellation}`);
			}
		});
		assert.equal((await deliveries())[0].state, 'cancelled');
	}

	// Atomic claim prevents concurrent relays from sending the same recipient/event while its lease is valid.
	await reset();
	await register(1, { push: true });
	await seedOrder('concurrent-relay');
	let release!: () => void, started!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const sending = new Promise<void>((resolve) => {
		started = resolve;
	});
	let calls = 0;
	const run = dispatchOrderNotifications(env, branch, {
		now,
		send: async () => {
			calls++;
			started();
			await gate;
			return new Response(null, { status: 201 });
		}
	});
	await sending;
	await dispatchOrderNotifications(env, branch, {
		now,
		send: async () => {
			calls++;
			return new Response(null, { status: 201 });
		}
	});
	assert.equal(calls, 1);
	release();
	await run;
	assert.equal((await deliveries())[0].state, 'sent');

	// A slow first provider request must not give the next recipient an already-expired lease or stale retry deadline.
	await reset();
	await register(1, { push: true });
	await register(2, { push: true });
	await seedOrder('slow-relay');
	let clock = now,
		slowCalls = 0,
		releaseSlow!: () => void,
		startSlow!: () => void;
	const slowGate = new Promise<void>((resolve) => {
		releaseSlow = resolve;
	});
	const slowStarted = new Promise<void>((resolve) => {
		startSlow = resolve;
	});
	Date.now = () => clock;
	const slowRun = dispatchOrderNotifications(env, branch, {
		send: async (_subscription, message) => {
			slowCalls++;
			if (message.device_id === identity(1).device_id) {
				clock = now + 90000;
				return new Response(null, { status: 503 });
			}
			startSlow();
			await slowGate;
			return new Response(null, { status: 201 });
		}
	});
	try {
		await slowStarted;
		const slowRows = await deliveries();
		assert.equal(
			slowRows.find((row) => row.device_id === identity(1).device_id)!.next_attempt_at,
			clock + 30000
		);
		assert.equal(
			slowRows.find((row) => row.device_id === identity(2).device_id)!.lease_until,
			clock + 60000
		);
		await dispatchOrderNotifications(env, branch, {
			send: async () => {
				slowCalls++;
				return new Response(null, { status: 201 });
			}
		});
		assert.equal(slowCalls, 2);
	} finally {
		releaseSlow();
		await slowRun;
		Date.now = () => now;
	}

	// A crash after provider success but before durable ack leaves a lease; retry keeps event_id for SW dedup.
	await reset();
	await register(1, { push: true });
	await seedOrder('ack-crash');
	await db
		.prepare(
			`CREATE TRIGGER notify_test_ack_failure BEFORE UPDATE OF state ON antrean_notification_deliveries WHEN NEW.state='sent' BEGIN SELECT RAISE(ABORT,'injected delivery ack failure'); END`
		)
		.run();
	const eventIds: string[] = [];
	try {
		await assert.rejects(
			dispatchOrderNotifications(env, branch, {
				now,
				send: async (_subscription, message) => {
					eventIds.push(message.event_id);
					return new Response(null, { status: 201 });
				}
			})
		);
		assert.equal((await deliveries())[0].state, 'leased');
	} finally {
		await db.prepare('DROP TRIGGER notify_test_ack_failure').run();
	}
	await dispatchOrderNotifications(env, branch, {
		now: now + 60001,
		send: async (_subscription, message) => {
			eventIds.push(message.event_id);
			return new Response(null, { status: 201 });
		}
	});
	assert.equal(eventIds.length, 2);
	assert.equal(eventIds[0], eventIds[1]);
	assert.equal((await deliveries())[0].state, 'sent');

	// Explicit disable leaves durable in-app registration active; route registration/delete honor ownership.
	const current = session(1);
	const response = await devicePost(
		event('POST', '/api/antrean/notifikasi/perangkat', current, {
			...identity(1),
			sound_enabled: false,
			subscription: null
		}) as never
	);
	assert.equal((await response.json()).data.push_active, false);
	assert.equal((await deviceById(env, identity(1).device_id))!.active, 1);
	await status(
		() =>
			deviceDelete(
				event('DELETE', '/api/antrean/notifikasi/perangkat', current, {
					...identity(1),
					device_token: identity(2).device_token
				}) as never
			),
		403
	);
	await deviceDelete(
		event('DELETE', '/api/antrean/notifikasi/perangkat', current, identity(1)) as never
	);
	assert.equal((await deviceById(env, identity(1).device_id))!.active, 0);
	console.log(
		`Antrean notification backend: crypto, role/tenant/ownership, actual checkout atomicity, replay, recipient suppression, durable retries/leases/ack-crash passed (${process.argv.includes('--d1') ? 'workerd D1' : 'SQLite'}).`
	);
} finally {
	Date.now = realNow;
	try {
		await second.close();
	} finally {
		await first.close();
	}
}
