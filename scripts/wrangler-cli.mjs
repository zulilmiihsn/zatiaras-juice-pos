import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const metadataPath = createRequire(import.meta.url).resolve('wrangler/package.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (typeof metadata.bin?.wrangler !== 'string')
	throw new Error('Entrypoint Wrangler tidak tersedia');
const entry = resolve(dirname(metadataPath), metadata.bin.wrangler);

/**
 * Private run-owned snapshot prevents reopening a mutable source pathname at apply time.
 * @template T
 * @param {string} sql
 * @param {(file: string) => T | Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withSqlSnapshot(sql, run) {
	const directory = mkdtempSync(join(tmpdir(), 'zatiaras-verified-sql-'));
	try {
		const file = join(directory, 'verified.sql');
		writeFileSync(file, sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
		return await run(file);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/**
 * Node + package bin works on Windows/Linux without npx.cmd or shell interpretation of paths.
 * @param {string[]} args
 * @returns {{ command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding }}
 */
export function wranglerInvocation(args) {
	return {
		command: process.execPath,
		args: [entry, ...args],
		options: { encoding: 'utf8', stdio: 'pipe', shell: false }
	};
}
