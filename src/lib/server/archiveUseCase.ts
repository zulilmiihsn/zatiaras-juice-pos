/**
 * Archive use case — orkestrasi pengarsipan transaksi lama.
 *
 * Route (`src/routes/api/archive/+server.ts`) hanya: auth, parsing, panggil
 * fungsi di sini, petakan hasil/error ke HTTP. Seluruh SQL, klaim atomik,
 * snapshot R2, readback, summary, dan finalisasi tinggal di sini; kontrak isi
 * snapshot ada di archiveSnapshot.ts.
 *
 * Tidak import SvelteKit. Error domain memakai ArchiveUseCaseError yang
 * membawa status HTTP; route memetakan ke kitError/json.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import { getRawDb } from './dataApiHelpers';
import { countEligibleRows, cutoffForYear, getCompletedJobForYear } from './archiveService';
import { ArchiveUseCaseError } from './archiveSnapshot';
import {
	ARCHIVE_CHUNK_HEADERS,
	ARCHIVE_MAX_CHUNKS_PER_CALL,
	type ArchiveChunkCursor
} from './archiveChunkReader';
import {
	runArchiveChunkJob,
	type ArchiveBucket,
	type ArchiveChunkContext,
	type ArchiveChunkOutcome,
	type ArchivePart
} from './archiveChunkJob';

export { ArchiveUseCaseError };
export {
	ARCHIVE_CHUNK_HEADERS,
	ARCHIVE_CHUNK_MAX_BYTES,
	ARCHIVE_MAX_CHUNKS_PER_CALL,
	type ArchiveChunkCursor
} from './archiveChunkReader';
export type { ArchiveBucket, ArchivePart } from './archiveChunkJob';

export interface ArchivePreview {
	branch: string;
	before_year: number;
	cutoff_wita: string;
	counts: { buku_kas: number; pos: number; manual: number; transaksi_kasir: number };
	financials: { total_in: number; total_out: number };
	pending_orders: number;
}

export function validateArchiveYear(year: number): void {
	if (!Number.isInteger(year) || year < 2020 || year > 2100) {
		throw new ArchiveUseCaseError(400, 'Tahun tidak valid');
	}
}

/** Preview arsip tanpa mutasi. */
export async function previewArchive(
	rawDb: D1Database,
	branch: BranchContext,
	year: number
): Promise<ArchivePreview> {
	validateArchiveYear(year);
	const { cutoff } = cutoffForYear(year);

	const [bukuKasStats, transaksiCount, pendingOrders] = await Promise.all([
		rawDb
			.prepare(
				`SELECT
					COUNT(*) as total_rows,
					SUM(CASE WHEN sumber = 'pos' THEN 1 ELSE 0 END) as pos_count,
					SUM(CASE WHEN sumber != 'pos' THEN 1 ELSE 0 END) as manual_count,
					SUM(CASE WHEN tipe = 'in' THEN nominal ELSE 0 END) as total_in,
					SUM(CASE WHEN tipe = 'out' THEN nominal ELSE 0 END) as total_out
				 FROM buku_kas
				 WHERE cabang_id = ? AND waktu < ?`
			)
			.bind(branch, cutoff)
			.first() as Promise<{
			total_rows?: number;
			pos_count?: number;
			manual_count?: number;
			total_in?: number;
			total_out?: number;
		} | null>,
		rawDb
			.prepare(
				`SELECT COUNT(*) as count
				 FROM transaksi_kasir tk
				 INNER JOIN buku_kas bk ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
				 WHERE tk.cabang_id = ? AND bk.waktu < ?`
			)
			.bind(branch, cutoff)
			.first() as Promise<{ count?: number } | null>,
		rawDb
			.prepare(
				`SELECT COUNT(*) as count FROM buku_kas
				 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending' AND waktu < ?`
			)
			.bind(branch, cutoff)
			.first()
			.catch(() => null) as Promise<{ count?: number } | null>
	]);

	return {
		branch,
		before_year: year,
		cutoff_wita: cutoffForYear(year).cutoffWita.toISOString(),
		counts: {
			buku_kas: bukuKasStats?.total_rows || 0,
			pos: bukuKasStats?.pos_count || 0,
			manual: bukuKasStats?.manual_count || 0,
			transaksi_kasir: transaksiCount?.count || 0
		},
		financials: {
			total_in: bukuKasStats?.total_in || 0,
			total_out: bukuKasStats?.total_out || 0
		},
		pending_orders: Number(pendingOrders?.count ?? 0)
	};
}

export type ArchiveResult =
	| { kind: 'empty'; message: string }
	| {
			kind: 'resumed';
			count: number;
			key: string;
			message: string;
			filename?: string;
			job_id?: string;
	  }
	| {
			kind: 'completed';
			count: number;
			key: string;
			filename: string;
			counts: { buku_kas: number; transaksi_kasir: number };
			parts: ArchivePart[];
			job_id?: string;
	  }
	| {
			kind: 'partial';
			count: number;
			parts: ArchivePart[];
			remaining: number;
			message: string;
			/** Alasan chunk berikutnya gagal setelah bagian lain commit. */
			interrupted?: string;
	  };

