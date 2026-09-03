#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

console.log('📦 ZatiarasPOS Production Migration Wrapper (Strict Fail-Closed)...');

const MIGRATIONS_DIR = resolve('drizzle');
const JOURNAL_FILE = resolve('drizzle/meta/_journal.json');
const MANIFEST_FILE = resolve('drizzle/meta/manifest.json');

function computeSha256(filePath) {
	const content = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

try {
	// 1. Verify journal exists
	if (!existsSync(JOURNAL_FILE)) {
		throw new Error(`Migration journal not found at ${JOURNAL_FILE}`);
	}
	const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'));
	const journalEntries = journal.entries || [];
	console.log(`✅ Loaded migration journal (${journalEntries.length} entries).`);

	// 2. Verify manifest exists
	if (!existsSync(MANIFEST_FILE)) {
		throw new Error(`Migration manifest not found at ${MANIFEST_FILE}`);
	}
	const expectedManifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

	// 3. Scan physical migration files
	const files = readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	console.log(`✅ Found ${files.length} migration SQL files.`);

	if (files.length !== journalEntries.length) {
		throw new Error(
			`Migration file count mismatch: found ${files.length} files, but journal expects ${journalEntries.length}`
		);
	}

	// 4. Verify exact sequence and checksums against journal and manifest
	for (let i = 0; i < journalEntries.length; i++) {
		const expectedTag = `${journalEntries[i].tag}.sql`;
		const actualFile = files[i];
		if (actualFile !== expectedTag) {
			throw new Error(
				`Migration order violation at index ${i}: expected '${expectedTag}', got '${actualFile}'`
			);
		}

		const fullPath = join(MIGRATIONS_DIR, actualFile);
		const actualHash = computeSha256(fullPath);
		const expectedHash = expectedManifest[actualFile];

		if (!expectedHash) {
			throw new Error(`Migration file '${actualFile}' is not registered in manifest.json`);
		}

		if (actualHash !== expectedHash) {
			throw new Error(
				`CHECKSUM MISMATCH on '${actualFile}': expected ${expectedHash}, computed ${actualHash}. Potential tampering detected!`
			);
		}
	}
	console.log(
		`🔒 Checksum validation PASSED: all ${files.length} migration files match manifest hashes.`
	);

	// 5. Dry-run or check arguments
	const isApply = process.argv.includes('--apply');
	const isLive = process.argv.includes('--live');

	if (!isApply) {
		console.log(
			'ℹ️ Dry-run complete: All migrations verified. Pass --apply [--live] to execute on D1 databases.'
		);
		process.exit(0);
	}

	console.log(
		`🚀 Executing migrations across production shards (${isLive ? 'REMOTE LIVE' : 'LOCAL'})...`
	);
	const shards = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];

	for (const shard of shards) {
		console.log(`Applying migrations to ${shard}...`);
		const liveFlag = isLive ? '--remote' : '--local';
		try {
			execSync(`npx wrangler d1 migrations apply ${shard} ${liveFlag}`, {
				stdio: 'inherit'
			});
		} catch (execErr) {
			console.error(
				`💥 First-fail-stop: Migration execution failed on shard ${shard}. Halting remaining shards.`
			);
			throw execErr;
		}
	}

	console.log('🎉 All migrations applied successfully with zero errors.');
	process.exit(0);
} catch (error) {
	console.error('❌ Migration failed:', error.message);
	console.error('⚠️ Rollback guidance: Use rollback script:');
	console.error('   node scripts/rollback-migration.mjs --shard=<shard> [--restore-backup]');
	process.exit(1);
}
