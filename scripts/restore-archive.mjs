import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseRestoreArgs,
	sha256Hex,
	validateArchive,
	buildRestoreChunks,
	DEFAULT_RESTORE_CHUNK_ROWS
} from './restore-archive-lib.mjs';
import { decodeDecimalNumber } from '../src/lib/utils/currency.ts';
import { getBranchDbBinding, normalizeBranch } from '../src/lib/server/branchResolver.ts';
import { wranglerInvocation } from './wrangler-cli.mjs';

/** Never use local marker files as proof of a DB commit: job/digest/checkpoints live in the target DB. */
export async function main(argv = process.argv.slice(2), deps = {}) {
	const args = parseRestoreArgs(argv);
	if (!args.file)
		throw new Error(
			'Usage: --file <archive.json> [--dry-run|--apply --expect-sha256 <approved-hash>] [--local|--remote] [--binding <BINDING>]'
		);
	const raw = readFileSync(args.file, 'utf8');
	const sha256 = sha256Hex(raw);
	if (args.expectSha256 && args.expectSha256 !== sha256)
		throw new Error('CHECKSUM MISMATCH: source berbeda dari expected SHA-256');
	let archive;
	try {
		archive = JSON.parse(raw);
	} catch {
		throw new Error('Format JSON tidak valid');
	}
	const validation = validateArchive(archive);
	if (!validation.ok) throw new Error(validation.errors.join('; '));
	const binding = getBranchDbBinding(normalizeBranch(validation.branch));
	if (args.binding && args.binding !== binding)
		throw new Error('Binding tidak sesuai cabang archive');
	const rows =
		args.chunkRows == null ? DEFAULT_RESTORE_CHUNK_ROWS : decodeDecimalNumber(args.chunkRows);
	if (rows === null || !Number.isSafeInteger(rows) || rows < 1)
		throw new Error('Chunk rows tidak valid');
	const planned = buildRestoreChunks(archive, { sha256 }, rows);
	console.log(
		`Archive validated: ${planned.totalRows} rows; ${planned.chunks.length} bounded stages; one ${planned.final.statements.length}-statement atomic final. Target ${binding}; SHA-256 ${sha256}.`
	);
	if (!args.apply) {
		console.log('[DRY RUN]: Validation complete. 0 database mutations made.');
		return planned;
	}
	if (!args.expectSha256)
		throw new Error('Apply membutuhkan --expect-sha256 approved; dry-run dahulu');
	const directory = mkdtempSync(join(tmpdir(), 'zatiaras-atomic-restore-'));
	const spawn = deps.spawn ?? spawnSync;
	function* phases() {
		if (args.remote)
			for (const chunk of planned.chunks) yield { name: `stage-${chunk.index}`, sql: chunk.sql };
		yield { name: 'final-atomic', sql: planned.final.sql };
	}
	try {
		if (!args.remote) {
			// Reuse one workerd for all bounded stages instead of hundreds of Wrangler startups.
			const getPlatformProxy = deps.getPlatformProxy ?? (await import('wrangler')).getPlatformProxy;
			const proxy = await getPlatformProxy({
				configPath: 'wrangler.pages.jsonc',
				remoteBindings: false,
				persist: args.persistTo ? { path: resolve(args.persistTo, 'v3') } : true
			});
			try {
				for (const chunk of planned.chunks) {
					await proxy.env[binding].batch(
						chunk.statements.map((sql) => proxy.env[binding].prepare(sql))
					);
				}
			} catch {
				throw new Error(
					'Staging gagal; live ledger belum difinalisasi. Ulangi source/digest/target sama.'
				);
			} finally {
				await proxy.dispose();
			}
		}
		for (const phase of phases()) {
			const file = join(directory, `${phase.name}.sql`);
			writeFileSync(file, phase.sql, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
			const invocation = wranglerInvocation([
				'd1',
				'execute',
				binding,
				args.remote ? '--remote' : '--local',
				'--config',
				'wrangler.pages.jsonc',
				`--file=${file}`,
				'--yes',
				...(args.persistTo ? ['--persist-to', args.persistTo] : [])
			]);
			const result = spawn(invocation.command, invocation.args, invocation.options);
			if (result.status !== 0 || result.error)
				throw new Error(
					`Restore ${phase.name} gagal; live ledger belum difinalisasi atau commit final ambigu. Ulangi sumber/digest/target sama; jangan ganti key atau partial apply.`
				);
			console.log(`[RESTORE] ${phase.name} committed.`);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
	console.log(
		'RESTORE COMPLETED: one atomic live commit; target job/digest makes retry idempotent. Source archive retained.'
	);
	return planned;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	try {
		await main();
	} catch (error) {
		console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
