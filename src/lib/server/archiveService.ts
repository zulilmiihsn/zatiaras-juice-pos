import { createHash } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from '$lib/server/branchResolver';

export const ARCHIVE_LEASE_MS = 10 * 60 * 1000;

export type ArchiveJobStatus =
	'claimed' | 'uploading' | 'finalizing' | 'completed' | 'failed' | 'orphan';

export interface ArchiveJob {
	id: string;
	cabang_id: string;
	before_year: number;
	cutoff: string;
	status: string;
	owner_token: string;
	lease_expires_at: number;
	object_key?: string | null;
	checksum?: string | null;
	counts?: string | null;
}

export function cutoffForYear(year: number): { cutoffWita: Date; cutoff: string } {
	const cutoffWita = new Date(`${year}-01-01T00:00:00+08:00`);
	return { cutoffWita, cutoff: cutoffWita.toISOString() };
}

function singleChange(result: unknown): number {
	const r = result as { changes?: number; meta?: { changes?: number } } | null;
	if (!r || typeof r !== 'object') return 0;
	if (typeof r.changes === 'number') return r.changes;
	return typeof r.meta?.changes === 'number' ? r.meta.changes : 0;
}

export function sha256Hex(content: string | Uint8Array): string {
	const h = createHash('sha256');
	h.update(typeof content === 'string' ? content : Buffer.from(content));
	return h.digest('hex');
}

export function verifyReadbackBytes(
	uploaded: Uint8Array | string,
	readback: Uint8Array | string | null
): void {
	if (!readback)
		throw new Error('Verifikasi integritas arsip gagal: objek tidak dapat dibaca kembali');
	const a = typeof uploaded === 'string' ? uploaded : Buffer.from(uploaded).toString('binary');
	const b = typeof readback === 'string' ? readback : Buffer.from(readback).toString('binary');
	if (a.length !== b.length) throw new Error('Verifikasi integritas arsip gagal: ukuran berubah');
	if (sha256Hex(uploaded) !== sha256Hex(readback))
		throw new Error('Verifikasi integritas arsip gagal: checksum body berbeda');
}

export async function acquireArchiveJob(
	rawDb: D1Database,
	branch: BranchId,
	year: number,
	cutoff: string,
	ttlMs: number = ARCHIVE_LEASE_MS
): Promise<ArchiveJob> {
	const now = Date.now();
	const jobId = crypto.randomUUID();
	const owner = crypto.randomUUID();
	try {
		const r = (await rawDb
			.prepare(
				`INSERT INTO archive_jobs (id, cabang_id, before_year, cutoff, status, owner_token, lease_expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?)`
			)
			.bind(
				jobId,
				branch,
				year,
				cutoff,
				owner,
				now + ttlMs,
				new Date().toISOString(),
				new Date().toISOString()
			)
			.run()) as unknown;
		if (singleChange(r) === 1) {
			const job = (await rawDb
				.prepare(`SELECT * FROM archive_jobs WHERE id = ?`)
				.bind(jobId)
				.first()) as unknown as ArchiveJob;
			return job;
		}
	} catch {
		// unique aktif -> jatuh ke pemeriksaan lease
	}
	const active = (await rawDb
		.prepare(
			`SELECT * FROM archive_jobs WHERE cabang_id = ? AND status IN ('claimed','uploading','finalizing') LIMIT 1`
		)
		.bind(branch)
		.first()) as unknown as ArchiveJob | null;
	if (!active) throw new Error('Klaim arsip gagal tanpa job aktif');
	if (active.lease_expires_at > now) {
		const err = new Error(
			'Proses pengarsipan sedang berjalan untuk cabang ini. Coba lagi nanti.'
		) as Error & {
			code?: string;
		};
		err.code = 'ARCHIVE_LOCKED';
		throw err;
	}
	// Lease habis: tandai lama gagal (hanya bila owner masih sama = worker baru menang),
	// lalu buat job baru. Worker lama yang masih jalan gagal klaim berikutnya.
	await rawDb
		.prepare(
			`UPDATE archive_jobs SET status = 'failed', updated_at = ? WHERE id = ? AND owner_token = ? AND status IN ('claimed','uploading','finalizing')`
		)
		.bind(new Date().toISOString(), active.id, active.owner_token)
		.run();
	const retryId = crypto.randomUUID();
	const retryOwner = crypto.randomUUID();
	await rawDb
		.prepare(
			`INSERT INTO archive_jobs (id, cabang_id, before_year, cutoff, status, owner_token, lease_expires_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?)`
		)
		.bind(
			retryId,
			branch,
			year,
			cutoff,
			retryOwner,
			now + ttlMs,
			new Date().toISOString(),
			new Date().toISOString()
		)
		.run();
	const job = (await rawDb
		.prepare(`SELECT * FROM archive_jobs WHERE id = ?`)
		.bind(retryId)
		.first()) as unknown as ArchiveJob;
	return job;
}

