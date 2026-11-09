import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./data-health.mjs', import.meta.url));
const workdir = mkdtempSync(join(tmpdir(), 'zatiaras-data-health-'));
after(() => rmSync(workdir, { recursive: true, force: true }));

/** Skema asli dari migrasi, supaya detektor diuji terhadap kolom yang benar-benar ada. */
function schemaSql() {
	const directory = new URL('../drizzle/', import.meta.url);
	return readdirSync(directory)
		.filter((name) => name.endsWith('.sql'))
		.sort()
		.flatMap((name) =>
			readFileSync(new URL(name, directory), 'utf8').split('--> statement-breakpoint')
		)
		.map((statement) => statement.trim().replace(/;$/, ''))
		.filter(Boolean)
		.map((statement) => `${statement};`)
		.join('\n');
}

const SCHEMA = schemaSql();
const FINDINGS = [
	`INSERT INTO transaksi_kasir (id, cabang_id, buku_kas_id, jumlah, nominal) VALUES ('orphan-tk', 'samarinda', 'hilang', 1, 5000);`,
	`INSERT INTO bahan_mutasi (id, cabang_id, bahan_id, delta_jumlah) VALUES ('orphan-m', 'samarinda', 'hilang', -5);`,
	`INSERT INTO produk (id, cabang_id, nama, harga, stok) VALUES ('neg-p', 'samarinda', 'Rusak', 1000, -2);`,
	`INSERT INTO bahan (id, cabang_id, nama, stok_saat_ini) VALUES ('neg-b', 'samarinda', 'Gula', -1);`,
	// Shard lain pada dump yang sama: tidak boleh muncul saat memeriksa shard Samarinda.
	`INSERT INTO transaksi_kasir (id, cabang_id, buku_kas_id, jumlah, nominal) VALUES ('orphan-tk2', 'balikpapan', 'hilang', 1, 5000);`
].join('\n');

let counter = 0;
function writeDump(content, name = `dump-${counter++}.sql`) {
	const file = join(workdir, name);
	writeFileSync(file, content, 'utf8');
	return file;
}

function run(...args) {
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		encoding: 'utf8',
		shell: false,
		windowsHide: true
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('data-health CLI', () => {
	test('dump bersih: exit 0 dan semua cabang pada shard dilaporkan bersih', () => {
		const file = writeDump(SCHEMA);
		const result = run('--file', file, '--shard', 'DB_SAMARINDA_GROUP');
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /samarinda: BERSIH/);
		assert.match(result.stdout, /samarinda2: BERSIH/);
		assert.doesNotMatch(result.stdout, /balikpapan/);
	});

	test('temuan: exit 1, rinci per jenis, dan hanya cabang pada shard yang diminta', () => {
		const file = writeDump(`${SCHEMA}\n${FINDINGS}`);
		const samarinda = run('--file', file, '--shard', 'DB_SAMARINDA_GROUP');
		assert.equal(samarinda.status, 1, samarinda.stderr);
		for (const id of ['orphan-tk', 'orphan-m', 'neg-p', 'neg-b'])
			assert.match(samarinda.stdout, new RegExp(`\\b${id}\\b`));
		assert.doesNotMatch(samarinda.stdout, /orphan-tk2/);
		assert.match(samarinda.stdout, /samarinda2: BERSIH/);

		const balikpapan = run('--file', file, '--shard', 'DB_BALIKPAPAN_GROUP');
		assert.equal(balikpapan.status, 1, balikpapan.stderr);
		assert.match(balikpapan.stdout, /orphan-tk2/);
		assert.doesNotMatch(balikpapan.stdout, /\borphan-tk\b/);
	});

	test('read-only: file backup tidak berubah', () => {
		const file = writeDump(`${SCHEMA}\n${FINDINGS}`);
		const digest = () => createHash('sha256').update(readFileSync(file)).digest('hex');
		const before = digest();
		run('--file', file, '--shard', 'DB_SAMARINDA_GROUP');
		assert.equal(digest(), before);
	});

	test('dump berisi operasi file/extension ditolak dengan exit 2', () => {
		const file = writeDump(`${SCHEMA}\nATTACH DATABASE 'x.db' AS x;`);
		const result = run('--file', file, '--shard', 'DB_SAMARINDA_GROUP');
		assert.equal(result.status, 2);
		assert.match(result.stderr, /tidak diizinkan/);
		assert.equal(result.stdout, '');
	});

	test('argumen tidak valid ditolak dengan exit 2, bukan dilaporkan bersih', () => {
		const file = writeDump(SCHEMA);
		const cases = [
			[['--file', file, '--shard', 'DB_LAIN'], /Shard/],
			[['--shard', 'DB_SAMARINDA_GROUP'], /--file/],
			[['--file', file], /--shard/],
			[['--file', writeDump(SCHEMA, 'dump.txt'), '--shard', 'DB_SAMARINDA_GROUP'], /\.sql/],
			[['--file', file, '--shard', 'DB_SAMARINDA_GROUP', '--apply'], /Argumen/],
			[['--file', join(workdir, 'tidak-ada.sql'), '--shard', 'DB_SAMARINDA_GROUP'], /./]
		];
		for (const [args, message] of cases) {
			const result = run(...args);
			assert.equal(result.status, 2, `${args.join(' ')} -> ${result.stdout}`);
			assert.match(result.stderr, message);
			assert.equal(result.stdout, '');
		}
	});

	test('dump tanpa tabel yang dibutuhkan gagal keras (exit 2), tidak dianggap bersih', () => {
		const file = writeDump('CREATE TABLE produk (id TEXT);');
		const result = run('--file', file, '--shard', 'DB_SAMARINDA_GROUP');
		assert.equal(result.status, 2);
		assert.doesNotMatch(result.stdout, /BERSIH/);
	});
});
