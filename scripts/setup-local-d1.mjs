/**
 * Siapkan D1 lokal (miniflare) untuk load test / dev: apply schema + seed UAT.
 *
 * Menerapkan, berurutan, ke binding DB_SAMARINDA_GROUP --local:
 *   1. Semua migration Drizzle drizzle/*.sql (skema kanonik domain + infra)
 *   2. seed-uat-samarinda.sql  (profil kasir/pemilik + produk uat-produk-es-teh)
 *
 * Pakai:
 *   node scripts/setup-local-d1.mjs
 *
 * Database yang sudah mencapai skema kanonik 0014 tidak menjalankan ulang
 * migration historis/destruktif. Migration baru tetap diterapkan berurutan.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BINDING = 'DB_SAMARINDA_GROUP';
const CONFIG = 'wrangler.pages.jsonc';

const allMigrations = readdirSync('drizzle')
	.filter((f) => f.endsWith('.sql'))
	.sort()
	.map((f) => ({
		file: `drizzle/${f}`,
		number: Number(f.slice(0, 4)),
		tolerant: true,
		label: `migration ${f}`
	}));

function runWrangler(extraArgs) {
	return spawnSync(
		'npx',
		['wrangler', 'd1', 'execute', BINDING, '--local', `--config=${CONFIG}`, ...extraArgs, '--yes'],
		{
			stdio: 'pipe',
			encoding: 'utf8',
			shell: process.platform === 'win32'
		}
	);
}

function hasCanonicalBaseSchema() {
	const queryFile = join(tmpdir(), `zatiaras-schema-check-${randomUUID()}.sql`);
	writeFileSync(
		queryFile,
		`SELECT
			(SELECT COUNT(*) FROM pragma_table_info('auth_sessions') WHERE name = 'cabang_id') AS auth_ready,
			(SELECT COUNT(*) FROM pragma_table_info('pengaturan') WHERE name = 'halaman_terkunci') AS settings_ready,
			(SELECT COUNT(*) FROM pragma_table_info('buku_kas') WHERE name = 'nominal') AS ledger_ready;`,
		'utf8'
	);
	try {
		const result = runWrangler([`--file=${queryFile}`]);
		const output = `${result.stdout || ''}\n${result.stderr || ''}`;
		return (
			result.status === 0 &&
			/"auth_ready"\s*:\s*1/.test(output) &&
			/"settings_ready"\s*:\s*1/.test(output) &&
			/"ledger_ready"\s*:\s*1/.test(output)
		);
	} finally {
		rmSync(queryFile, { force: true });
	}
}

const canonicalBaseReady = hasCanonicalBaseSchema();
const migrations = canonicalBaseReady
	? allMigrations.filter((migration) => migration.number > 14)
	: allMigrations;

const steps = [
	...migrations,
	{ file: 'scripts/seed-uat-samarinda.sql', tolerant: false, label: 'seed UAT samarinda' }
];

function run(file) {
	return runWrangler([`--file=${file}`]);
}

let failed = false;
if (canonicalBaseReady) {
	console.log('-> baseline 0000-0014 ... SKIP (skema kanonik sudah ada)');
}
for (const step of steps) {
	process.stdout.write(`-> ${step.label} (${step.file}) ... `);
	const res = run(step.file);
	const ok = res.status === 0;
	if (ok) {
		console.log('OK');
		continue;
	}
	const out = `${res.stdout || ''}\n${res.stderr || ''}`;
	// Skema/ALTER yang idempoten sering gagal dengan "already exists" — toleransi.
	if (step.tolerant && /already exists|duplicate column/i.test(out)) {
		console.log('SKIP (sudah ada)');
		continue;
	}
	console.log('GAGAL');
	console.error(out.trim().slice(0, 1500));
	failed = true;
	if (!step.tolerant) break;
}

if (failed) {
	console.error('\nSetup D1 lokal gagal. Periksa pesan di atas.');
	process.exit(1);
}
console.log('\nD1 lokal siap: profil kasir/pemilik + produk uat-produk-es-teh (branch samarinda).');
console.log('Lanjut: jalankan `pnpm dev`, lalu load test ke http://localhost:5173');
