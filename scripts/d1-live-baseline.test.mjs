import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { captureLiveParity, parseArgs, remoteRead } from './d1-live-baseline.mjs';
import { captureDrillParity } from './restore-drill-local.mjs';
import { drillFixtureSql } from './test-fixtures/drill-dump.mjs';

const identity = { binding: 'DB_SAMARINDA_GROUP', name: 'zatiaras-samarinda-group', id: 'x' };

// Fake Wrangler: runs the multi-statement --command on SQLite, shaped like `d1 execute --json`.
function fakeRun(db, meta = {}) {
	const calls = [];
	return {
		calls,
		run(args) {
			calls.push(args);
			const command = args[args.indexOf('--command') + 1];
			return JSON.stringify(
				command.split('; ').map((sql) => ({
					success: true,
					results: db.prepare(sql).all(),
					meta: { changed_db: false, rows_written: 0, ...meta }
				}))
			);
		}
	};
}

test('captureLiveParity equals captureDrillParity of the same database (read-only, one consistent read)', async () => {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys=OFF;');
	db.exec(drillFixtureSql());
	const fake = fakeRun(db);
	const live = await captureLiveParity(identity, { run: fake.run });
	assert.deepEqual(live, await captureDrillParity({ all: (sql) => db.prepare(sql).all() }));
	assert.equal(fake.calls.length, 2, 'table listing, then every table in one request');
	for (const args of fake.calls) {
		assert.ok(args.includes('--remote') && args.includes('--json'));
		assert.equal(args[2], identity.name);
	}
	db.close();
});

test('remoteRead rejects statements outside the read-only allowlist', () => {
	const run = () => assert.fail('must not reach Wrangler');
	for (const sql of [
		'DELETE FROM buku_kas',
		'SELECT 1; DROP TABLE buku_kas',
		'PRAGMA writable_schema=1',
		'UPDATE pengaturan SET nilai=1'
	])
		assert.throws(() => remoteRead(identity, [sql], { run }), /allowlist read-only/);
});

test('remoteRead fails closed when the remote reports a write or a result-count mismatch', () => {
	const db = new DatabaseSync(':memory:');
	db.exec('CREATE TABLE t(a)');
	assert.throws(
		() => remoteRead(identity, ['SELECT * FROM t'], { run: fakeRun(db, { changed_db: true }).run }),
		/mengubah database/
	);
	assert.throws(
		() => remoteRead(identity, ['SELECT * FROM t'], { run: () => '[]' }),
		/Jumlah hasil remote/
	);
	db.close();
});

test('parseArgs: mode-specific flags, scratch-only verify target', () => {
	const base = ['--shard', 'DB_SAMARINDA_GROUP', '--backup-manifest', 'D:/x/m.json'];
	assert.equal(parseArgs([...base, '--output', 'D:/x/b.json']).mode, 'capture');
	assert.throws(() => parseArgs(base), /tepat satu mode/);
	assert.throws(
		() => parseArgs([...base, '--output', 'D:/x/b.json', '--expect-baseline', 'D:/x/b.json']),
		/tidak berlaku untuk mode capture/
	);
	const verify = [
		...base,
		'--verify-target',
		'zatiaraspos-drill-samarinda',
		'--target-config',
		'D:/x/w.json',
		'--expect-baseline',
		'D:/x/b.json',
		'--expect-baseline-sha256',
		'a'.repeat(64)
	];
	assert.equal(parseArgs(verify).mode, 'verify');
	assert.throws(() => parseArgs(verify.slice(0, -2)), /wajib: baselineSha256/);
	const prod = [...verify];
	prod[prod.indexOf('zatiaraspos-drill-samarinda')] = 'zatiaras-samarinda-group';
	assert.throws(() => parseArgs(prod), /scratch zatiaraspos-drill-/);
});

test('remoteRead fails closed when remote meta is missing (cannot prove read-only)', () => {
	const run = () => JSON.stringify([{ success: true, results: [] }]);
	assert.throws(() => remoteRead(identity, ['SELECT 1'], { run }), /Meta remote tidak dikenali/);
});
