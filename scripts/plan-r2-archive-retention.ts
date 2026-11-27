#!/usr/bin/env node
/** Offline archive retention evidence. No storage client and no delete operation. */
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BranchId } from '../src/lib/server/branchResolver';
import { isBranchStorageKey } from '../src/lib/server/branchStoragePolicy';
import { ARCHIVE_CHUNK_MAX_BYTES } from '../src/lib/server/archiveChunkReader';
import { canonicalizeExternalPath } from './external-backup-path.mjs';
import { validateArchive } from './restore-archive-lib.mjs';

const HOUR = 3600_000;
const AGE_MS = 24 * HOUR;
const PROOF = 'archive-retention-proof.json';
const SCHEMA = 'zatiaraspos-r2-archive-retention-v1';
const BUCKET = 'zatiaras-assets';
const branches: BranchId[] = ['samarinda', 'balikpapan', 'berau'];
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const record = (x: unknown): x is Record<string, unknown> =>
	x !== null && typeof x === 'object' && !Array.isArray(x);

async function regularFile(path: string) {
	const status = await lstat(path);
	if (!status.isFile() || status.isSymbolicLink())
		throw new Error('Manifest, bukti, dan salinan harus file reguler');
	return status;
}
function parsePrivateJson(bytes: Buffer, label: string): unknown {
	try {
		return JSON.parse(bytes.toString('utf8'));
	} catch {
		// A parse error can include text from the private backup.
		throw new Error(`${label}: JSON tidak valid`);
	}
}

async function inspectBackup(source: string) {
	if (basename(source) !== 'manifest.r2.json')
		throw new Error('Wajib memakai manifest.r2.json dari backup R2');
	await regularFile(source);
	const manifestPath = await canonicalizeExternalPath(source, { mustExist: true });
	const dir = dirname(manifestPath);
	await regularFile(join(dir, 'COMPLETE'));
	const failed = await lstat(join(dir, 'FAILED.json')).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error;
		return null;
	});
	if (failed) throw new Error('Backup bertanda FAILED tidak berlaku');
	const bytes = await readFile(manifestPath);
	const manifest = parsePrivateJson(bytes, 'Manifest');
	if (
		!record(manifest) ||
		manifest.schema !== 'zatiaraspos-r2-backup-v1' ||
		manifest.bucket !== BUCKET ||
		typeof manifest.captured_at !== 'string' ||
		!Number.isFinite(Date.parse(manifest.captured_at)) ||
		!Array.isArray(manifest.objects)
	)
		throw new Error('Identitas manifest backup R2 tidak cocok');

	const objects: {
		key: string;
		branch: BranchId;
		archiveId: string;
		sha256: string;
		size: number;
		file: string;
	}[] = [];
	const seen = new Set<string>();
	const files = new Set<string>();
	for (const item of manifest.objects as unknown[]) {
		if (!record(item) || typeof item.key !== 'string' || seen.has(item.key))
			throw new Error('Key backup kosong atau duplikat');
		seen.add(item.key);
		if (!item.key.startsWith('arsip/')) continue;
		const key = item.key;
		const branch = branches.find((value) => key.startsWith(`arsip/${value}/`));
		const { file, size, sha256: expected } = item;
		if (
			!branch ||
			!isBranchStorageKey(branch, key) ||
			typeof file !== 'string' ||
			!/^\d{3,8}\.bin$/.test(file) ||
			files.has(file) ||
			typeof size !== 'number' ||
			!Number.isSafeInteger(size) ||
			size <= 0 ||
			size > ARCHIVE_CHUNK_MAX_BYTES ||
			typeof expected !== 'string' ||
			!/^[a-f0-9]{64}$/.test(expected)
		)
			throw new Error('Metadata salinan arsip tidak valid');
		files.add(file);
		const path = join(dir, file);
		if ((await regularFile(path)).size !== size) throw new Error('Ukuran salinan arsip berbeda');
		const body = await readFile(path);
		if (body.length !== size || sha256(body) !== expected)
			throw new Error('Checksum salinan arsip berbeda');
		const archive = parsePrivateJson(body, 'Salinan arsip');
		if (!record(archive) || !record(archive.meta)) throw new Error('Salinan bukan arsip transaksi');
		const archiveId = archive.meta.archive_id ?? archive.meta.id;
		const name = key
			.split('/')
			.at(-1)
			?.replace(/(?:\.part-\d{4,})?\.json$/, '');
		if (
			typeof archiveId !== 'string' ||
			!name?.endsWith(`-${archiveId.slice(0, 8)}`) ||
			archive.meta.branch !== branch ||
			!validateArchive(archive as Parameters<typeof validateArchive>[0]).ok
		)
			throw new Error(
				'Salinan tidak cocok dengan identitas arsip atau tidak lolos validasi restore'
			);
		objects.push({ key, branch, archiveId, sha256: expected, size, file });
	}
	return {
		dir,
		manifestSha256: sha256(bytes),
		capturedAt: Date.parse(manifest.captured_at),
		objects
	};
}

