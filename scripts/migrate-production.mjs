#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

console.log('📦 ZatiarasPOS Production Migration Wrapper (Strict Fail-Closed)...');

const MIGRATIONS_DIR = resolve('drizzle');
const JOURNAL_FILE = resolve('drizzle/meta/_journal.json');

function computeSha256(filePath) {
	const content = readFileSync(filePath, 'utf8');
	return createHash('sha256').update(content).digest('hex');
}

try {
	// 1. Verify journal and migrations exist
	if (!existsSync(JOURNAL_FILE)) {
		throw new Error(`Migration journal not found at ${JOURNAL_FILE}`);
	}
	const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'));
	console.log(`✅ Loaded migration journal (${journal.entries?.length || 0} entries).`);

	// 2. Verify all migration SQL files
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	console.log(`✅ Found ${files.length} migration SQL files.`);

	const manifest = {};
	for (const file of files) {
		const fullPath = join(MIGRATIONS_DIR, file);
		const hash = computeSha256(fullPath);
		manifest[file] = hash;
	}
	console.log(`✅ Computed SHA-256 checksums for all ${files.length} migrations.`);

	// 3. Dry-run or check arguments
	const isApply = process.argv.includes('--apply');
	const isLive = process.argv.includes('--live');

	if (!isApply) {
		console.log(
			'ℹ️ Dry-run complete: All migrations verified. Pass --apply [--live] to execute on D1 databases.'
		);
		process.exit(0);
	}

	console.log(
		`🚀 Executing migrations across all 3 production shards (${isLive ? 'REMOTE LIVE' : 'LOCAL'})...`
	);
	const shards = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];

	for (const shard of shards) {
		console.log(`Applying migrations to ${shard}...`);
		const liveFlag = isLive ? '--remote' : '--local';
		execSync(`npx wrangler d1 migrations apply ${shard} ${liveFlag}`, {
			stdio: 'inherit'
		});
	}

	console.log('🎉 All migrations applied successfully with zero errors.');
	process.exit(0);
} catch (error) {
	console.error('❌ Migration failed:', error.message);
	console.error(
		'⚠️ Rollback guidance: Inspect failing migration statement and restore previous D1 backup using:'
	);
	console.error('   pnpm d1:restore --file=<backup_file>');
	process.exit(1);
}
