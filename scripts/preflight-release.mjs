#!/usr/bin/env node
/**
 * Release preflight + artifact provenance untuk ZatiarasPOS.
 *
 * Mode:
 *   node scripts/preflight-release.mjs                 full gate (default, operator)
 *   node scripts/preflight-release.mjs --manifest-only  tulis manifest dari build yang ada (CI)
 *   node scripts/preflight-release.mjs --verify-only    verifikasi manifest tanpa mutasi (deploy)
 *
 * Full gate: git checks -> deploy:check -> test:release -> tulis manifest -> verifikasi.
 * Manifest-only: git checks -> tulis manifest dari ARTIFACT_ROOT yang ada -> verifikasi.
 * Verify-only: baca manifest -> verifikasi terhadap state saat ini.
 *
 * RELEASE_COMMIT_SHA wajib di semua mode. Tidak ada default diam-diam ke HEAD.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ARTIFACT_ROOT = '.svelte-kit/cloudflare';
export const RUNTIME_ROOTS = ['.svelte-kit/cloudflare-tmp', '.svelte-kit/output/server'];
export const MANIFEST_PATH = 'build-artifacts.json';
export const MANIFEST_SCHEMA = 2;
export const CONFIG_FILES = ['wrangler.jsonc', 'wrangler.pages.jsonc', 'wrangler.realtime.jsonc'];
export const MIGRATION_FILES = ['drizzle/meta/manifest.json', 'drizzle/meta/_journal.json'];
export const ALLOWED_BRANCHES = ['main'];
export const ALLOWED_BRANCH_PREFIXES = ['release/'];

export function run(cmd) {
	return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function sha256Hex(content) {
	return createHash('sha256').update(content).digest('hex');
}

export function sha256File(path) {
	return sha256Hex(readFileSync(path));
}

/** Daftar file relatif (separator `/`, terurut) di bawah root. Hanya file, bukan direktori. */
export function listFilesRecursive(root) {
	const out = [];
	const walk = (dir, prefix) => {
		for (const entry of readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name)
		)) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else if (entry.isFile()) out.push(rel);
		}
	};
	walk('.', '');
	return out.sort();
}

export function hashFiles(root) {
	const files = {};
	for (const rel of listFilesRecursive(root)) {
		files[rel] = sha256File(join(root, rel));
	}
	return files;
}

export function getHeadSha() {
	return run('git rev-parse HEAD');
}

export function getBranch() {
	try {
		return run('git branch --show-current');
	} catch {
		return '';
	}
}

export function isTreeClean() {
	return run('git status --porcelain').length === 0;
}

/** RELEASE_COMMIT_SHA wajib 40-hex. Jangan default ke HEAD. */
export function requireReleaseSha() {
	const sha = (process.env.RELEASE_COMMIT_SHA || '').trim().toLowerCase();
	if (!sha) {
		throw new Error(
			'RELEASE_COMMIT_SHA wajib diisi (full 40-char SHA). Menolak default diam-diam ke HEAD.'
		);
	}
	if (!/^[0-9a-f]{40}$/.test(sha)) {
		throw new Error(`RELEASE_COMMIT_SHA tidak valid: ${sha}`);
	}
	return sha;
}

function branchAllowed(branch) {
	if (!branch) return true; // detached HEAD (CI): SHA match sudah cukup
	if (ALLOWED_BRANCHES.includes(branch)) return true;
	return ALLOWED_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix));
}

/** Git provenance: tree bersih, SHA cocok HEAD, branch diizinkan. */
export function assertProvenance() {
	if (!isTreeClean()) {
		const status = run('git status --porcelain');
		throw new Error(`Working tree kotor. Commit/stash dahulu:\n${status}`);
	}
	const expected = requireReleaseSha();
	const head = getHeadSha().toLowerCase();
	if (expected !== head) {
		throw new Error(`RELEASE_COMMIT_SHA (${expected}) tidak sama dengan HEAD (${head}).`);
	}
	const branch = getBranch();
	if (!branchAllowed(branch)) {
		throw new Error(
			`Branch '${branch || '(detached)'}' tidak diizinkan untuk release (hanya ${[...ALLOWED_BRANCHES, ...ALLOWED_BRANCH_PREFIXES.map((p) => `${p}*`)].join(', ')}).`
		);
	}
	return { headSha: head, branch: branch || '(detached)' };
}

