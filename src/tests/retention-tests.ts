import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../lib/server/realtimeWorker.js';
import { createTestD1 } from './helpers/testD1';
import { flushAuditLogOutbox as flushCanonicalOutbox } from '../lib/server/auditLog';
import { RETENTION_ROWS_PER_TABLE } from '../lib/server/technicalRetention';
import { AUDIT_SINK_CONFLICT_ATTEMPTS } from '../lib/server/auditDrain';

const NOW = Date.UTC(2026, 6, 3, 3);
const RECENT = '2026-07-02T00:00:00.000Z';
const OLD = '2020-01-01T00:00:00.000Z';
const OLD_MS = Date.parse(OLD);
async function fixture() {
	const handles: Awaited<ReturnType<typeof createTestD1>>[] = [];
	try {
		for (let i = 0; i < 3; i++) handles.push(await createTestD1());
		const [sam, bal, ber] = handles.map((h) => h.db);
		return {
			sam,
			bal,
			ber,
			env: {
				DB_SAMARINDA_GROUP: sam,
				DB_BALIKPAPAN_GROUP: bal,
				DB_BERAU_GROUP: ber,
				AUDIT_MAINTENANCE_QUERY_BUDGET: 900
			},
			close: async () => {
				for (const h of handles.reverse()) await h.close();
			}
		};
	} catch (error) {
		for (const h of handles.reverse()) await h.close();
		throw error;
	}
}
type Db = Awaited<ReturnType<typeof createTestD1>>['db'];
// Freeze domain time explicitly; SDK TLS/process timers must keep their real wall clock.
const flushAuditLogOutbox = (db: Db, branch: Parameters<typeof flushCanonicalOutbox>[1]) =>
	flushCanonicalOutbox(db, branch, 100, NOW);
const payload = (id: string) =>
	JSON.stringify({
		action: 'owned-audit',
		entityType: 'uji',
		entityId: id,
		transactionId: id,
		amount: 0,
		session: { userId: 'owned-actor', username: '', role: 'pemilik' },
		metadata: { marker: 'ü🧾', nested: { retained: true } },
		ipHash: ''
	});
async function enqueue(
	db: Db,
	id: string,
	branch = 'samarinda',
	body = payload(id),
	at = RECENT,
	attempts = 0
) {
	await db
		.prepare(
			'INSERT INTO audit_log_outbox(id,cabang_id,payload,attempt_count,created_at,updated_at) VALUES(?,?,?,?,?,?)'
		)
		.bind(id, branch, body, attempts, at, at)
		.run();
}
async function count(db: Db, table: string, where = '1=1') {
	return Number(
		await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<number>('n')
	);
}
async function tick(
	env: ReturnType<typeof fixture> extends Promise<infer F>
		? F extends { env: infer E }
			? E
			: never
		: never,
	cron = '0 3 * * *'
) {
	await worker.scheduled({ cron, scheduledTime: NOW }, env);
}

await test('scheduled audit preserves original event time, zero and complete canonical envelope; minute does not clean', async () => {
	const f = await fixture();
	try {
		await tick(f.env, '* * * * *');
		await enqueue(f.sam, 'owned-envelope');
		assert.equal(await count(f.sam, 'audit_log_outbox'), 1);
		await tick(f.env);
		const row = await f.sam
			.prepare('SELECT * FROM audit_logs WHERE id=?')
			.bind('owned-envelope')
			.first<Record<string, unknown>>();
		assert.ok(row);
		assert.equal(row.created_at, RECENT, 'Delivery time cannot replace committed event time');
		assert.equal(row.amount, 0, 'Zero is a known amount, not SQL NULL');
		assert.equal(row.actor_user_id, 'owned-actor');
		assert.equal(row.actor_username, '');
		assert.equal(row.actor_role, 'pemilik');
		assert.equal(row.transaction_id, 'owned-envelope');
		assert.equal(row.ip_hash, '');
		assert.deepEqual(JSON.parse(String(row.metadata)), {
			marker: 'ü🧾',
			nested: { retained: true }
		});
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
		await tick(f.env);
		assert.equal(await count(f.sam, 'audit_logs'), 1);
	} finally {
		await f.close();
	}
});

