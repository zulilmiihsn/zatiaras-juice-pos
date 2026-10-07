import assert from 'node:assert/strict';
import worker from '../lib/server/realtimeWorker.js';
import { createTestD1 } from './helpers/testD1';

// AUD-051: retensi teknis + drain outbox bounded; pending/leased tak tersentuh.
const { db, close } = await createTestD1();
const OLD_ISO = '2020-01-01T00:00:00.000Z';
const OLD_MS = 1577836800000;
const NOW_ISO = new Date().toISOString();
const NOW_MS = Date.now();
function outboxRow(id: string) {
	return `('${id}','samarinda','{"action":"uji-retensi","entityType":"uji","entityId":"${id}","session":{"userId":"u","username":"o","role":"pemilik"}}',0,'${NOW_ISO}','${NOW_ISO}')`;
}
try {
	const outboxValues = Array.from({ length: 250 }, (_, i) => outboxRow(`ob-${i}`)).join(',');
	await db.batch([
		db.prepare(
			`INSERT INTO audit_log_outbox (id, cabang_id, payload, attempt_count, created_at, updated_at) VALUES ${outboxValues}`
		),
		db.prepare(
			`INSERT INTO audit_logs (id, cabang_id, action, entity_type, created_at) VALUES
			 ('log-tua','samarinda','x','uji','${OLD_ISO}'), ('log-baru','samarinda','x','uji','${NOW_ISO}')`
		),
		db.prepare(
			`INSERT INTO error_events (id, cabang_id, source, message, created_at) VALUES
			 ('err-tua','samarinda','s','m','${OLD_ISO}'), ('err-baru','samarinda','s','m','${NOW_ISO}')`
		),
		db.prepare(
			`INSERT INTO audit_log_quarantine (id, cabang_id, payload, quarantined_at) VALUES
			 ('kar-tua','samarinda','{}','${OLD_ISO}'), ('kar-baru','samarinda','{}','${NOW_ISO}')`
		),
		db.prepare(
			`INSERT INTO antrean_notification_events (event_id, cabang_id, buku_kas_id, idempotency_key, created_at) VALUES
			 ('ev-pending','samarinda','bk','k1','${OLD_ISO}'),
			 ('ev-bebas','samarinda','bk','k2','${OLD_ISO}'),
			 ('ev-baru','samarinda','bk','k3','${NOW_ISO}')`
		),
		db.prepare(
			`INSERT INTO antrean_notification_deliveries (event_id, cabang_id, device_id, context_id, state, attempts, next_attempt_at, lease_until) VALUES
			 ('ev-pending','samarinda','dev-1','ctx','pending',1,${OLD_MS},0),
			 ('ev-pending','samarinda','dev-2','ctx','leased',1,${OLD_MS},${NOW_MS + 60000}),
			 ('ev-bebas','samarinda','dev-1','ctx','sent',1,${OLD_MS},0),
			 ('ev-bebas','samarinda','dev-3','ctx','failed',8,${OLD_MS},0),
			 ('ev-baru','samarinda','dev-1','ctx','sent',1,${NOW_MS},0)`
		),
		db.prepare(
			`INSERT INTO antrean_notification_devices (device_id, token_hash, cabang_id, user_id, session_id, context_id, active, sound_enabled, expires_at, baseline_cursor, seen_cursor, delivered_cursor, dispatch_cursor, updated_at) VALUES
			 ('dev-mati','h','samarinda','u','s','ctx',0,1,${OLD_MS},0,0,0,0,${OLD_MS}),
			 ('dev-aktif','h','samarinda','u','s','ctx',1,1,${OLD_MS},0,0,0,0,${OLD_MS}),
			 ('dev-recent','h','samarinda','u','s','ctx',0,1,${NOW_MS},0,0,0,0,${NOW_MS})`
		)
	]);

	const env = {
		DB_SAMARINDA_GROUP: db,
		DB_BALIKPAPAN_GROUP: db,
		DB_BERAU_GROUP: db
	};
	// Cron menit: relay saja, tanpa hapus apa pun.
	await (worker as unknown as { scheduled: (e: unknown, e2: unknown) => Promise<void> }).scheduled(
		{ cron: '* * * * *' },
		env
	);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<number>('n'), 2);

	// Cron harian: drain + retensi.
	await (worker as unknown as { scheduled: (e: unknown, e2: unknown) => Promise<void> }).scheduled(
		{ cron: '0 3 * * *' },
		env
	);

	// Outbox 250 terdrain seluruhnya (bukan 100/hari).
	assert.equal(
		await db.prepare('SELECT COUNT(*) AS n FROM audit_log_outbox').first<number>('n'),
		0
	);
	// Log/error/karantina tua hilang, baru utuh.
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE id = 'log-tua'`)
			.first<number>('n'),
		0
	);
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM error_events WHERE id = 'err-tua'`)
			.first<number>('n'),
		0
	);
	assert.equal(
		await db
			.prepare(`SELECT COUNT(*) AS n FROM audit_log_quarantine WHERE id = 'kar-tua'`)
			.first<number>('n'),
		0
	);
	for (const id of ['log-baru', 'err-baru', 'kar-baru']) {
		const table = id.startsWith('log')
			? 'audit_logs'
			: id.startsWith('err')
				? 'error_events'
				: 'audit_log_quarantine';
		assert.equal(
			await db
				.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`)
				.bind(id)
				.first<number>('n'),
			1,
			id
		);
	}
	// audit_logs: 250 drain + log-baru (log-tua terhapus).
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<number>('n'), 251);

	// Delivery: pending/leased tua UTUH; terminal tua hilang; terminal baru utuh.
	const states = (await db
		.prepare(`SELECT device_id, state FROM antrean_notification_deliveries ORDER BY device_id`)
		.all()) as unknown as { results: Array<{ device_id: string; state: string }> };
	assert.deepEqual(
		states.results.map((r) => `${r.device_id}:${r.state}`).sort(),
		['dev-1:pending', 'dev-1:sent', 'dev-2:leased'].sort()
	);
	// Event: dirujuk pending/leased utuh; bebas tua hilang; baru utuh.
	const events = (await db
		.prepare(`SELECT event_id FROM antrean_notification_events ORDER BY event_id`)
		.all()) as unknown as { results: Array<{ event_id: string }> };
	assert.deepEqual(events.results.map((r) => r.event_id).sort(), ['ev-baru', 'ev-pending'].sort());
	// Device: nonaktif kedaluwarsa hilang; aktif/recent utuh.
	const devices = (await db
		.prepare(`SELECT device_id FROM antrean_notification_devices ORDER BY device_id`)
		.all()) as unknown as { results: Array<{ device_id: string }> };
	assert.deepEqual(
		devices.results.map((r) => r.device_id).sort(),
		['dev-aktif', 'dev-recent'].sort()
	);

	console.log(
		'retention-tests: drain-250/retensi/pending-leased-aman passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
