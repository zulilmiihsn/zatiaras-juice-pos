import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { checkOpsAlerts, describeUnhealthy, OPS_ALERT_COOLDOWN_MS } from '../lib/server/opsAlerts';
import type { OpsAlertPushMessage, OrderPushSubscription } from '../lib/types/orderNotifications';
import { createTestD1 } from './helpers/testD1';

// Alert operasional: lonjakan error/latensi dikirim ke perangkat pemilik saja, sekali per jeda.
const samarinda = branchContext('samarinda');
const NOW = Date.parse('2026-10-15T03:00:00.000Z');

// Ambang dihitung murni dari angka.
assert.equal(describeUnhealthy(samarinda, { requests: 100, serverErrors: 4, p95Ms: 2500 }), null);
assert.match(
	describeUnhealthy(samarinda, { requests: 100, serverErrors: 5, p95Ms: 200 }) ?? '',
	/^Samarinda: 5 error server/
);
assert.match(
	describeUnhealthy(samarinda, { requests: 20, serverErrors: 0, p95Ms: 4200 }) ?? '',
	/p95 4\.2 detik/
);
// Sampel terlalu sedikit tidak memicu alert latensi.
assert.equal(describeUnhealthy(samarinda, { requests: 19, serverErrors: 0, p95Ms: 9000 }), null);

const { db, close } = await createTestD1();
try {
	const subscription = (n: number) =>
		JSON.stringify({
			endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
			keys: { p256dh: 'p', auth: 'a' }
		});
	const expires = NOW + 60 * 60 * 1000;
	await db.batch([
		db.prepare(
			`INSERT INTO profil (id, cabang_id, username, password, role) VALUES
			 ('u-owner', 'samarinda', 'pemilik', 'x', 'pemilik'),
			 ('u-kasir', 'samarinda', 'kasir', 'x', 'kasir')`
		),
		db
			.prepare(
				`INSERT INTO auth_sessions (id, cabang_id, user_id, username, role, created_at, expires_at, unlocked_pages, unlock_expires_at)
				 VALUES ('samarinda.s-owner', 'samarinda', 'u-owner', 'pemilik', 'pemilik', ?, ?, '[]', 0),
				        ('samarinda.s-kasir', 'samarinda', 'u-kasir', 'kasir', 'kasir', ?, ?, '[]', 0)`
			)
			.bind(NOW, expires, NOW, expires),
		db
			.prepare(
				`INSERT INTO antrean_notification_devices
				 (device_id, token_hash, cabang_id, user_id, session_id, context_id, active, sound_enabled,
				  subscription, expires_at, baseline_cursor, seen_cursor, delivered_cursor, dispatch_cursor, updated_at)
				 VALUES ('d-owner', 'h1', 'samarinda', 'u-owner', 'samarinda.s-owner', 'c1', 1, 1, ?, ?, 0, 0, 0, 0, ?),
				        ('d-kasir', 'h2', 'samarinda', 'u-kasir', 'samarinda.s-kasir', 'c2', 1, 1, ?, ?, 0, 0, 0, 0, ?)`
			)
			.bind(subscription(1), expires, NOW, subscription(2), expires, NOW)
	]);
	const env = { DB_SAMARINDA_GROUP: db };
	const sent: OpsAlertPushMessage[] = [];
	let reply = 201;
	const send = async (_subscription: OrderPushSubscription, message: OpsAlertPushMessage) => {
		sent.push(message);
		return new Response(null, { status: reply });
	};

	// Cabang sehat: tidak ada kiriman.
	assert.deepEqual(await checkOpsAlerts(env, samarinda, { now: NOW, send }), {
		alerted: false,
		recipients: 0
	});

	const minuteAgo = new Date(NOW - 60_000).toISOString();
	await db.batch(
		Array.from({ length: 6 }, (_, i) =>
			db
				.prepare(
					`INSERT INTO request_metrics (id, cabang_id, method, path, status, duration_ms, created_at)
					 VALUES (?, 'samarinda', 'POST', '/api/pos/transaction', 500, 120, ?)`
				)
				.bind(`m-${i}`, minuteAgo)
		)
	);

	// Lonjakan: hanya perangkat pemilik yang menerima, pesan memuat ringkasan cabang.
	assert.deepEqual(await checkOpsAlerts(env, samarinda, { now: NOW, send }), {
		alerted: true,
		recipients: 1
	});
	assert.equal(sent.length, 1);
	assert.equal(sent[0].device_id, 'd-owner');
	assert.equal(sent[0].type, 'ops_alert');
	assert.match(sent[0].summary, /Samarinda: 6 error server/);

	// Dalam jeda 30 menit, lonjakan yang sama tidak dikirim ulang.
	assert.equal((await checkOpsAlerts(env, samarinda, { now: NOW + 60_000, send })).alerted, false);
	assert.equal(sent.length, 1);

	// Sesudah jeda, langganan yang ditolak provider (410) dilepas. Rate limit memakai jam
	// sistem, jadi jendelanya dikedaluwarsakan langsung.
	await db.prepare("UPDATE rate_limits SET reset_at = 0 WHERE identifier = 'ops-alert'").run();
	reply = 410;
	const later = NOW + OPS_ALERT_COOLDOWN_MS + 1000;
	await db
		.prepare('UPDATE request_metrics SET created_at = ?')
		.bind(new Date(later - 60_000).toISOString())
		.run();
	assert.equal((await checkOpsAlerts(env, samarinda, { now: later, send })).alerted, true);
	assert.equal(
		await db
			.prepare("SELECT subscription FROM antrean_notification_devices WHERE device_id = 'd-owner'")
			.first<string | null>('subscription'),
		null
	);

	console.log(
		'ops-alert-tests: ambang, penerima pemilik saja, jeda 30 menit, langganan 410 dilepas'
	);
} finally {
	await close();
}