await test('actual scheduled sink and exact source deletion are one atomic mutation, including replay', async () => {
	const f = await fixture();
	try {
		await enqueue(f.sam, 'owned-late-delete');
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_late_delete BEFORE DELETE ON audit_log_outbox BEGIN SELECT RAISE(ABORT,'OWNED_LATE_DELETE'); END;"
			)
			.run();
		await tick(f.env);
		assert.equal(
			await count(f.sam, 'audit_logs'),
			0,
			'Delete failure must roll back the sink insert'
		);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 1);
		assert.equal(await count(f.sam, 'audit_log_quarantine'), 0);
		await f.sam.prepare('DROP TRIGGER owned_late_delete').run();
		await worker.scheduled({ cron: '0 3 * * *', scheduledTime: NOW + 120000 }, f.env);
		assert.equal(await count(f.sam, 'audit_logs'), 1);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
	} finally {
		await f.close();
	}
});

await test('transient head failures are attempted once per tick; healthy tail drains and malformed poison is retained in quarantine', async () => {
	const f = await fixture();
	try {
		await enqueue(f.sam, 'owned-malformed', 'samarinda', '{', RECENT);
		await f.sam.batch(
			Array.from({ length: 100 }, (_, i) =>
				f.sam
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(`outage-${i}`, 'samarinda', payload(`outage-${i}`), RECENT, RECENT)
			)
		);
		await f.sam.batch(
			Array.from({ length: 37 }, (_, i) =>
				f.sam
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(
						`healthy-${i}`,
						'samarinda',
						payload(`healthy-${i}`),
						'2026-07-02T01:00:00.000Z',
						RECENT
					)
			)
		);
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_sink_outage BEFORE INSERT ON audit_logs WHEN NEW.id LIKE 'outage-%' BEGIN SELECT RAISE(ABORT,'OWNED_TRANSIENT_OUTAGE'); END;"
			)
			.run();
		await tick(f.env);
		assert.equal(
			await count(f.sam, 'audit_log_outbox'),
			100,
			'Transient outage must not be quarantined repeatedly within one run'
		);
		assert.equal(
			await count(f.sam, 'audit_logs'),
			37,
			'Healthy rows behind an entire failed page must progress'
		);
		const attempts = await f.sam
			.prepare('SELECT MIN(attempt_count) AS lo,MAX(attempt_count) AS hi FROM audit_log_outbox')
			.first<{ lo: number; hi: number }>();
		assert.deepEqual({ ...attempts }, { lo: 1, hi: 1 });
		const q = await f.sam
			.prepare('SELECT payload,created_at FROM audit_log_quarantine WHERE id=?')
			.bind('owned-malformed')
			.first<{ payload: string; created_at: string }>();
		assert.deepEqual({ ...q }, { payload: '{', created_at: RECENT });
		await f.sam.prepare('DROP TRIGGER owned_sink_outage').run();
		await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW + 120000 }, f.env);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
		assert.equal(await count(f.sam, 'audit_logs'), 137);
	} finally {
		await f.close();
	}
});

await test('quarantine collision cannot silently erase a different durable source; manual drain shares atomic policy', async () => {
	const f = await fixture();
	try {
		await enqueue(f.sam, 'owned-quarantine-conflict', 'samarinda', '{');
		await f.sam
			.prepare(
				'INSERT INTO audit_log_quarantine(id,cabang_id,payload,created_at,quarantined_at) VALUES(?,?,?,?,?)'
			)
			.bind('owned-quarantine-conflict', 'samarinda', 'DIFFERENT_EXISTING_BYTES', RECENT, RECENT)
			.run();
		await tick(f.env);
		assert.equal(
			await count(f.sam, 'audit_log_outbox'),
			1,
			'INSERT OR IGNORE quarantine is not evidence the current source is preserved'
		);
		await f.sam.prepare('DELETE FROM audit_log_outbox').run();
		await enqueue(f.sam, 'owned-manual-late');
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_manual_late BEFORE DELETE ON audit_log_outbox BEGIN SELECT RAISE(ABORT,'OWNED_MANUAL_DELETE'); END;"
			)
			.run();
		assert.equal(await flushAuditLogOutbox(f.sam, 'samarinda'), 0);
		assert.equal(await count(f.sam, 'audit_logs'), 0);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 1);
	} finally {
		await f.close();
	}
});