export async function verifyArchiveCopy(source: string, now = Date.now()) {
	const backup = await inspectBackup(source);
	if (!Number.isSafeInteger(now) || now < backup.capturedAt || backup.objects.length === 0)
		throw new Error('Waktu backup belum valid atau tidak ada salinan arsip');
	const proof = {
		schema: SCHEMA,
		manifest_sha256: backup.manifestSha256,
		verified_at: now,
		objects: backup.objects
	};
	const path = join(backup.dir, PROOF);
	// Re-running verification must not replace the first proof or silently reset the 24h clock.
	await writeFile(path, JSON.stringify(proof, null, 2) + '\n', {
		flag: 'wx',
		mode: 0o600,
		flush: true
	});
	return {
		path,
		verified: backup.objects.length,
		reviewedAfter: new Date(now + AGE_MS).toISOString()
	};
}

export async function previewArchiveRetention(source: string, now = Date.now()) {
	const backup = await inspectBackup(source);
	const proofPath = join(backup.dir, PROOF);
	await regularFile(proofPath);
	const proof = parsePrivateJson(await readFile(proofPath), 'Bukti');
	if (
		!Number.isSafeInteger(now) ||
		!record(proof) ||
		proof.schema !== SCHEMA ||
		proof.manifest_sha256 !== backup.manifestSha256 ||
		typeof proof.verified_at !== 'number' ||
		!Number.isSafeInteger(proof.verified_at) ||
		proof.verified_at < backup.capturedAt ||
		proof.verified_at > now ||
		JSON.stringify(proof.objects) !== JSON.stringify(backup.objects)
	)
		throw new Error('Bukti verifikasi tidak cocok dengan backup');
	const reviewedAfter = proof.verified_at + AGE_MS;
	return {
		reviewedAfter: new Date(reviewedAfter).toISOString(),
		readyForReview: now >= reviewedAfter,
		branches: branches.map((branch) => ({
			branch,
			archives: backup.objects.filter((object) => object.branch === branch).length
		}))
	};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	try {
		const [action, manifest, ...extra] = process.argv.slice(2);
		if (!['verify', 'preview'].includes(action) || !manifest || extra.length)
			throw new Error('Gunakan verify|preview <manifest.r2.json>. Tidak ada perintah hapus.');
		console.log(
			JSON.stringify(
				action === 'verify'
					? await verifyArchiveCopy(manifest)
					: await previewArchiveRetention(manifest),
				null,
				2
			)
		);
		console.log(
			'Tidak ada data Cloudflare yang diubah. Hasil preview hanya untuk review operator.'
		);
	} catch (error) {
		console.error(
			`Pemeriksaan retensi arsip gagal: ${error instanceof Error ? error.message : 'hasil tidak terverifikasi'}`
		);
		process.exitCode = 1;
	}
}