export async function getCompletedJobForYear(
	rawDb: D1Database,
	branch: string,
	year: number
): Promise<ArchiveJob | null> {
	return (await rawDb
		.prepare(
			`SELECT * FROM archive_jobs WHERE cabang_id = ? AND before_year = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 1`
		)
		.bind(branch, year)
		.first()) as unknown as ArchiveJob | null;
}

export async function setJobStatus(
	rawDb: D1Database,
	jobId: string,
	owner: string,
	status: ArchiveJobStatus,
	extra: { object_key?: string; checksum?: string; counts?: string } = {}
): Promise<boolean> {
	const r = (await rawDb
		.prepare(
			`UPDATE archive_jobs SET status = ?, object_key = COALESCE(?, object_key), checksum = COALESCE(?, checksum), counts = COALESCE(?, counts), updated_at = ?
			 WHERE id = ? AND owner_token = ? AND status IN ('claimed','uploading','finalizing')`
		)
		.bind(
			status,
			extra.object_key ?? null,
			extra.checksum ?? null,
			extra.counts ?? null,
			new Date().toISOString(),
			jobId,
			owner
		)
		.run()) as unknown;
	return singleChange(r) === 1;
}

export async function sealManifestItems(
	rawDb: D1Database,
	jobId: string,
	branch: string,
	rows: Array<{ id: string; transaction_id?: string | null; revision?: number | null }>
): Promise<void> {
	const stmts = rows.map((r) =>
		rawDb
			.prepare(
				`INSERT OR IGNORE INTO archive_job_items (job_id, cabang_id, buku_kas_id, transaction_id, revision)
				 VALUES (?, ?, ?, ?, ?)`
			)
			.bind(
				jobId,
				branch,
				String(r.id),
				r.transaction_id ? String(r.transaction_id) : null,
				Number(r.revision ?? 0)
			)
	);
	for (let i = 0; i < stmts.length; i += 50) {
		const chunk = stmts.slice(i, i + 50);
		if (chunk.length) await rawDb.batch(chunk);
	}
}

export function deterministicSummaryId(
	jobId: string,
	tanggal: string,
	tipe: string,
	jenis: string,
	metode: string | null
): string {
	return `${jobId}:${tanggal}:${tipe}:${jenis}:${metode ?? 'none'}`;
}

/**
 * Fragmen guard: seluruh manifest job masih ada dengan revision sama.
 * Precondition klaim finalisasi saja, sebelum row dihapus. Argumen: (cabang, jobId).
 */
export function manifestIntactSql(): string {
	return `NOT EXISTS (SELECT 1 FROM archive_job_items m LEFT JOIN buku_kas b ON b.cabang_id = m.cabang_id AND b.id = m.buku_kas_id WHERE m.cabang_id = ? AND m.job_id = ? AND (b.id IS NULL OR b.revision != m.revision))`;
}

export async function countEligibleRows(
	rawDb: D1Database,
	branch: string,
	cutoff: string
): Promise<number> {
	const row = (await rawDb
		.prepare(`SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = ? AND waktu < ?`)
		.bind(branch, cutoff)
		.first()) as { n?: number } | null;
	return Number(row?.n || 0);
}