await test('distinct shard scopes retain misplaced tenant rows and drain backlog over1000 with finite per-run budget', async () => {
	const f = await fixture();
	try {
		await enqueue(f.ber, 'owned-misplaced', 'samarinda');
		await f.ber
			.prepare(
				"INSERT INTO audit_logs(id,cabang_id,action,entity_type,created_at) VALUES('owned-misplaced-log','samarinda','x','uji',?)"
			)
			.bind(OLD)
			.run();
		await f.ber.batch(
			Array.from({ length: 1101 }, (_, i) =>
				f.ber
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(
						`backlog-${String(i).padStart(4, '0')}`,
						'berau',
						payload(`backlog-${String(i).padStart(4, '0')}`),
						RECENT,
						RECENT
					)
			)
		);
		await enqueue(f.sam, 'owned-sibling', 'samarinda2');
		await enqueue(f.bal, 'owned-bal', 'balikpapan2');
		await tick(f.env);
		assert.equal(await count(f.ber, 'audit_logs', "cabang_id='berau'"), 1000);
		assert.equal(await count(f.ber, 'audit_log_outbox', "cabang_id='berau'"), 101);
		assert.equal(await count(f.ber, 'audit_log_outbox', "id='owned-misplaced'"), 1);
		assert.equal(await count(f.ber, 'audit_logs', "id='owned-misplaced-log'"), 1);
		assert.equal(await count(f.sam, 'audit_logs', "cabang_id='samarinda2'"), 1);
		assert.equal(await count(f.bal, 'audit_logs', "cabang_id='balikpapan2'"), 1);
		await tick(f.env);
		assert.equal(await count(f.ber, 'audit_logs', "cabang_id='berau'"), 1101);
		assert.equal(await count(f.ber, 'audit_log_outbox', "cabang_id='berau'"), 0);
	} finally {
		await f.close();
	}
});

