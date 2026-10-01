import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseArgs,
	WIPE_TABLES,
	assertBackupCoversBranch,
	wipeBranchHistory
} from './wipe-branch-history.mjs';

function manifest(shards) {
	return { schema: 'zatiaraspos-d1-backup-v1', shards };
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

await test('manifest backup wajib memuat cabang', () => {
	const dir = mkdtempSync(join(tmpdir(), 'wipe-test-'));
	try {
		const good = join(dir, 'manifest.json');
		writeFileSync(good, JSON.stringify(manifest([{ binding: 'DB_SAMARINDA_GROUP' }])));
		assert.equal(assertBackupCoversBranch(good, 'samarinda').binding, 'DB_SAMARINDA_GROUP');
		assert.throws(() => assertBackupCoversBranch(good, 'berau'), /tidak memuat/);
		assert.throws(
			() => assertBackupCoversBranch(join(dir, 'hilang.json'), 'samarinda'),
			/tidak ditemukan/
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
	const dir = mkdtempSync(join(tmpdir(), 'wipe-test-'));
	const path = join(dir, 'manifest.json');
	writeFileSync(path, JSON.stringify(manifest([{ binding: 'DB_SAMARINDA_GROUP' }])));
	return { dir, path };
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