/** Resume arsip selesai sebelumnya (job completed / pointer legacy). */
async function findResumedArchive(
	rawDb: D1Database,
	branch: BranchContext,
	year: number
): Promise<Extract<ArchiveResult, { kind: 'resumed' }> | null> {
	const completed = await getCompletedJobForYear(rawDb, branch, year).catch(() => null);
	if (completed?.object_key) {
		let count = 0;
		try {
			count = Number((JSON.parse(completed.counts || '{}') as { total?: number }).total || 0);
		} catch {
			throw new ArchiveUseCaseError(
				500,
				'Metadata jumlah arsip tersimpan rusak; resume dibatalkan.'
			);
		}
		return {
			kind: 'resumed',
			count,
			key: completed.object_key,
			job_id: completed.id,
			message: `Arsip tahun ${year} telah selesai diproses sebelumnya (snapshot di-resume).`
		};
	}
	const legacyCompleted = (await rawDb
		.prepare(`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = ? LIMIT 1`)
		.bind(branch, `archive_job_${year}`)
		.first()
		.catch(() => null)) as { nilai?: string } | null;
	if (legacyCompleted?.nilai) {
		try {
			const parsed = JSON.parse(legacyCompleted.nilai) as {
				id?: string;
				status?: string;
				key?: string;
				count?: number;
				filename?: string;
			};
			if (parsed.status === 'completed' && parsed.key) {
				return {
					kind: 'resumed',
					count: parsed.count || 0,
					key: parsed.key,
					filename: parsed.filename,
					...(parsed.id ? { job_id: parsed.id } : {}),
					message: `Arsip tahun ${year} telah selesai diproses sebelumnya (snapshot di-resume).`
				};
			}
		} catch {
			throw new ArchiveUseCaseError(
				500,
				'Metadata arsip lama rusak; status tidak dapat dipastikan.'
			);
		}
	}
	return null;
}

async function resumedOrEmpty(
	rawDb: D1Database,
	branch: BranchContext,
	year: number
): Promise<ArchiveResult> {
	const resumed = await findResumedArchive(rawDb, branch, year);
	if (resumed) return resumed;
	return {
		kind: 'empty',
		message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
	};
}

function resolveChunkLimits(options?: { chunkHeaders?: number; maxChunks?: number }) {
	const chunkHeaders = options?.chunkHeaders ?? ARCHIVE_CHUNK_HEADERS;
	const maxChunks = options?.maxChunks ?? ARCHIVE_MAX_CHUNKS_PER_CALL;
	if (
		!Number.isInteger(chunkHeaders) ||
		chunkHeaders < 1 ||
		chunkHeaders > ARCHIVE_CHUNK_HEADERS ||
		!Number.isInteger(maxChunks) ||
		maxChunks < 1 ||
		maxChunks > ARCHIVE_MAX_CHUNKS_PER_CALL
	) {
		throw new ArchiveUseCaseError(400, 'Batas chunk arsip tidak valid');
	}
	return { chunkHeaders, maxChunks };
}

/**
 * Driver chunk. Tiap chunk = satu job (klaim, snapshot satu objek R2, readback, finalisasi
 * atomik). Recall melanjutkan otomatis karena row terarsip hilang dari eligibility.
 * Dibatasi per panggilan agar invocasi worker tetap bounded; sisa dilaporkan via 'partial'.
 */
async function runChunks(
	ctx: ArchiveChunkContext,
	chunkHeaders: number,
	maxChunks: number
): Promise<{ parts: ArchivePart[]; exhausted: boolean; interrupted: string | null }> {
	const parts: ArchivePart[] = [];
	let cursor: ArchiveChunkCursor | null = null;
	let exhausted = false;
	let interrupted: string | null = null;
	for (let chunk = 0; chunk < maxChunks; chunk++) {
		let result: ArchiveChunkOutcome;
		try {
			// Bagian pertama tanpa akhiran nomor; berikutnya 1, 2, …
			result = await runArchiveChunkJob(
				ctx,
				cursor,
				parts.length === 0 ? null : parts.length,
				chunkHeaders
			);
		} catch (error) {
			// Bagian yang sudah commit di panggilan ini tetap dilaporkan (dihitung +
			// diunduh klien) beserta alasan berhenti; klien berhenti, bukan langsung ulang.
			if (parts.length === 0) throw error;
			if (error instanceof ArchiveUseCaseError) {
				interrupted = error.message;
			} else {
				console.error('[archive] chunk gagal setelah bagian lain commit', error);
				interrupted = 'Kesalahan internal saat memproses bagian berikutnya.';
			}
			break;
		}
		if (result.empty) {
			exhausted = true;
			break;
		}
		parts.push(result.part);
		if (!result.hasMore) {
			exhausted = true;
			break;
		}
		cursor = result.nextCursor;
	}
	return { parts, exhausted, interrupted };
}

