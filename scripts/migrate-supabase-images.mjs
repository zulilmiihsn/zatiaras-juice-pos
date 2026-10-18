#!/usr/bin/env node
/**
 * Pindahkan gambar menu dari Supabase Storage ke R2 (dilayani /api/upload?key=...).
 * Dry-run/lokal secara default: hanya membaca D1 dan Supabase lalu memvalidasi. Tulis ke R2 dan D1
 * hanya dengan --apply; remote butuh --live. Urutan apply: unggah dan verifikasi SEMUA objek,
 * tulis backup + SQL rollback, baru UPDATE D1 (compare-and-swap pada URL lama), lalu baca ulang.
 * File di Supabase tidak dihapus; rollback = jalankan SQL rollback dari backup.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH_GROUPS } from '../src/lib/server/branchResolver.ts';
import {
	PRODUCT_IMAGE_MAX_BYTES,
	productImageExtension,
	productImageProxyPath,
	sniffProductImageMime
} from '../src/lib/server/r2ObjectPolicy.ts';
import { withSqlSnapshot, wranglerInvocation } from './wrangler-cli.mjs';

export const CONFIG_FILE = 'wrangler.pages.jsonc';
export const DEFAULT_BUCKET = 'zatiaras-assets';
export const BACKUP_DIRECTORY = 'backups';
// Satu-satunya sumber yang boleh diunduh. URL lain di produk.gambar menghentikan migrasi.
const SOURCE_URL =
	/^https:\/\/qmlzwklzahcfigjpoavz\.supabase\.co\/storage\/v1\/object\/public\/gambar-menu\/[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const FETCH_TIMEOUT_MS = 20_000;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseArgs(argv) {
	const args = { apply: false, live: false, config: CONFIG_FILE, bucket: DEFAULT_BUCKET };
	const values = { '--config': 'config', '--bucket': 'bucket' };
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
		throw new Error('Mode migrasi bertentangan');
	return args;
}

/** Baris produk bergambar URL absolut -> entri migrasi. Gagal tertutup untuk apa pun yang janggal. */
export function planMigration(rowsByBinding) {
	const entries = [];
	const foreign = [];
	for (const [binding, rows] of Object.entries(rowsByBinding)) {
		for (const row of rows) {
			const { id, cabang_id: branch, gambar: url } = row;
			if (!BRANCH_GROUPS[binding]?.includes(branch) || !SAFE_ID.test(String(id))) {
				throw new Error(`Baris produk tidak valid: ${binding} ${id}`);
			}
			if (SOURCE_URL.test(String(url))) entries.push({ binding, id: String(id), branch, url });
			else foreign.push(`${binding}/${id}`);
		}
	}
	if (foreign.length) {
		throw new Error(
			`${foreign.length} baris memakai URL di luar Supabase yang diizinkan (${foreign.slice(0, 5).join(', ')}); migrasi dihentikan`
		);
	}
	return entries;
}

/**
 * Kunci R2 deterministik per (cabang, URL sumber): menjalankan ulang menimpa objek yang sama,
 * bukan menumpuk yatim. Cabang ada di kunci karena rute hapus mengisolasi gambar per cabang.
 */
export function targetKey(branch, url, mime) {
	const hex = createHash('sha256').update(`${branch}\n${url}`).digest('hex');
	const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
	return `produk/${branch}/${uuid}.${productImageExtension(mime)}`;
}

const updateStatement = (change, from, to) =>
	`UPDATE produk SET gambar = ${literal(to)} WHERE id = ${literal(change.id)} AND cabang_id = ${literal(change.branch)} AND gambar = ${literal(from)};`;

export const buildUpdateSql = (changes) =>
	changes.map((change) => updateStatement(change, change.url, change.path)).join('\n');
export const buildRollbackSql = (changes) =>
	changes.map((change) => updateStatement(change, change.path, change.url)).join('\n');

/** @param {{ apply: boolean }} args */
export async function migrate(args, deps) {
	const bindings = Object.keys(BRANCH_GROUPS);
	const rowsByBinding = {};
	for (const binding of bindings) rowsByBinding[binding] = await deps.queryRows(binding);
	const entries = planMigration(rowsByBinding);
	if (entries.length === 0) return { changes: [], applied: false, remaining: 0 };

	const sources = new Map();
	for (const url of new Set(entries.map((entry) => entry.url))) {
		const bytes = await deps.fetchImage(url);
		if (bytes.length === 0 || bytes.length > PRODUCT_IMAGE_MAX_BYTES) {
			throw new Error(`Ukuran gambar tidak valid (${bytes.length} byte): ${url}`);
		}
		const mime = sniffProductImageMime(bytes);
		if (!mime) throw new Error(`Isi bukan gambar jpg/png/webp: ${url}`);
		sources.set(url, { bytes, mime, sha256: sha256(bytes) });
	}

	const changes = entries.map((entry) => {
		const source = sources.get(entry.url);
		const key = targetKey(entry.branch, entry.url, source.mime);
		return {
			...entry,
			key,
			path: productImageProxyPath(key),
			mime: source.mime,
			sha256: source.sha256,
			bytes: source.bytes.length
		};
	});
	if (!args.apply) return { changes, applied: false, remaining: changes.length };

	// Semua objek harus ada di R2 dan terbaca utuh SEBELUM satu baris D1 berubah.
	for (const change of new Map(changes.map((c) => [c.key, c])).values()) {
		await deps.putObject(change.key, sources.get(change.url).bytes, change.mime);
		if (sha256(await deps.getObject(change.key)) !== change.sha256) {
			throw new Error(`Verifikasi readback R2 gagal: ${change.key}`);
		}
	}
	const usedBindings = bindings.filter((binding) => changes.some((c) => c.binding === binding));
	const backupFiles = deps.writeBackup(
		changes,
		Object.fromEntries(
			usedBindings.map((binding) => [
				binding,
				buildRollbackSql(changes.filter((change) => change.binding === binding))
			])
		)
	);
	for (const binding of usedBindings) {
		await deps.execSql(binding, buildUpdateSql(changes.filter((c) => c.binding === binding)));
	}

	let remaining = 0;
	for (const binding of bindings) {
		remaining += (await deps.queryRows(binding)).filter((row) =>
			SOURCE_URL.test(row.gambar)
		).length;
	}
	return { changes, applied: true, remaining, backupFiles };
}

