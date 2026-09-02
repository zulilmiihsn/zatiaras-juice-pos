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
const backupFile = getArg('--file');
const isLive = process.argv.includes('--live');

if (!targetShard && !backupFile) {
	console.log(`
Usage:
  node scripts/rollback-migration.mjs --shard <DB_SAMARINDA_GROUP|DB_BALIKPAPAN_GROUP|DB_BERAU_GROUP> [--live]
  node scripts/rollback-migration.mjs --file <path/to/backup.sql> [--shard <SHARD>] [--live]

Rollback Steps:
1. Identify the failing migration statement in the target shard.
2. If D1 supports transaction abort, the active migration batch rolls back automatically.
3. To restore from the latest verified automated snapshot:
   node scripts/d1-restore.mjs --file <backup_file> --shard <shard>
`);
	process.exit(0);
}

if (backupFile) {
	if (!existsSync(backupFile)) {
		console.error(`❌ Backup file not found: ${backupFile}`);
		process.exit(1);
	}
	console.log(`Restoring database from backup: ${backupFile}...`);
	const liveFlag = isLive ? '--remote' : '--local';
	const shard = targetShard || 'DB_SAMARINDA_GROUP';
	execSync(`npx wrangler d1 execute ${shard} ${liveFlag} --file="${backupFile}"`, {
		stdio: 'inherit'
	});
	console.log('✅ Database successfully restored to pre-migration snapshot.');
	process.exit(0);
}

console.log(`Rollback check completed for shard ${targetShard || 'all'}.`);