export function currentToolchain() {
	let pnpm = '';
	try {
		pnpm = run('pnpm --version');
	} catch {
		pnpm = 'unknown';
	}
	return { node: process.version, pnpm };
}

export function checksumFiles(paths) {
	const sums = {};
	for (const file of paths) {
		const full = resolve(file);
		if (!existsSync(full) || !statSync(full).isFile()) {
			throw new Error(`File wajib hilang: ${file}`);
		}
		sums[file] = sha256File(full);
	}
	return sums;
}

export function buildManifest({ headSha, branch }) {
	const files = hashFiles(resolve(ARTIFACT_ROOT));
	const fileNames = Object.keys(files);
	if (fileNames.length === 0) {
		throw new Error(`Artifact root kosong: ${ARTIFACT_ROOT}. Jalankan build dahulu.`);
	}
	if (fileNames.some((name) => name.includes('.env'))) {
		throw new Error('Artifact mengandung path .env. Hentikan release.');
	}
	const runtimeFiles = {};
	for (const root of RUNTIME_ROOTS) {
		if (!existsSync(resolve(root))) throw new Error(`Runtime root hilang: ${root}. Rebuild.`);
		const hashed = hashFiles(resolve(root));
		if (!Object.keys(hashed).length) throw new Error(`Runtime root kosong: ${root}. Rebuild.`);
		if (Object.keys(hashed).some((name) => name.includes('.env'))) {
			throw new Error('Runtime artifact mengandung path .env. Hentikan release.');
		}
		runtimeFiles[root] = hashed;
	}
	return {
		schema: MANIFEST_SCHEMA,
		commit_sha: headSha,
		branch,
		built_at: new Date().toISOString(),
		node_version: currentToolchain().node,
		pnpm_version: currentToolchain().pnpm,
		artifact_root: ARTIFACT_ROOT,
		config_checksums: checksumFiles(CONFIG_FILES),
		migration_checksums: checksumFiles(MIGRATION_FILES),
		file_count: fileNames.length,
		files,
		runtime_files: runtimeFiles
	};
}

