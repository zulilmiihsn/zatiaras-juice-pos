#!/usr/bin/env node
/**
 * Rollback migrasi / restore darurat per shard D1 (AUD-047).
 *
 * Sumber backup EKSPLISIT dari root backup eksternal terverifikasi
 * (di luar repo/workspace): --file langsung, atau --backup-manifest
 * (verifier kanonik + COMPLETE + file shard cocok target). Pencarian
 * otomatis direktori `backups/` di repo DIHAPUS — bertentangan dengan
 * kebijakan backup eksternal.
 *
 * Fail-closed: usage invalid -> nonzero; shard salah/file hilang/rusak/
 * drill gagal -> nonzero sebelum mutasi. Default dry-run: uraikan target
 * + langkah, nol mutasi. Restore penuh via SATU --file wrangler setelah
 * drill lokal lulus pada file sumber.
 *
 * Usage:
 *   node scripts/rollback-migration.mjs --shard <BINDING> --file <abs.sql> [--live] [--dry-run|--apply]
 *   node scripts/rollback-migration.mjs --shard <BINDING> --backup-manifest <abs-manifest> [--live] [--dry-run|--apply]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyManifest, canonicalizeExternalPath } from './d1-backup.mjs';
import { checkDrillDatabase } from './restore-drill-local.mjs';
import { DatabaseSync } from 'node:sqlite';

export const ROLLBACK_SHARDS = Object.freeze([
	'DB_SAMARINDA_GROUP',
	'DB_BALIKPAPAN_GROUP',
	'DB_BERAU_GROUP'
]);
export const ROLLBACK_CONFIG = 'wrangler.pages.jsonc';

export function rollbackUsage() {
	return [
		'Usage:',
		'  node scripts/rollback-migration.mjs --shard <BINDING> --file <abs-path.sql> [--live] [--dry-run|--apply]',
		'  node scripts/rollback-migration.mjs --shard <BINDING> --backup-manifest <abs-manifest> [--live] [--dry-run|--apply]',
		`  BINDING salah satu: ${ROLLBACK_SHARDS.join('|')}`
	].join('\n');
}

export function parseRollbackArgs(argv) {
	const args = { shard: null, file: null, backupManifest: null, live: false, apply: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--shard') args.shard = argv[++i];
		else if (arg === '--file') args.file = argv[++i];
		else if (arg === '--backup-manifest') args.backupManifest = argv[++i];
		else if (arg === '--live') args.live = true;
		else if (arg === '--apply') args.apply = true;
		else if (arg === '--dry-run') args.apply = false;
		else if (arg === '--local') args.live = false;
		else throw new Error(`Argumen tidak diizinkan: ${arg}. Lihat usage.`);
	}
	if (!args.shard || !ROLLBACK_SHARDS.includes(args.shard))
		throw new Error(`--shard wajib salah satu: ${ROLLBACK_SHARDS.join('|')}`);
	if (!args.file && !args.backupManifest)
		throw new Error('--file atau --backup-manifest wajib diisi (path absolut eksternal)');
	if (args.file && args.backupManifest)
		throw new Error('Pilih salah satu: --file atau --backup-manifest');
	return args;
}

/** Resolve file SQL sumber dari argumen; verifikasi + drill penuh. Kembalikan rencana. */
export async function resolveRollbackPlan(args) {
	let sqlFile;
	if (args.backupManifest) {
		const { manifestPath: canonical } = await verifyManifest(args.backupManifest, {});
		if (!existsSync(join(dirname(canonical), 'COMPLETE')))
			throw new Error('Backup belum COMPLETE: tolak rollback.');
		const manifest = JSON.parse(readFileSync(canonical, 'utf8'));
		const entry = (manifest.shards ?? []).find((s) => s.binding === args.shard);
		if (!entry) throw new Error(`Manifest tidak memuat shard target ${args.shard}. Hentikan.`);
		sqlFile = join(dirname(canonical), entry.file);
	} else {
		sqlFile = await canonicalizeExternalPath(args.file, { mustExist: true });
	}
	if (!sqlFile.endsWith('.sql')) throw new Error('File sumber harus .sql');
	let sql;
	try {
		sql = readFileSync(sqlFile, 'utf8');
	} catch {
		throw new Error(`File sumber tidak terbaca: ${sqlFile}`);
	}
	if (!sql.trim()) throw new Error('File sumber kosong. Hentikan.');
	// Drill kanonik pada sumber SEBELUM mutasi apa pun.
	const mem = new DatabaseSync(':memory:');
	try {
		mem.exec('PRAGMA foreign_keys=OFF;');
		mem.exec(sql);
		const adapter = {
			all: (q) => mem.prepare(q).all(),
			get: (q) => mem.prepare(q).get()
		};
		const report = checkDrillDatabase(adapter, 'full');
		return { shard: args.shard, live: args.live, sqlFile, sql, tables: report.tables.length };
	} catch (error) {
		throw new Error(`Drill sumber gagal, rollback ditolak: ${error.message}`);
	} finally {
		mem.close();
	}
}

export function rollbackSteps(plan, apply) {
	return [
		`Target shard : ${plan.shard} (${plan.live ? 'REMOTE LIVE' : 'LOCAL'})`,
		`Sumber       : ${plan.sqlFile} (${plan.tables} tabel lulus drill)`,
		apply ? 'Mode         : APPLY (satu wrangler --file)' : 'Mode         : DRY-RUN (nol mutasi)'
	].join('\n');
}

export async function main(argv = process.argv.slice(2), deps = {}) {
	const spawn = deps.spawn ?? spawnSync;
	let args;
	try {
		args = parseRollbackArgs(argv);
	} catch (error) {
		console.error(`FAILED: ${error.message}\n${rollbackUsage()}`);
		process.exitCode = 2;
		return;
	}
	let plan;
	try {
		plan = await resolveRollbackPlan(args);
	} catch (error) {
		console.error(`FAILED: ${error.message}`);
		process.exitCode = 1;
		return;
	}
	console.log(rollbackSteps(plan, args.apply));
	if (!args.apply) {
		console.log('DRY-RUN selesai tanpa mutasi. Tambahkan --apply untuk eksekusi.');
		return;
	}
	const result = spawn(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			plan.shard,
			plan.live ? '--remote' : '--local',
			'--config',
			ROLLBACK_CONFIG,
			`--file=${plan.sqlFile}`,
			'--yes'
		],
		{ encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' }
	);
	if (result.status !== 0) {
		console.error(`ROLLBACK FAILED (exit ${result.status}):`);
		console.error((result.stderr || result.stdout || '').slice(0, 1000));
		process.exitCode = 1;
		return;
	}
	console.log('Rollback/restore selesai. Verifikasi schema + smoke cabang sebelum lanjut.');
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
