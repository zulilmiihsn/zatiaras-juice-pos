#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

console.log('🔄 ZatiarasPOS D1 Migration Rollback & Emergency Restore Utility');

function getArg(name) {
	const idx = process.argv.indexOf(name);
	return idx >= 0 ? process.argv[idx + 1] : null;
}

const targetShard = getArg('--shard');
let backupFile = getArg('--file');
const isLive = process.argv.includes('--live');
const isApply = process.argv.includes('--apply');

if (!targetShard && !backupFile) {
	console.log(`
Usage:
  node scripts/rollback-migration.mjs --shard <DB_SAMARINDA_GROUP|DB_BALIKPAPAN_GROUP|DB_BERAU_GROUP> [--live] [--apply]
  node scripts/rollback-migration.mjs --file <path/to/backup.sql> [--shard <SHARD>] [--live] [--apply]
`);
	process.exit(0);
}

const shard = targetShard || 'DB_SAMARINDA_GROUP';

// If --shard is specified without --file, find the most recent backup in backups/
if (!backupFile && targetShard) {
	const backupsDir = resolve('backups');
	if (existsSync(backupsDir)) {
		const candidates = readdirSync(backupsDir)
			.filter(
				(f) =>
					f.endsWith('.sql') && (f.includes(targetShard) || f.includes(targetShard.toLowerCase()))
			)
			.map((f) => ({
				file: join(backupsDir, f),
				mtime: statSync(join(backupsDir, f)).mtimeMs
			}))
			.sort((a, b) => b.mtime - a.mtime);

		if (candidates.length > 0) {
			backupFile = candidates[0].file;
			console.log(`📁 Auto-discovered most recent snapshot for ${targetShard}: ${backupFile}`);
		}
	}
}

if (!backupFile) {
	console.log(`ℹ️ No local backup snapshot found in backups/ for ${shard}.`);
	console.log(
		`💡 D1 migrations are atomic per migration file. If a migration statement fails during apply,`
	);
	console.log(`   D1 automatically rolls back the active transaction.`);
	console.log(`   To restore an external backup, provide: --file <path/to/backup.sql> --apply`);
	process.exit(0);
}

if (!existsSync(backupFile)) {
	console.error(`❌ Backup file not found: ${backupFile}`);
	process.exit(1);
}

const liveFlag = isLive ? '--remote' : '--local';
console.log(`Target Shard  : ${shard}`);
console.log(`Backup Source : ${backupFile}`);
console.log(`Environment   : ${isLive ? 'REMOTE LIVE' : 'LOCAL'}`);

if (!isApply) {
	console.log(`ℹ️ Dry-run mode: Pass --apply to execute restore on D1 shard.`);
	process.exit(0);
}

console.log(`🚀 Executing rollback/restore on ${shard}...`);
execSync(`npx wrangler d1 execute ${shard} ${liveFlag} --file="${backupFile}"`, {
	stdio: 'inherit'
});
console.log(`✅ Rollback successfully applied on ${shard}.`);
process.exit(0);