export function writeManifest(manifest, path = MANIFEST_PATH) {
	writeFileSync(resolve(path), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function readManifest(path = MANIFEST_PATH) {
	const full = resolve(path);
	if (!existsSync(full)) {
		throw new Error(`Manifest hilang: ${path}. Release tidak boleh lanjut tanpa provenance.`);
	}
	return JSON.parse(readFileSync(full, 'utf8'));
}

/**
 * Verifikasi manifest terhadap state saat ini. Kembalikan array error (kosong = lulus).
 * Menolak: SHA beda, file hilang/berubah/tambahan, config/migrasi berubah, schema beda.
 */
export function verifyManifest(manifest, expectedSha) {
	const errors = [];
	if (!manifest || typeof manifest !== 'object') return ['Manifest bukan object JSON.'];
	if (manifest.schema !== MANIFEST_SCHEMA) {
		errors.push(`Schema manifest ${manifest.schema} != ${MANIFEST_SCHEMA}. Rebuild dari HEAD.`);
	}
	if (manifest.commit_sha !== expectedSha) {
		errors.push(`Manifest milik ${manifest.commit_sha}, ekspektasi ${expectedSha}.`);
	}
	if (manifest.artifact_root !== ARTIFACT_ROOT) {
		errors.push(`Artifact root manifest ${manifest.artifact_root} != ${ARTIFACT_ROOT}.`);
	}
	const manifestFiles = manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
	const currentFiles = existsSync(resolve(ARTIFACT_ROOT)) ? hashFiles(resolve(ARTIFACT_ROOT)) : {};
	for (const [rel, expected] of Object.entries(manifestFiles)) {
		if (!(rel in currentFiles)) errors.push(`File artifact hilang: ${rel}.`);
		else if (currentFiles[rel] !== expected) errors.push(`File artifact berubah: ${rel}.`);
	}
	for (const rel of Object.keys(currentFiles)) {
		if (!(rel in manifestFiles)) errors.push(`File artifact tak tercatat: ${rel}. Rebuild.`);
	}
	for (const root of RUNTIME_ROOTS) {
		const recorded = manifest.runtime_files?.[root];
		if (!recorded || !Object.keys(recorded).length) {
			errors.push(`Runtime root tak tercatat: ${root}.`);
			continue;
		}
		const current = existsSync(resolve(root)) ? hashFiles(resolve(root)) : {};
		for (const [rel, expected] of Object.entries(recorded)) {
			if (!(rel in current)) errors.push(`Runtime file hilang: ${root}/${rel}.`);
			else if (current[rel] !== expected) errors.push(`Runtime file berubah: ${root}/${rel}.`);
		}
		for (const rel of Object.keys(current)) {
			if (!(rel in recorded)) errors.push(`Runtime file tak tercatat: ${root}/${rel}.`);
		}
	}
	const checkGroup = (label, recorded, current) => {
		for (const [file, expected] of Object.entries(recorded || {})) {
			if (!(file in (current || {}))) errors.push(`${label} hilang: ${file}.`);
			else if (current[file] !== expected) errors.push(`${label} berubah: ${file}.`);
		}
	};
	try {
		checkGroup('Config', manifest.config_checksums, checksumFiles(CONFIG_FILES));
	} catch (error) {
		errors.push(String(error.message || error));
	}
	try {
		checkGroup('Migration', manifest.migration_checksums, checksumFiles(MIGRATION_FILES));
	} catch (error) {
		errors.push(String(error.message || error));
	}
	return errors;
}

function fail(errors) {
	for (const error of errors) console.error(`❌ ${error}`);
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	const manifestOnly = args.includes('--manifest-only');
	const verifyOnly = args.includes('--verify-only');
	console.log('🚀 Running ZatiarasPOS Release Preflight Automation...');

	try {
		if (verifyOnly) {
			const expected = requireReleaseSha();
			const errors = verifyManifest(readManifest(), expected);
			if (errors.length) fail(errors);
			console.log(`✅ Manifest valid untuk ${expected}. Artifact boleh dipromosikan.`);
			return;
		}

		const { headSha, branch } = assertProvenance();
		console.log(`✅ Provenance OK: ${headSha} @ ${branch}.`);

		if (!manifestOnly) {
			console.log('🔍 deploy:check...');
			execSync('pnpm deploy:check', { stdio: 'inherit' });
			console.log('🧪 Full release gate (test:all + build + e2e)...');
			execSync('pnpm test:release', { stdio: 'inherit' });
			console.log('✅ Full release gate lulus.');
		} else if (!existsSync(resolve(ARTIFACT_ROOT))) {
			throw new Error(`Artifact root hilang: ${ARTIFACT_ROOT}. Jalankan build dahulu.`);
		}

		const manifest = buildManifest({ headSha, branch });
		writeManifest(manifest);
		console.log(
			`✅ Manifest ditulis: ${manifest.file_count} file, SHA ${manifest.commit_sha.slice(0, 12)}.`
		);
		const errors = verifyManifest(readManifest(), headSha);
		if (errors.length) fail(errors);
		console.log('🎉 Release Preflight COMPLETE: kandidat siap untuk deploy.');
	} catch (error) {
		console.error('❌ Release Preflight encountered an error:', error.message);
		process.exit(1);
	}
}

const invokedAsMain =
	process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/preflight-release.mjs');
if (invokedAsMain) {
	await main();
}