/**
 * Jalankan pengarsipan penuh milik cabang aktif.
 * Klaim job atomik per cabang; snapshot R2 dulu, hapus exact ID dalam batch
 * atomik di bawah klaim finalisasi. Ledger tidak pernah terhapus tanpa
 * snapshot terverifikasi.
 */
export async function runArchive(
	rawDb: D1Database,
	bucket: ArchiveBucket | undefined,
	branch: BranchContext,
	year: number,
	options?: { chunkHeaders?: number; maxChunks?: number }
): Promise<ArchiveResult> {
	validateArchiveYear(year);
	const { cutoffWita, cutoff } = cutoffForYear(year);
	if (!bucket) throw new ArchiveUseCaseError(503, 'Storage tidak tersedia');

	// Eligible recount dulu: resume hanya bila tak ada row baru.
	const eligible = await countEligibleRows(rawDb, branch, cutoff);
	if (eligible === 0) return resumedOrEmpty(rawDb, branch, year);

	const { chunkHeaders, maxChunks } = resolveChunkLimits(options);
	const { parts, exhausted, interrupted } = await runChunks(
		{ rawDb, bucket, branch, year, cutoff, cutoffWita },
		chunkHeaders,
		maxChunks
	);
	if (parts.length === 0) return resumedOrEmpty(rawDb, branch, year);

	const archivedCount = parts.reduce((sum, part) => sum + part.count, 0);
	if (parts.length === 1 && exhausted) {
		const [only] = parts;
		return {
			kind: 'completed',
			count: archivedCount,
			key: only.key,
			filename: only.filename,
			counts: only.counts,
			parts,
			job_id: only.jobId
		};
	}
	// Cap tercapai tanpa tanda habis = recount jujur; 0 = selesai.
	const remaining = exhausted ? 0 : await countEligibleRows(rawDb, branch, cutoff);
	// Interupsi selalu dilaporkan, walau recount 0 (mis. baris chunk gagal di-void).
	if (remaining > 0 || interrupted) {
		return {
			kind: 'partial',
			count: archivedCount,
			parts,
			remaining,
			message: `Terarsip ${archivedCount} baris dalam ${parts.length} bagian; tersisa ${remaining} baris. ${interrupted ? `Bagian berikutnya gagal: ${interrupted} ` : ''}Panggil lagi untuk melanjutkan.`,
			...(interrupted ? { interrupted } : {})
		};
	}
	const last = parts[parts.length - 1];
	return {
		kind: 'completed',
		count: archivedCount,
		key: last.key,
		filename: last.filename,
		counts: {
			buku_kas: parts.reduce((sum, part) => sum + part.counts.buku_kas, 0),
			transaksi_kasir: parts.reduce((sum, part) => sum + part.counts.transaksi_kasir, 0)
		},
		parts
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function previewArchiveForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	year: number
) {
	return previewArchive(getRawDb(platform, branch), branch, year);
}

export function runArchiveForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	year: number
) {
	const bucket = platform?.env?.STORAGE as ArchiveBucket | undefined;
	return runArchive(getRawDb(platform, branch), bucket, branch, year);
}

export interface ArchiveDownload {
	body: ReadableStream<Uint8Array>;
	filename: string;
	checksum: string | null;
	jobId: string;
}

export async function downloadArchiveForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	jobId: string
): Promise<ArchiveDownload> {
	const rawDb = getRawDb(platform, branch);
	const job = (await rawDb
		.prepare(
			`SELECT id, object_key, checksum, counts FROM archive_jobs
			 WHERE id = ? AND cabang_id = ? AND status = 'completed' LIMIT 1`
		)
		.bind(jobId, branch)
		.first()
		.catch(() => null)) as {
		id?: string;
		object_key?: string | null;
		checksum?: string | null;
		counts?: string | null;
	} | null;

	if (!job?.object_key) {
		throw new ArchiveUseCaseError(404, 'Arsip tidak ditemukan untuk cabang ini');
	}

	const bucket = platform?.env?.STORAGE as ArchiveBucket | undefined;
	if (!bucket) {
		throw new ArchiveUseCaseError(503, 'Storage tidak tersedia');
	}
	const object = await bucket.get(job.object_key).catch(() => null);
	if (!object?.body) {
		throw new ArchiveUseCaseError(502, 'File arsip di cloud tidak dapat dibaca. Coba lagi.');
	}

	let filename = `arsip-${branch}.json`;
	const keyBase = job.object_key.split('/').pop() || filename;
	if (/^[A-Za-z0-9._-]+\.json$/.test(keyBase)) filename = keyBase;

	return {
		// Pass the R2 stream through: backpressure/cancellation stay with the HTTP consumer.
		body: object.body,
		filename,
		checksum: job.checksum ?? null,
		jobId: job.id || jobId
	};
}
