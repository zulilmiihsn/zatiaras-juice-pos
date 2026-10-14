#!/usr/bin/env node
/** Destructive pre-operational cleanup, NOT void/migration. Source inventory + confirmation are mandatory.
 * Catalog/settings/profiles/policy/audit and immutable stock reconciliations are retained;
 * stock needs an approved physical reconciliation.
 * Dry-run/local by default. Remote requires --live. All live deletion belongs to ONE guarded file batch.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRecoverySource } from './restore-drill-local.mjs';
import { wranglerInvocation, withSqlSnapshot } from './wrangler-cli.mjs';

export const CONFIG_FILE = 'wrangler.pages.jsonc';
export const BRANCH_BINDINGS = Object.freeze({
	samarinda: 'DB_SAMARINDA_GROUP',
	balikpapan: 'DB_BALIKPAPAN_GROUP',
	berau: 'DB_BERAU_GROUP'
});
export const WIPE_TABLES = Object.freeze([
	'transaksi_kasir',
	'produk_mutasi',
	'bahan_mutasi',
	'buku_kas',
	'ringkasan_penjualan_harian',
	'penjualan_produk_harian',
	'ringkasan_kas_arsip_harian',
	'archive_job_items',
	'pos_void_markers',
	'pos_nomor_harian',
	'sesi_toko',
	'offline_stock_reviews',
	'stock_policy_transitions'
]);
// stock_reconciliations/_items sengaja TIDAK dihapus. Item dilindungi trigger 0032
// `trg_stock_reconciliation_item_delete_guard` (RAISE STOCK_RECONCILIATION_ITEMS_IMMUTABLE);
// header tidak punya trigger/FK, tetapi dipertahankan agar item tidak yatim. Dulu tercantum di
// sini dan membuat wipe live gagal-atomik (14 Okt 2026).
export const ARCHIVE_GUARD_TABLES = Object.freeze([
	'archive_jobs',
	'archive_job_items',
	'archive_restore_jobs',
	'archive_restore_rows'
]);
export const WIPE_MAX_STATEMENTS = 1000;
export const WIPE_MAX_SQL_BYTES = 90000;
const validBranch = (branch) => Object.hasOwn(BRANCH_BINDINGS, branch);
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
// D1 limits expression depth to 100; balanced predicates retain every field without a linear tree.
function balancedAnd(terms) {
	if (terms.length === 1) return terms[0];
	const middle = Math.floor(terms.length / 2);
	return `(${balancedAnd(terms.slice(0, middle))} AND ${balancedAnd(terms.slice(middle))})`;
}
function assertIntent(args) {
	if (!validBranch(args.branch))
		throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	if (!args.backupManifest) throw new Error('--backup-manifest wajib diisi');
	if (args.apply !== undefined && typeof args.apply !== 'boolean')
		throw new Error('Mode apply wajib boolean');
	if (args.apply && args.confirm !== args.branch)
		throw new Error('--apply wajib disertai --confirm <branch> yang sama persis');
	if (args.live && args.persistTo) throw new Error('Mode live/persist-to bertentangan');
}
export function parseArgs(argv) {
	const args = {
		branch: null,
		backupManifest: null,
		baselineFile: null,
		baselineSha256: null,
		apply: false,
		confirm: null,
		live: false,
		persistTo: null
	};
	const values = {
		'--branch': 'branch',
		'--backup-manifest': 'backupManifest',
		'--expect-baseline': 'baselineFile',
		'--expect-baseline-sha256': 'baselineSha256',
		'--confirm': 'confirm',
		'--persist-to': 'persistTo'
	};
	const seen = new Set();
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (seen.has(flag)) throw new Error(`Argumen duplikat: ${flag}`);
		seen.add(flag);
		if (Object.hasOwn(values, flag)) {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error(`${flag} wajib bernilai`);
			args[values[flag]] = value;
		} else if (flag === '--apply') args.apply = true;
		else if (flag === '--dry-run') args.apply = false;
		else if (flag === '--live') args.live = true;
		else if (flag === '--local') args.live = false;
		else throw new Error(`Argumen tidak diizinkan: ${flag}`);
	}
	if ((seen.has('--apply') && seen.has('--dry-run')) || (seen.has('--live') && seen.has('--local')))
		throw new Error('Mode wipe bertentangan');
	assertIntent(args);
	return args;
}
/** The canonical full drill returns the exact backed-up target rows, not just a readable SQL header. */
export async function assertBackupCoversBranch(manifestPath, branch, options = {}) {
	if (!validBranch(branch))
		throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	const binding = BRANCH_BINDINGS[branch];
	const verified = await verifyRecoverySource(
		{
			binding,
			backupManifest: manifestPath,
			baselineFile: options.baselineFile,
			baselineSha256: options.baselineSha256
		},
		(mem) => {
			for (const table of ARCHIVE_GUARD_TABLES)
				if (mem.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id=?`).get(branch).n > 0)
					throw new Error('Backup berisi arsip/restore intent: perlu review operator, bukan wipe');
			return Object.fromEntries(
				WIPE_TABLES.map((table) => [
					table,
					{
						columns: mem
							.prepare(`PRAGMA table_info(${identifier(table)})`)
							.all()
							.map((row) => String(row.name)),
						rows: mem
							.prepare(`SELECT * FROM ${identifier(table)} WHERE cabang_id=?`)
							.all(branch)
							.map((row) => ({ ...row }))
					}
				])
			);
		}
	);
	return { binding, source: verified.capture };
}
export function countSql(table, branch) {
	if (![...WIPE_TABLES, ...ARCHIVE_GUARD_TABLES].includes(table))
		throw new Error('Tabel wipe tidak diizinkan');
	return { sql: `SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id = ?`, params: [branch] };
}
export function deleteSql(table, branch) {
	countSql(table, branch);
	return { sql: `DELETE FROM ${table} WHERE cabang_id = ?`, params: [branch] };
}
/** All-field source equality and archive guards precede every DELETE, in the SAME transaction.
 * Conservative SQL/statement caps fail before target access; never fall back to partial deletion.
 */
export function buildWipeSql(branch, source) {
	if (!validBranch(branch))
		throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	if (!source) throw new Error('Wipe source inventory wajib');
	const scope = `cabang_id=${literal(branch)}`;
	const statements = [];
	const guard = (condition, reason) =>
		statements.push(`SELECT CASE WHEN (${condition}) THEN 1 ELSE json(${literal(reason)}) END;`);
	for (const table of ARCHIVE_GUARD_TABLES)
		guard(`(SELECT COUNT(*) FROM ${table} WHERE ${scope})=0`, `WIPE_ARCHIVE:${table}`);
	for (const table of WIPE_TABLES) {
		const state = source[table];
		if (
			!state ||
			!state.columns.includes('cabang_id') ||
			!Array.isArray(state.rows) ||
			state.rows.some((row) => row.cabang_id !== branch)
		)
			throw new Error('Wipe source inventory tidak lengkap/scoped');
		guard(
			`(SELECT group_concat(name,'|') FROM (SELECT name FROM pragma_table_info(${literal(table)}) ORDER BY cid)) IS ${literal(state.columns.join('|'))}`,
			`WIPE_SCHEMA:${table}`
		);
		guard(
			`(SELECT COUNT(*) FROM ${table} WHERE ${scope})=${state.rows.length}`,
			`WIPE_COUNT:${table}`
		);
		const render = (rows) => {
			const values = rows.map((row) => state.columns.map((column) => row[column]));
			if (
				values.some((row) =>
					row.some(
						(value) =>
							value instanceof Uint8Array || (typeof value === 'number' && !Number.isFinite(value))
					)
				)
			)
				throw new Error('WIPE_BUDGET_BLOCKED: unsupported value, perlu ADR/owner');
			return `NOT EXISTS (SELECT 1 FROM json_each(${literal(JSON.stringify(values))}) x WHERE NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${scope} AND ${balancedAnd(state.columns.map((column, index) => `t.${identifier(column)} IS json_extract(x.value,'$[${index}]')`))}))`;
		};
		let rows = [];
		for (const row of state.rows) {
			const candidate = [...rows, row];
			if (
				rows.length &&
				(candidate.length > 100 || Buffer.byteLength(render(candidate)) > WIPE_MAX_SQL_BYTES - 1024)
			) {
				guard(render(rows), `WIPE_SOURCE:${table}`);
				rows = [];
			}
			rows.push(row);
			if (Buffer.byteLength(render(rows)) > WIPE_MAX_SQL_BYTES - 1024)
				throw new Error(
					'WIPE_BUDGET_BLOCKED: individual source row, perlu ADR/owner; jangan partial wipe'
				);
		}
		if (rows.length) guard(render(rows), `WIPE_SOURCE:${table}`);
	}
	for (const table of WIPE_TABLES) {
		statements.push(`DELETE FROM ${table} WHERE cabang_id = ${literal(branch)};`);
		guard(`(SELECT COUNT(*) FROM ${table} WHERE ${scope})=0`, `WIPE_REMAIN:${table}`);
	}
	if (
		statements.length > WIPE_MAX_STATEMENTS ||
		statements.some((sql) => Buffer.byteLength(sql) > WIPE_MAX_SQL_BYTES)
	)
		throw new Error('WIPE_BUDGET_BLOCKED: atomic budget, perlu ADR/owner; jangan partial wipe');
	return {
		// D1 remote menolak BEGIN/COMMIT di file ("use state.storage.transaction()"); eksekusi
		// --file D1 sudah atomik sendiri (gagal = kembali ke state awal), dibuktikan live 14 Okt 2026.
		// Guard memicu error, jadi kegagalan mana pun membatalkan seluruh file.
		sql: ['-- ZatiarasPOS Wipe Branch History (atomic per D1 file execution)', ...statements].join(
			'\n'
		),
		statements,
		branch,
		tables: [...WIPE_TABLES]
	};
}
function runWrangler(binding, args, options, spawn = spawnSync) {
	const invocation = wranglerInvocation([
		'd1',
		'execute',
		binding,
		options.live ? '--remote' : '--local',
		'--config',
		CONFIG_FILE,
		...args,
		...(options.persistTo ? ['--persist-to', options.persistTo] : [])
	]);
	const result = spawn(invocation.command, invocation.args, invocation.options);
	if (result.error || result.status !== 0)
		throw new Error(
			'Wrangler gagal; hasil dapat ambigu. Verifikasi operator, jangan restore/retry buta.'
		);
	return result;
}
async function targetCounts(binding, branch, options) {
	const tables = [...new Set([...ARCHIVE_GUARD_TABLES, ...WIPE_TABLES])];
	const query = `SELECT ${tables.map((table) => `(SELECT COUNT(*) FROM ${table} WHERE cabang_id=${literal(branch)}) AS ${identifier(table)}`).join(', ')}`;
	const result = runWrangler(binding, ['--command', query, '--json'], options);
	const row = JSON.parse(result.stdout)?.[0]?.results?.[0];
	if (!row) throw new Error('Wipe count tidak valid; hentikan tanpa mutasi');
	return new Map(tables.map((table) => [table, { n: row[table] }]));
}
export async function wipeBranchHistory(args, execute, applyFile) {
	assertIntent(args);
	const { binding, source } = await assertBackupCoversBranch(
		args.backupManifest,
		args.branch,
		args
	);
	const plan = buildWipeSql(args.branch, source);
	const counts = new Map();
	const target = execute ? null : await targetCounts(binding, args.branch, args);
	for (const table of new Set([...ARCHIVE_GUARD_TABLES, ...WIPE_TABLES])) {
		const row = execute
			? await execute(binding, countSql(table, args.branch).sql, [args.branch])
			: target.get(table);
		const count = row?.n;
		if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
			throw new Error('Wipe count tidak valid; hentikan tanpa mutasi');
		counts.set(table, count);
	}
	for (const table of ARCHIVE_GUARD_TABLES)
		if (counts.get(table) > 0)
			throw new Error(`${table} berisi: arsip harus ditangani deliberatif dulu. Hentikan wipe.`);
	for (const table of WIPE_TABLES)
		if (counts.get(table) !== source[table].rows.length)
			throw new Error(`Target berbeda dari backup: ${table}; backup baru diperlukan`);
	if (args.apply)
		await (
			applyFile ??
			((binding, sql) =>
				withSqlSnapshot(sql, (file) => runWrangler(binding, [`--file=${file}`, '--yes'], args)))
		)(binding, plan.sql);
	// Remote file execution is not proven atomic, so the report reads the target back instead of
	// asserting zero; any surviving row means a partial wipe that must be recovered from backup.
	const after = new Map(counts);
	if (args.apply) {
		const recount = execute ? null : await targetCounts(binding, args.branch, args);
		for (const table of WIPE_TABLES) {
			const row = execute
				? await execute(binding, countSql(table, args.branch).sql, [args.branch])
				: recount.get(table);
			after.set(table, row?.n);
		}
		const leftover = WIPE_TABLES.filter((table) => after.get(table) !== 0);
		if (leftover.length)
			throw new Error(
				`Wipe tak konsisten (${leftover.join(', ')} masih berisi). Pulihkan dari backup ${args.backupManifest}.`
			);
	}
	return {
		branch: args.branch,
		binding,
		apply: args.apply,
		report: WIPE_TABLES.map((table) => ({
			table,
			before: counts.get(table),
			after: after.get(table)
		}))
	};
}
export function formatReport({ branch, apply, report }) {
	return [
		`${apply ? 'WIPE' : 'DRY-RUN'} cabang ${branch}:`,
		...report.map((row) => `  - ${row.table}: ${row.before} -> ${row.after}`),
		apply
			? 'SELESAI: semua tabel target terbaca ulang 0. Wajib stock reconciliation, katalog verification dan smoke operator.'
			: 'DRY-RUN selesai tanpa menghapus. Apply perlu --confirm cabang dan approval operator.'
	].join('\n');
}
export async function main(argv = process.argv.slice(2)) {
	const result = await wipeBranchHistory(parseArgs(argv));
	console.log(formatReport(result));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
