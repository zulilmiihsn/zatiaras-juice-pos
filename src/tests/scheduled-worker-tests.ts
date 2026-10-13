import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseAuditPayload, auditValues, buildAuditPayload } from '../lib/server/auditEnvelope';
import { wranglerInvocation } from '../../scripts/wrangler-cli.mjs';
const NOW = Date.UTC(2026, 6, 3, 3),
	RECENT = '2026-07-02T00:00:00.000Z';
const valid = (id: string) =>
	JSON.stringify({
		action: 'owned-scheduled',
		entityType: 'uji',
		entityId: id,
		amount: 0,
		session: { userId: 'owned-actor', username: '', role: 'pemilik' },
		metadata: { marker: 'ü🧾' }
	});
if (!process.argv.includes('--compiled')) {
	await test('canonical audit projection preserves zero, empty actor and metadata across consumers', () => {
		const parsed = parseAuditPayload(valid('golden'), 'samarinda');
		assert.deepEqual(auditValues(parsed), [
			'owned-actor',
			'',
			'pemilik',
			'owned-scheduled',
			'uji',
			'golden',
			null,
			0,
			JSON.stringify({ marker: 'ü🧾' }),
			null
		]);
	});
	await test('existing bounded source metadata is preserved, not re-truncated at delivery', () => {
		const marker = 'ü🧾'.repeat(2000);
		const parsed = parseAuditPayload(
			JSON.stringify({ action: 'owned', entityType: 'uji', metadata: { marker } }),
			'samarinda'
		);
		assert.equal(JSON.parse(auditValues(parsed)[8] as string).marker, marker);
	});
	await test('permanent malformed audit identity/shape rejects instead of coercing or guessing', () => {
		for (const patch of [
			{ amount: false },
			{ entityType: null },
			{ session: [] },
			{ metadata: [] },
			{ session: { branch: 'berau' } }
		])
			assert.throws(() =>
				parseAuditPayload(
					JSON.stringify({ ...JSON.parse(valid('negative')), ...patch }),
					'samarinda'
				)
			);
		assert.throws(() => parseAuditPayload('{', 'samarinda'));
	});
	await test('bounded metadata remains valid JSON with UTF8 precision and complete actor envelope', () => {
		const payload = buildAuditPayload({
			action: 'owned',
			entityType: 'uji',
			entityId: 'exact-id',
			amount: 0,
			session: { userId: 'exact-user' },
			metadata: { large: 'ü🧾'.repeat(10000) }
		});
		const parsed = parseAuditPayload(payload, 'samarinda');
		assert.equal(parsed.entityId, 'exact-id');
		assert.equal(parsed.session?.userId, 'exact-user');
		assert.equal(parsed.amount, 0);
		const metadata = auditValues(parsed)[8];
		assert.ok(typeof metadata === 'string');
		assert.ok(new TextEncoder().encode(metadata).length <= 8192);
		assert.equal(JSON.parse(metadata).truncated, true);
	});
} else {
	const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
	const directory = await mkdtemp(join(tmpdir(), 'zatiaras scheduled owned & '));
	let runtime: InstanceType<typeof Miniflare> | undefined;
	try {
		const bindings = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];
		const databases = Object.fromEntries(bindings.map((binding) => [binding, randomUUID()]));
		const config = join(directory, 'wrangler.json');
		await writeFile(
			config,
			JSON.stringify({
				name: 'owned-scheduled-smoke',
				main: resolve('src/lib/server/realtimeWorker.js'),
				tsconfig: resolve('tsconfig.json'),
				compatibility_date: '2026-06-29',
				compatibility_flags: ['nodejs_compat'],
				vars: { AUDIT_MAINTENANCE_QUERY_BUDGET: '900' },
				d1_databases: bindings.map((binding) => ({
					binding,
					database_id: databases[binding],
					database_name: `owned-${binding}`
				})),
				durable_objects: {
					bindings: [{ name: 'REALTIME_HUB', class_name: 'RealtimeDurableObject' }]
				},
				migrations: [{ tag: 'v1', new_sqlite_classes: ['RealtimeDurableObject'] }],
				triggers: { crons: ['* * * * *', '0 3 * * *'] }
			}),
			{ mode: 0o600, flag: 'wx' }
		);
		const invocation = wranglerInvocation([
			'deploy',
			'--dry-run',
			'--config',
			config,
			'--outdir',
			join(directory, 'bundle')
		]);
		const env: Record<string, string> = { CLOUDFLARE_SEND_METRICS: 'false' };
		for (const key of [
			'PATH',
			'PATHEXT',
			'SystemRoot',
			'TEMP',
			'TMP',
			'USERPROFILE',
			'APPDATA',
			'LOCALAPPDATA'
		])
			if (process.env[key]) env[key] = process.env[key]!;
		const built = spawnSync(invocation.command, invocation.args, {
			...invocation.options,
			cwd: directory,
			env,
			timeout: 120000
		});
		assert.equal(built.status, 0, `Owned Worker dry-run failed: ${built.stderr ?? ''}`);
		const files = (await readdir(join(directory, 'bundle'))).filter(
			(file) => file.endsWith('.js') || file.endsWith('.mjs')
		);
		assert.equal(files.length, 1, 'Scheduled bundle must be self-contained');
		const scriptPath = join(directory, 'bundle', files[0]);
		runtime = new Miniflare(
			convertV4MiniflareOptions({
				resourcePersistencePath: join(directory, 'state'),
				workers: [
					{
						name: 'scheduler',
						modules: true,
						modulesRoot: directory,
						scriptPath,
						compatibilityDate: '2026-06-29',
						compatibilityFlags: ['nodejs_compat'],
						d1Databases: databases,
						bindings: { AUDIT_MAINTENANCE_QUERY_BUDGET: '900' },
						durableObjects: { REALTIME_HUB: 'RealtimeDurableObject' }
					}
				]
			})
		);
		await runtime.ready;
		const dbs = [];
		const migrations = (await readdir('drizzle')).filter((file) => file.endsWith('.sql')).sort();
		for (const binding of bindings) {
			const db = await runtime.getD1Database(binding, 'scheduler');
			dbs.push(db);
			for (const file of migrations) {
				const sql = (await readFile(join('drizzle', file), 'utf8'))
					.split('--> statement-breakpoint')
					.map((s) => s.trim())
					.filter(Boolean);
				await db.batch(sql.map((s) => db.prepare(s)));
			}
		}
		const [sam, bal, ber] = dbs;
		const tick = async (cron: string, time = NOW) => {
			const service = await runtime!.getWorker('scheduler');
			const result = await service.scheduled({ cron, scheduledTime: new Date(time) });
			assert.equal(result.outcome, 'ok');
		};
		await test('actual compiled scheduled controller: >1000 backlog, original envelope, poison, shard isolation and retry', async () => {
			for (const [db, branch, id] of [
				[sam, 'samarinda2', 'sam-sibling'],
				[bal, 'balikpapan2', 'bal-sibling']
			] as const)
				await db
					.prepare(
						'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
					)
					.bind(id, branch, valid(id), RECENT, RECENT)
					.run();
			for (let start = 0; start < 1101; start += 100)
				await ber.batch(
					Array.from({ length: Math.min(100, 1101 - start) }, (_, i) =>
						ber
							.prepare(
								'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
							)
							.bind(
								`compiled-${start + i}`,
								'berau',
								valid(`compiled-${start + i}`),
								RECENT,
								RECENT
							)
					)
				);
			await sam
				.prepare(
					'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
				)
				.bind('compiled-poison', 'samarinda', '{', RECENT, RECENT)
				.run();
			await ber
				.prepare(
					'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
				)
				.bind('misplaced', 'samarinda', valid('misplaced'), RECENT, RECENT)
				.run();
			const start = performance.now();
			await tick('* * * * *');
			assert.equal(
				await ber
					.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE cabang_id='berau'")
					.first('n'),
				1000
			);
			assert.equal(
				await ber
					.prepare("SELECT COUNT(*) AS n FROM audit_log_outbox WHERE cabang_id='berau'")
					.first('n'),
				101
			);
			assert.equal(
				await ber
					.prepare("SELECT COUNT(*) AS n FROM audit_log_outbox WHERE id='misplaced'")
					.first('n'),
				1
			);
			const row = await sam
				.prepare(
					"SELECT created_at,amount,actor_username,metadata FROM audit_logs WHERE id='sam-sibling'"
				)
				.first<{ created_at: string; amount: number; actor_username: string; metadata: string }>();
			assert.ok(row);
			assert.equal(row.created_at, RECENT);
			assert.equal(row.amount, 0);
			assert.equal(row.actor_username, '');
			assert.deepEqual(JSON.parse(row.metadata), { marker: 'ü🧾' });
			const poison = await sam
				.prepare("SELECT payload,created_at FROM audit_log_quarantine WHERE id='compiled-poison'")
				.first<{ payload: string; created_at: string }>();
			assert.deepEqual({ ...poison }, { payload: '{', created_at: RECENT });
			await tick('* * * * *', NOW + 60000);
			assert.equal(
				await ber
					.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE cabang_id='berau'")
					.first('n'),
				1101
			);
			console.log(
				'SCHEDULED_SYNTHETIC_BACKLOG ' +
					JSON.stringify({
						rows: 1101,
						milliseconds: performance.now() - start,
						scope: 'local actual compiled workerd; not production largest/quota/latency acceptance'
					})
			);
		});
		await test('compiled scheduled quarantine and late source delete failures retain audit intent; daily cleanup preserves cutoff', async () => {
			await sam
				.prepare(
					'INSERT INTO audit_log_outbox(id,cabang_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)'
				)
				.bind('compiled-late', 'samarinda', valid('compiled-late'), RECENT, RECENT)
				.run();
			await sam
				.prepare(
					"CREATE TRIGGER compiled_late_delete BEFORE DELETE ON audit_log_outbox WHEN OLD.id='compiled-late' BEGIN SELECT RAISE(ABORT,'OWNED_COMPILED_DELETE'); END;"
				)
				.run();
			await tick('* * * * *', NOW + 120000);
			assert.equal(
				await sam
					.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE id='compiled-late'")
					.first('n'),
				0
			);
			assert.equal(
				await sam
					.prepare("SELECT COUNT(*) AS n FROM audit_log_outbox WHERE id='compiled-late'")
					.first('n'),
				1
			);
			await sam.prepare('DROP TRIGGER compiled_late_delete').run();
			await tick('* * * * *', NOW + 240000);
			assert.equal(
				await sam
					.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE id='compiled-late'")
					.first('n'),
				1
			);
			const cutoff = new Date(NOW - 90 * 86400000).toISOString();
			await sam
				.prepare(
					"INSERT INTO error_events(id,cabang_id,source,message,created_at) VALUES('old','samarinda','owned','marker',?),('boundary','samarinda','owned','marker',?)"
				)
				.bind('2020-01-01T00:00:00.000Z', cutoff)
				.run();
			await tick('* * * * *');
			assert.equal(await sam.prepare('SELECT COUNT(*) AS n FROM error_events').first('n'), 2);
			await tick('0 3 * * *');
			assert.equal(await sam.prepare('SELECT COUNT(*) AS n FROM error_events').first('n'), 1);
		});
		console.log(
			'COMPILED_SCHEDULED_ARTIFACT ' +
				JSON.stringify({
					sha256: createHash('sha256')
						.update(await readFile(scriptPath))
						.digest('hex'),
					sourceSha256: createHash('sha256')
						.update(await readFile('src/lib/server/realtimeWorker.js'))
						.digest('hex'),
					migrations: migrations.length,
					scope:
						'real backend Worker dry-run + actual scheduled controller on local workerd; no paid provider, staging or remote cron proof'
				})
		);
	} finally {
		await runtime?.dispose();
		await rm(directory, { recursive: true, force: true });
		console.log('SCHEDULED_CLEANUP runtime disposed; exact owned state removed');
	}
}
