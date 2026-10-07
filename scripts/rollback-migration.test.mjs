import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRollbackArgs, resolveRollbackPlan, main } from './rollback-migration.mjs';

const node = process.execPath;
function cli(...args) {
	return spawnSync(node, ['scripts/rollback-migration.mjs', ...args], {
		encoding: 'utf8',
		stdio: 'pipe'
	});
}

await test('usage invalid nonzero (tanpa discovery repo)', () => {
	for (const args of [[], ['--shard', 'DB_SAMARINDA_GROUP'], ['--shard', 'SALAH', '--file', 'x']]) {
		const r = cli(...args);
		assert.notEqual(r.status, 0, JSON.stringify(args));
		assert.match(r.stderr + r.stdout, /Usage|--shard wajib|wajib diisi/);
	}
});

await test('parse menolak flag tak dikenal dan dua sumber', () => {
	assert.throws(
		() => parseRollbackArgs(['--shard', 'DB_SAMARINDA_GROUP', '--ngawur']),
		/tidak diizinkan/
	);
	assert.throws(
		() =>
			parseRollbackArgs(['--shard', 'DB_SAMARINDA_GROUP', '--file', 'a', '--backup-manifest', 'b']),
		/salah satu/
	);
});

const DRILL_SQL = `CREATE TABLE buku_kas(id TEXT PRIMARY KEY, cabang_id TEXT, waktu TEXT, sumber TEXT, tipe TEXT, jenis TEXT, nominal REAL, metode_bayar TEXT, receipt_snapshot TEXT, nomor_harian INTEGER, tanggal_nomor TEXT);
CREATE TABLE transaksi_kasir(id TEXT PRIMARY KEY, cabang_id TEXT, buku_kas_id TEXT, jumlah INTEGER, nominal REAL);
INSERT INTO buku_kas VALUES('b1','samarinda','2025-01-01T00:00:00Z','catat','in','pendapatan_usaha',50000,'tunai',NULL,NULL,NULL);
INSERT INTO transaksi_kasir VALUES('t1','samarinda','b1',1,50000);
`;

function drillFile(content = DRILL_SQL) {
	const dir = mkdtempSync(join(tmpdir(), 'rollback-test-'));
	const path = join(dir, 'sumber.sql');
	writeFileSync(path, content);
	return { dir, path };
}

await test('file hilang/kosong/rusak ditolak sebelum mutasi', async () => {
	await assert.rejects(
		resolveRollbackPlan({
			shard: 'DB_SAMARINDA_GROUP',
			live: false,
			file: join(tmpdir(), 'rollback-tidak-ada.sql')
		}),
		/tidak terbaca|wajib berupa path|ENOENT/i
	);
	const empty = drillFile('   \n');
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', live: false, file: empty.path }),
			/kosong/
		);
	} finally {
		rmSync(empty.dir, { recursive: true, force: true });
	}
	const broken = drillFile('CREATE TABLE buku_kas(id TEXT);\n');
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', live: false, file: broken.path }),
			/Drill sumber gagal/
		);
	} finally {
		rmSync(broken.dir, { recursive: true, force: true });
	}
});

await test('dry-run sukses uraikan target, nol mutasi', async () => {
	const { dir, path } = drillFile();
	const codeBefore = process.exitCode;
	try {
		await main(['--shard', 'DB_SAMARINDA_GROUP', '--file', path, '--dry-run'], {
			spawn: () => {
				throw new Error('spawn tak boleh dipanggil saat dry-run');
			}
		});
		assert.equal(process.exitCode ?? 0, 0);
	} finally {
		process.exitCode = codeBefore;
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('apply memakai satu spawn; gagal = exit 1', async () => {
	const { dir, path } = drillFile();
	const codeBefore = process.exitCode;
	try {
		const calls = [];
		await main(['--shard', 'DB_BERAU_GROUP', '--file', path, '--apply'], {
			spawn: (...a) => {
				calls.push(a);
				return { status: 0, stdout: '', stderr: '' };
			}
		});
		assert.equal(calls.length, 1);
		assert.ok(calls[0][1].includes('DB_BERAU_GROUP'));
		assert.ok(calls[0][1].some((x) => String(x).startsWith('--file=')));
		assert.equal(process.exitCode ?? 0, 0);
		process.exitCode = codeBefore;
		await main(['--shard', 'DB_BERAU_GROUP', '--file', path, '--apply'], {
			spawn: () => ({ status: 1, stdout: '', stderr: 'boom' })
		});
		assert.equal(process.exitCode, 1);
	} finally {
		process.exitCode = codeBefore;
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('manifest salah-shard/rusak fail-closed', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'rollback-test-'));
	try {
		const bad = join(dir, 'manifest.json');
		writeFileSync(bad, JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards: [] }));
		await assert.rejects(
			resolveRollbackPlan({
				shard: 'DB_SAMARINDA_GROUP',
				live: false,
				backupManifest: bad
			}),
			/tepat tiga shard/
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