export function formatReport({ changes, applied, remaining, backupFiles }, args) {
	if (changes.length === 0)
		return 'Tidak ada gambar Supabase di produk.gambar. Tidak ada yang dilakukan.';
	const images = new Map(changes.map((change) => [change.key, change]));
	return [
		`${applied ? 'APPLY' : 'DRY-RUN'} (${args.live ? 'REMOTE LIVE' : 'LOCAL'}): ${changes.length} baris produk, ${images.size} objek R2`,
		...[...images.values()].map(
			(change) =>
				`  - ${change.key} (${change.mime}, ${change.bytes} byte, sha256 ${change.sha256.slice(0, 12)})`
		),
		...(applied
			? [
					`Backup dan SQL rollback: ${backupFiles.join(', ')}`,
					remaining === 0
						? 'SELESAI: tidak ada lagi baris dengan URL Supabase.'
						: `PERLU DIULANG: ${remaining} baris belum berpindah (kemungkinan diedit bersamaan). Aman dijalankan ulang.`
				]
			: ['DRY-RUN selesai tanpa menulis apa pun. Tambahkan --apply untuk menjalankan.'])
	].join('\n');
}

function runWrangler(args, spawn = spawnSync) {
	const invocation = wranglerInvocation(args);
	const result = spawn(invocation.command, invocation.args, invocation.options);
	if (result.error || result.status !== 0) {
		throw new Error(
			`Wrangler gagal (${args.slice(0, 3).join(' ')}): ${String(result.stderr || result.stdout || '').slice(0, 300)}`
		);
	}
	return result;
}

export function realDeps(args) {
	const mode = args.live ? '--remote' : '--local';
	const withTempFile = (run) => {
		const directory = mkdtempSync(join(tmpdir(), 'zatiaras-r2-image-'));
		try {
			return run(join(directory, 'object'));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	};
	return {
		queryRows(binding) {
			const result = runWrangler([
				'd1',
				'execute',
				binding,
				mode,
				'--config',
				args.config,
				'--json',
				'--command',
				"SELECT id, cabang_id, gambar FROM produk WHERE gambar LIKE 'http%' ORDER BY id"
			]);
			return JSON.parse(result.stdout)?.[0]?.results ?? [];
		},
		async fetchImage(url) {
			const response = await fetch(url, {
				redirect: 'error',
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!response.ok) throw new Error(`Unduh gagal (HTTP ${response.status}): ${url}`);
			const declared = Number(response.headers.get('content-length') ?? 0);
			if (declared > PRODUCT_IMAGE_MAX_BYTES) throw new Error(`Gambar terlalu besar: ${url}`);
			return new Uint8Array(await response.arrayBuffer());
		},
		putObject(key, bytes, mime) {
			withTempFile((file) => {
				writeFileSync(file, bytes, { mode: 0o600 });
				runWrangler([
					'r2',
					'object',
					'put',
					`${args.bucket}/${key}`,
					mode,
					'--file',
					file,
					'--content-type',
					mime
				]);
			});
		},
		getObject(key) {
			return withTempFile((file) => {
				runWrangler(['r2', 'object', 'get', `${args.bucket}/${key}`, mode, '--file', file]);
				return new Uint8Array(readFileSync(file));
			});
		},
		execSql(binding, sql) {
			return withSqlSnapshot(sql, (file) =>
				runWrangler([
					'd1',
					'execute',
					binding,
					mode,
					'--config',
					args.config,
					`--file=${file}`,
					'--yes'
				])
			);
		},
		writeBackup(changes, rollbackByBinding) {
			mkdirSync(BACKUP_DIRECTORY, { recursive: true });
			const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
			const files = [join(BACKUP_DIRECTORY, `supabase-images-${stamp}.json`)];
			writeFileSync(files[0], JSON.stringify(changes, null, 2), { mode: 0o600, flag: 'wx' });
			for (const [binding, sql] of Object.entries(rollbackByBinding)) {
				const file = join(BACKUP_DIRECTORY, `supabase-images-${stamp}-${binding}.rollback.sql`);
				writeFileSync(file, `${sql}\n`, { mode: 0o600, flag: 'wx' });
				files.push(file);
			}
			return files;
		}
	};
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const result = await migrate(args, realDeps(args));
	console.log(formatReport(result, args));
	if (result.applied && result.remaining > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
