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
import { wranglerInvocation, withSqlSnapshot } from './wrangler-cli.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRecoverySource } from './restore-drill-local.mjs';

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
		`  BINDING salah satu: ${ROLLBACK_SHARDS.join('|')}`,
		'  Wajib: --expect-baseline <approved-inventory.json> --expect-baseline-sha256 <approved-hash>',
		'  Backup historis: --expect-migration <nama.sql> (target diverifikasi, bukan auto-upgrade)'
	].join('\n');
}

export function parseRollbackArgs(argv) {
	const args = {
		shard: null,
		file: null,
		backupManifest: null,
		expectedMigration: null,
		baselineFile: null,
		baselineSha256: null,
		live: false,
		apply: false,
		persistTo: null
	};
	const seen = new Set();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (seen.has(arg)) throw new Error(`Argumen duplikat: ${arg}`);
		seen.add(arg);
		if (
			['--shard', '--file', '--backup-manifest', '--persist-to'].includes(arg) &&
			(!argv[i + 1] || argv[i + 1].startsWith('--'))
		)
			throw new Error(`${arg} wajib bernilai`);
		if (arg === '--persist-to') args.persistTo = argv[++i];
		else if (arg === '--shard') args.shard = argv[++i];
		else if (arg === '--file') args.file = argv[++i];
		else if (arg === '--backup-manifest') args.backupManifest = argv[++i];
		else if (arg === '--expect-baseline' || arg === '--expect-baseline-sha256') {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error(`${arg} wajib bernilai`);
			if (arg === '--expect-baseline') args.baselineFile = value;
			else args.baselineSha256 = value;
		} else if (arg === '--expect-migration') {
			const target = argv[++i];
			if (!target || target.startsWith('--'))
				throw new Error('--expect-migration wajib bernilai nama migrasi');
			args.expectedMigration = target;
		} else if (arg === '--live') args.live = true;
		else if (arg === '--apply') args.apply = true;
		else if (arg === '--dry-run') args.apply = false;
		else if (arg === '--local') args.live = false;
		else throw new Error(`Argumen tidak diizinkan: ${arg}. Lihat usage.`);
	}
	if (
		(seen.has('--live') && seen.has('--local')) ||
		(seen.has('--apply') && seen.has('--dry-run')) ||
		(args.live && args.persistTo)
	)
		throw new Error('Mode rollback bertentangan');
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
	const source = await verifyRecoverySource({
		binding: args.shard,
		file: args.file,
		backupManifest: args.backupManifest,
		baselineFile: args.baselineFile,
		baselineSha256: args.baselineSha256,
		expectedMigration: args.expectedMigration
	});
	return { ...source, shard: args.shard, live: args.live };
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
	const result = await withSqlSnapshot(plan.sql, async (file) => {
		const invocation = wranglerInvocation([
			'd1',
			'execute',
			plan.shard,
			plan.live ? '--remote' : '--local',
			'--config',
			ROLLBACK_CONFIG,
			`--file=${file}`,
			'--yes',
			...(args.persistTo ? ['--persist-to', args.persistTo] : [])
		]);
		return spawn(invocation.command, invocation.args, invocation.options);
	});
	if (result.status !== 0 || result.error) {
		console.error(
			`ROLLBACK FAILED (exit ${result.status}); target dapat ambigu. Jangan retry dengan source/key berbeda; verifikasi operator dahulu.`
		);
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
