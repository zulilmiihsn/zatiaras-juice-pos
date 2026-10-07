import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseArgs,
	WIPE_TABLES,
	assertBackupCoversBranch,
	wipeBranchHistory
} from './wipe-branch-history.mjs';

// Fixture backup NYATA: 3 shard cocok config produksi + readback SHA + COMPLETE.
// Tanpa ini verifier kanonik menolak — sama seperti CLI produksi.
const SHARDS = [
	{ binding: 'DB_SAMARINDA_GROUP', name: 'zatiaras-samarinda-group', id: 'b6aafe5b-fd11-436d-9b9e-c007bd531c9e' },
	{ binding: 'DB_BALIKPAPAN_GROUP', name: 'zatiaras-balikpapan-group', id: '312940d7-b0c0-43e5-86fd-78b762cacb6e' },
	{ binding: 'DB_BERAU_GROUP', name: 'zatiaras-berau-group', id: '18e2f751-5d54-4bec-b0bc-ae6e1378cdb6' }
];
function realBackupFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'wipe-test-'));
	const shards = SHARDS.map((s, i) => {
		const content = `-- D1 export ${s.binding}\nCREATE TABLE t${i}(x);\n`;
		const file = `db_${i}.sql`;
		writeFileSync(join(dir, file), content);
		return {
			binding: s.binding,
			name: s.name,
			database_id: s.id,
			version: 'production',
			file,
			bytes: Buffer.byteLength(content),
			sha256: createHash('sha256').update(content, 'utf8').digest('hex')
		};
	});
	const path = join(dir, 'manifest.sha256.json');
	writeFileSync(path, JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards }));
	writeFileSync(join(dir, 'COMPLETE'), 'ok\n');
	return { dir, path };
}

await test('parseArgs menolak argumen/konfirmasi salah', () => {
	assert.throws(() => parseArgs(['--ngawur']), /tidak diizinkan/);
	assert.throws(() => parseArgs([]), /--branch wajib/);
	assert.throws(() => parseArgs(['--branch', 'jakarta']), /samarinda/);
	assert.throws(() => parseArgs(['--branch', 'samarinda']), /--backup-manifest wajib/);
	assert.throws(
		() => parseArgs(['--branch', 'samarinda', '--backup-manifest', 'm', '--apply']),
		/--confirm/
	);
	assert.throws(
		() =>
			parseArgs([
				'--branch',
				'samarinda',
				'--backup-manifest',
				'm',
				'--apply',
				'--confirm',
				'balikpapan'
			]),
		/--confirm/
	);
	const ok = parseArgs([
		'--branch',
		'samarinda',
		'--backup-manifest',
		'm',
		'--apply',
		'--confirm',
		'samarinda'
	]);
	assert.equal(ok.apply, true);
});

await test('urutan hapus: anak sebelum induk', () => {
	const before = (a, b) => {
		assert.ok(WIPE_TABLES.indexOf(a) < WIPE_TABLES.indexOf(b), `${a} harus sebelum ${b}`);
	};
	before('transaksi_kasir', 'buku_kas');
	before('produk_mutasi', 'buku_kas');
	before('bahan_mutasi', 'buku_kas');
	before('stock_reconciliation_items', 'stock_reconciliations');
});

await test('manifest backup nyata wajib COMPLETE dan memuat cabang', async () => {
	const { dir, path } = realBackupFixture();
	try {
		assert.equal((await assertBackupCoversBranch(path, 'samarinda')).binding, 'DB_SAMARINDA_GROUP');
		await assert.rejects(() => assertBackupCoversBranch(path, 'jakarta'), /--branch wajib/);
		// Tanpa COMPLETE: ditolak sebelum DELETE.
		const { default: { unlinkSync } } = await import('node:fs');
		unlinkSync(join(dir, 'COMPLETE'));
		await assert.rejects(() => assertBackupCoversBranch(path, 'samarinda'), /COMPLETE/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('manifest palsu/parsial/rusak ditolak sebelum hapus', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'wipe-test-'));
	try {
		const bad = join(dir, 'manifest.json');
		// actualBackupFiles0: klaim tanpa file nyata.
		writeFileSync(
			bad,
			JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards: [] })
		);
		await assert.rejects(() => assertBackupCoversBranch(bad, 'samarinda'), /tepat tiga shard/);
		writeFileSync(bad, 'bukan-json');
		await assert.rejects(() => assertBackupCoversBranch(bad, 'samarinda'));
		await assert.rejects(
			() => assertBackupCoversBranch(join(dir, 'hilang.json'), 'samarinda'),
			/tidak ditemukan|wajib berupa path|ENOENT/i
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

function fakeExecutor(counts, seen) {
	return (binding, sql, params) => {
		seen.push(sql);
		const table = sql.match(/FROM (\w+)/)?.[1];
		if (sql.startsWith('SELECT')) return { n: counts[table] ?? 0 };
		if (sql.startsWith('DELETE') && table) counts[table] = 0;
		return {};
	};
}

function tempManifest() {
	return realBackupFixture();
}

await test('dry-run tidak menghapus apa pun', async () => {
	const { dir, path } = tempManifest();
	try {
		const seen = [];
		const result = await wipeBranchHistory(
			{ branch: 'samarinda', backupManifest: path, apply: false },
			fakeExecutor({ buku_kas: 5 }, seen)
		);
		assert.ok(seen.every((s) => !s.startsWith('DELETE')));
		assert.equal(result.report.find((r) => r.table === 'buku_kas')?.before, 5);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('arsip berisi membatalkan sebelum hapus apa pun', async () => {
	const { dir, path } = tempManifest();
	try {
		const seen = [];
		await assert.rejects(
			wipeBranchHistory(
				{ branch: 'samarinda', backupManifest: path, apply: true },
				fakeExecutor({ archive_jobs: 1, buku_kas: 5 }, seen)
			),
			/arsip harus ditangani/
		);
		assert.ok(seen.every((s) => !s.startsWith('DELETE')));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('apply menghapus sesuai urutan dan verifikasi nol', async () => {
	const { dir, path } = tempManifest();
	try {
		const seen = [];
		const result = await wipeBranchHistory(
			{ branch: 'samarinda', backupManifest: path, apply: true },
			fakeExecutor({ transaksi_kasir: 2, buku_kas: 1 }, seen)
		);
		const deletes = seen.filter((s) => s.startsWith('DELETE'));
		assert.deepEqual(
			deletes.map((s) => s.match(/FROM (\w+)/)?.[1]),
			['transaksi_kasir', 'buku_kas']
		);
		assert.ok(result.report.every((r) => r.after === 0));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