await test('bounded technical retention preserves exact cutoff, active references, registry tenant routing and business data', async () => {
	const f = await fixture();
	try {
		const cutoff = new Date(NOW - 90 * 86400000).toISOString();
		for (const table of ['audit_logs', 'error_events', 'request_metrics']) {
			const extra =
				table === 'audit_logs'
					? ',action,entity_type'
					: table === 'error_events'
						? ',source,message'
						: ',method,path,status,duration_ms';
			const values =
				table === 'audit_logs'
					? ",'x','uji'"
					: table === 'error_events'
						? ",'owned','marker'"
						: ",'GET','/owned',200,1";
			await f.sam
				.prepare(
					`INSERT INTO ${table}(id,cabang_id,created_at${extra}) VALUES('old','samarinda',?${values}),('boundary','samarinda',?${values}),('new','samarinda',?${values})`
				)
				.bind(OLD, cutoff, RECENT)
				.run();
		}
		await f.sam
			.prepare(
				'INSERT INTO audit_log_quarantine(id,cabang_id,payload,created_at,quarantined_at) VALUES(?,?,?,?,?)'
			)
			.bind('old', 'samarinda', '{}', OLD, OLD)
			.run();
		await f.sam
			.prepare(
				"INSERT INTO antrean_notification_events(event_id,cabang_id,buku_kas_id,idempotency_key,created_at) VALUES('pending','samarinda','owned-bk','pk',?),('free','samarinda','none','fk',?),('new','samarinda','none','nk',?)"
			)
			.bind(OLD, OLD, RECENT)
			.run();
		await f.sam
			.prepare(
				"INSERT INTO antrean_notification_deliveries(event_id,cabang_id,device_id,context_id,state,next_attempt_at,lease_until) VALUES('pending','samarinda','pending-device','ctx','pending',?,0),('pending','samarinda','leased-device','ctx','leased',?,?),('free','samarinda','terminal-device','ctx','sent',?,0)"
			)
			.bind(OLD_MS, OLD_MS, NOW + 60000, OLD_MS)
			.run();
		for (const [branch, id, active, expiry] of [
			['samarinda', 'dead', 0, OLD_MS],
			['samarinda', 'live', 1, OLD_MS],
			['samarinda', 'recent', 0, NOW],
			['berau', 'foreign-active', 1, OLD_MS]
		] as const) {
			await f.sam
				.prepare(
					'INSERT INTO antrean_notification_devices(device_id,token_hash,cabang_id,user_id,session_id,context_id,active,sound_enabled,expires_at,baseline_cursor,seen_cursor,delivered_cursor,dispatch_cursor,updated_at) VALUES(?,?,?,?,?,?,?,1,?,0,0,0,0,?)'
				)
				.bind(
					id,
					'owned-hash',
					branch,
					'owned-user',
					'owned-session',
					'ctx',
					active,
					expiry,
					OLD_MS
				)
				.run();
		}
		await f.sam
			.prepare(
				"INSERT INTO profil(id,cabang_id,username,password,role) VALUES('business-profile','samarinda','owned-profile','unusable-fixture-hash','pemilik')"
			)
			.run();
		await tick(f.env);
		for (const table of ['audit_logs', 'error_events', 'request_metrics'])
			assert.equal(await count(f.sam, table), 2);
		assert.equal(await count(f.sam, 'audit_log_quarantine'), 0);
		assert.equal(await count(f.sam, 'antrean_notification_deliveries'), 2);
		assert.equal(await count(f.sam, 'antrean_notification_events'), 2);
		assert.equal(await count(f.sam, 'antrean_notification_devices'), 3);
		assert.equal(await count(f.sam, 'profil'), 1);
	} finally {
		await f.close();
	}
});
await test('minute audit recovery bypasses an entire failed quota without running daily retention', async () => {
	const f = await fixture();
	try {
		await f.sam.batch(
			Array.from({ length: 500 }, (_, i) =>
				f.sam
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(`blocked-${i}`, 'samarinda', payload(`blocked-${i}`), RECENT, RECENT)
			)
		);
		await enqueue(
			f.sam,
			'minute-tail',
			'samarinda',
			payload('minute-tail'),
			'2026-07-02T01:00:00.000Z'
		);
		await f.sam
			.prepare(
				"INSERT INTO error_events(id,cabang_id,source,message,created_at) VALUES('minute-old','samarinda','owned','retained',?)"
			)
			.bind(OLD)
			.run();
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_quota_outage BEFORE INSERT ON audit_logs WHEN NEW.id LIKE 'blocked-%' BEGIN SELECT RAISE(ABORT,'OWNED_QUOTA_OUTAGE'); END;"
			)
			.run();
		await tick(f.env);
		await f.sam
			.prepare(
				"INSERT INTO error_events(id,cabang_id,source,message,created_at) VALUES('minute-old-after-daily','samarinda','owned','retained',?)"
			)
			.bind(OLD)
			.run();
		await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW + 60000 }, f.env);
		assert.equal(await count(f.sam, 'audit_logs', "id='minute-tail'"), 1);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 500);
		assert.equal(await count(f.sam, 'error_events', "id='minute-old-after-daily'"), 1);
	} finally {
		await f.close();
	}
});
await test('canonical drain races/replay, changed source and conflicting sink preserve durable intent', async () => {
	const f = await fixture();
	try {
		await enqueue(f.sam, 'same-intent');
		const result = await Promise.all([
			flushAuditLogOutbox(f.sam, 'samarinda'),
			flushAuditLogOutbox(f.sam, 'samarinda')
		]);
		assert.equal(
			result.reduce((a, b) => a + b, 0),
			1
		);
		assert.equal(await count(f.sam, 'audit_logs'), 1);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
		await enqueue(f.sam, 'changed-source');
		let altered = false;
		const changed = payload('new-exact-identity');
		const adapter = {
			prepare: (sql: string) => f.sam.prepare(sql),
			batch: async (statements: Parameters<Db['batch']>[0]) => {
				if (!altered) {
					altered = true;
					await f.sam
						.prepare("UPDATE audit_log_outbox SET payload=? WHERE id='changed-source'")
						.bind(changed)
						.run();
				}
				return f.sam.batch(statements);
			}
		} as Db;
		assert.equal(await flushAuditLogOutbox(adapter, 'samarinda'), 0);
		assert.equal(
			await f.sam
				.prepare("SELECT payload FROM audit_log_outbox WHERE id='changed-source'")
				.first('payload'),
			changed
		);
		assert.equal(await count(f.sam, 'audit_logs'), 1);
		assert.equal(await flushAuditLogOutbox(f.sam, 'samarinda'), 1);
		await enqueue(f.sam, 'sink-conflict');
		await f.sam
			.prepare(
				"INSERT INTO audit_logs(id,cabang_id,action,entity_type,created_at) VALUES('sink-conflict','samarinda','DIFFERENT_INTENT','uji',?)"
			)
			.bind(RECENT)
			.run();
		assert.equal(await flushAuditLogOutbox(f.sam, 'samarinda'), 0);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 1);
		assert.equal(
			await f.sam.prepare("SELECT action FROM audit_logs WHERE id='sink-conflict'").first('action'),
			'DIFFERENT_INTENT'
		);
		const conflictPayload = await f.sam
			.prepare("SELECT payload FROM audit_log_outbox WHERE id='sink-conflict'")
			.first('payload');
		// Deterministic conflict stops retrying once confirmed; exact bytes move to quarantine, sink untouched.
		for (let attempt = 1; attempt < AUDIT_SINK_CONFLICT_ATTEMPTS; attempt++)
			assert.equal(await flushAuditLogOutbox(f.sam, 'samarinda'), 0);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 1);
		assert.equal(await flushAuditLogOutbox(f.sam, 'samarinda'), 0);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
		assert.equal(
			await f.sam
				.prepare(
					"SELECT payload FROM audit_log_quarantine WHERE id='sink-conflict' AND reason='AUDIT_SINK_CONFLICT'"
				)
				.first('payload'),
			conflictPayload
		);
		assert.equal(
			await f.sam.prepare("SELECT action FROM audit_logs WHERE id='sink-conflict'").first('action'),
			'DIFFERENT_INTENT'
		);
	} finally {
		await f.close();
	}
});
await test('quarantine failure/oversize/old event retain exact bytes; bounded deletes keep live business/reference records', async () => {
	const f = await fixture();
	try {
		const large = JSON.stringify({
			action: 'owned',
			entityType: 'uji',
			metadata: { large: 'ü🧾'.repeat(15000) }
		});
		await enqueue(f.sam, 'oversized', 'samarinda', large);
		await enqueue(f.sam, 'old-review', 'samarinda', payload('old-review'), OLD);
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_quarantine_outage BEFORE INSERT ON audit_log_quarantine BEGIN SELECT RAISE(ABORT,'OWNED_QUARANTINE_OUTAGE'); END;"
			)
			.run();
		await tick(f.env);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 2);
		assert.equal(await count(f.sam, 'audit_log_quarantine'), 0);
		assert.equal(await count(f.sam, 'audit_logs'), 0);
		await f.sam.prepare('DROP TRIGGER owned_quarantine_outage').run();
		await worker.scheduled({ cron: '* * * * *', scheduledTime: NOW + 120000 }, f.env);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 0);
		assert.equal(await count(f.sam, 'audit_log_quarantine'), 2);
		assert.equal(
			await f.sam
				.prepare("SELECT payload FROM audit_log_quarantine WHERE id='oversized'")
				.first('payload'),
			large
		);
		assert.equal(
			await f.sam
				.prepare("SELECT created_at FROM audit_log_quarantine WHERE id='old-review'")
				.first('created_at'),
			OLD
		);
		await f.sam.batch(
			Array.from({ length: 250 }, (_, i) =>
				f.sam
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(`original-250-${i}`, 'samarinda', payload(`original-250-${i}`), RECENT, RECENT)
			)
		);
		await f.sam
			.prepare(
				"INSERT INTO error_events(id,cabang_id,source,message,created_at) WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ?) SELECT 'bounded-' || i, 'samarinda', 'owned', 'marker', ? FROM n"
			)
			.bind(RETENTION_ROWS_PER_TABLE + 35, OLD)
			.run();
		await tick(f.env);
		assert.equal(await count(f.sam, 'audit_logs'), 250);
		assert.equal(
			await count(f.sam, 'error_events'),
			35,
			'One tick may delete only its bounded technical page'
		);
		await f.sam
			.prepare(
				"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,created_at,metode_bayar,preparation_state,stock_policy_mode,stock_policy_revision) VALUES('active-order','samarinda','2020-01-01T00:00:00.000Z','pos','in','pendapatan_usaha',1000,?,'tunai','pending','tracked',0)"
			)
			.bind(OLD)
			.run();
		await f.sam
			.prepare(
				"INSERT INTO antrean_notification_events(event_id,cabang_id,buku_kas_id,idempotency_key,created_at) VALUES('active-no-delivery','samarinda','active-order','owned-active-key',?)"
			)
			.bind(OLD)
			.run();
		await tick(f.env);
		assert.equal(
			await count(f.sam, 'antrean_notification_events', "event_id='active-no-delivery'"),
			1
		);
		assert.equal(
			await f.sam.prepare("SELECT nominal FROM buku_kas WHERE id='active-order'").first('nominal'),
			1000
		);
		assert.equal(await count(f.sam, 'audit_log_quarantine'), 2);
	} finally {
		await f.close();
	}
});
await test('default/invalid maintenance quota fails safe and resumes source on next minute', async () => {
	const f = await fixture();
	try {
		await f.ber.batch(
			Array.from({ length: 310 }, (_, i) =>
				f.ber
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(`quota-${i}`, 'berau', payload(`quota-${i}`), RECENT, RECENT)
			)
		);
		const report = await worker.scheduled(
			{ cron: '0 3 * * *', scheduledTime: NOW },
			{ ...f.env, AUDIT_MAINTENANCE_QUERY_BUDGET: undefined }
		);
		assert.ok(report);
		assert.equal(report.queryBudget, 40);
		assert.ok(report.queries <= 40);
		assert.equal(report.exhausted, true);
		const delivered = await count(f.ber, 'audit_logs');
		assert.ok(delivered > 0 && delivered < 310);
		assert.equal(await count(f.ber, 'audit_log_outbox'), 310 - delivered);
		const invalid = await worker.scheduled(
			{ cron: '* * * * *', scheduledTime: NOW + 60000 },
			{ ...f.env, AUDIT_MAINTENANCE_QUERY_BUDGET: 901 }
		);
		assert.ok(invalid);
		assert.equal(invalid.queryBudget, 40);
		assert.equal(invalid.invalidBudgetSetting, true);
		assert.ok(invalid.queries <= 40);
		assert.equal(await count(f.ber, 'audit_logs'), 310);
		assert.equal(await count(f.ber, 'audit_log_outbox'), 0);
	} finally {
		await f.close();
	}
});
await test('failed shard cannot starve healthy groups under the default quota; daily cleanup has reserved capacity', async () => {
	const f = await fixture();
	try {
		await f.sam.batch(
			Array.from({ length: 500 }, (_, i) =>
				f.sam
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(`storm-${i}`, 'samarinda', payload(`storm-${i}`), RECENT, RECENT)
			)
		);
		await enqueue(f.ber, 'healthy-default', 'berau', payload('healthy-default'));
		await f.sam
			.prepare(
				"CREATE TRIGGER owned_storm BEFORE INSERT ON audit_logs WHEN NEW.id LIKE 'storm-%' BEGIN SELECT RAISE(ABORT,'OWNED_STORM'); END;"
			)
			.run();
		const env = { ...f.env, AUDIT_MAINTENANCE_QUERY_BUDGET: undefined };
		for (let minute = 0; minute < 3; minute++) {
			const report = await worker.scheduled(
				{ cron: '* * * * *', scheduledTime: NOW + 60000 * minute },
				env
			);
			assert.ok(report);
			assert.ok(report.queries <= 40);
		}
		assert.equal(
			await count(f.ber, 'audit_logs'),
			1,
			'Healthy group must progress despite a persistently unavailable earlier shard'
		);
		await f.ber
			.prepare(
				"INSERT INTO error_events(id,cabang_id,source,message,created_at) VALUES('cleanup-last-group','berau','owned','marker',?)"
			)
			.bind(OLD)
			.run();
		await worker.scheduled({ cron: '0 3 * * *', scheduledTime: NOW + 86400000 }, env);
		assert.equal(await count(f.ber, 'error_events'), 0);
		assert.equal(await count(f.sam, 'audit_log_outbox'), 500);
	} finally {
		await f.close();
	}
});
await test('legacy SQL UTC timestamp and explicit offsets respect exact retention cutoff', async () => {
	const f = await fixture();
	try {
		const cutoff = NOW - 90 * 86400000;
		for (const [id, time] of [
			['legacy-boundary', new Date(cutoff).toISOString().replace('T', ' ').replace('.000Z', '')],
			[
				'legacy-future',
				new Date(cutoff + 3600000).toISOString().replace('T', ' ').replace('.000Z', '')
			],
			['offset-boundary', '2026-04-04T11:00:00+08:00'],
			['past', new Date(cutoff - 1000).toISOString()]
		])
			await f.ber
				.prepare(
					"INSERT INTO error_events(id,cabang_id,source,message,created_at) VALUES(?,'berau','owned','marker',?)"
				)
				.bind(id, time)
				.run();
		await tick(f.env);
		assert.equal(
			await count(f.ber, 'error_events'),
			3,
			'Exact/after cutoff must survive regardless of persisted timestamp representation'
		);
	} finally {
		await f.close();
	}
});
console.log(
	'retention-tests: actual scheduled consumer, fixed time, distinct shards; ' +
		(process.argv.includes('--d1') ? 'workerd D1' : 'SQLite')
);
