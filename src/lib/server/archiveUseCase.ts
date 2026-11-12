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

interface ArchivePreview {
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

async function previewArchiveCounts(
	rawDb: D1Database,
	branch: BranchContext,
	cutoff: string,
	start?: string
) {
	const timeBound = start
		? 'julianday(waktu) < julianday(?) AND julianday(waktu) >= julianday(?)'
		: 'waktu < ?';
	const joinedTimeBound = start
		? 'julianday(bk.waktu) < julianday(?) AND julianday(bk.waktu) >= julianday(?)'
		: 'bk.waktu < ?';
	const bounds = start ? [branch, cutoff, start] : [branch, cutoff];
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
				 WHERE cabang_id = ? AND ${timeBound}`
			)
			.bind(...bounds)
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
				 WHERE tk.cabang_id = ? AND ${joinedTimeBound}`
			)
			.bind(...bounds)
			.first() as Promise<{ count?: number } | null>,
		rawDb
			.prepare(
				`SELECT COUNT(*) as count FROM buku_kas
				 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending' AND ${timeBound}`
			)
			.bind(...bounds)
			.first()
			.catch(() => null) as Promise<{ count?: number } | null>
	]);

	return {
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

/** Preview arsip tanpa mutasi. */
export async function previewArchive(
	rawDb: D1Database,
	branch: BranchContext,
	year: number
): Promise<ArchivePreview> {
	validateArchiveYear(year);
	const { cutoff } = cutoffForYear(year);
	return {
		branch,
		before_year: year,
		cutoff_wita: cutoff,
		...(await previewArchiveCounts(rawDb, branch, cutoff))
	};
}

function archiveDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
		throw new ArchiveUseCaseError(400, 'Tanggal arsip tidak valid');
	const [year, month, day] = value.split('-').map(Number);
	if (year < 2020 || year > 2100) throw new ArchiveUseCaseError(400, 'Tanggal arsip tidak valid');
	const utc = new Date(Date.UTC(year, month - 1, day));
	if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day)
		throw new ArchiveUseCaseError(400, 'Tanggal arsip tidak valid');
	return utc;
}

export interface ArchiveDateRange {
	from: string;
	through: string;
}

function rangeBounds(range: ArchiveDateRange) {
	const first = archiveDate(range.from),
		last = archiveDate(range.through);
	if (first > last)
		throw new ArchiveUseCaseError(400, 'Tanggal awal harus sebelum atau sama dengan tanggal akhir');
	return {
		start: new Date(first.getTime() - 8 * 60 * 60 * 1000).toISOString(),
		cutoff: new Date(last.getTime() + 16 * 60 * 60 * 1000).toISOString()
	};
}

/** Inclusive WITA dates represented by a half-open UTC interval. */
export async function previewArchiveRange(
	rawDb: D1Database,
	branch: BranchContext,
	from: string,
	through: string
) {
	const { start, cutoff } = rangeBounds({ from, through });
	return { branch, from, through, ...(await previewArchiveCounts(rawDb, branch, cutoff, start)) };
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
	options?: { chunkHeaders?: number; maxChunks?: number; range?: ArchiveDateRange }
): Promise<ArchiveResult> {
	validateArchiveYear(year);
	const bounds = options?.range ? rangeBounds(options.range) : cutoffForYear(year);
	const { cutoff } = bounds;
	const start = 'start' in bounds ? bounds.start : undefined;
	const cutoffWita = new Date(cutoff);
	const empty = async (): Promise<ArchiveResult> => {
		if (!options?.range) return resumedOrEmpty(rawDb, branch, year);
		const jobs = await rawDb
			.prepare(
				`SELECT id, object_key, checksum, counts FROM archive_jobs WHERE cabang_id = ? AND status = 'completed' AND json_valid(counts) AND json_extract(counts, '$.range.from') = ? AND json_extract(counts, '$.range.through') = ? ORDER BY created_at, id`
			)
			.bind(branch, options.range.from, options.range.through)
			.all<{ id: string; object_key: string; checksum: string; counts: string }>();
		const parts = jobs.results.map((job) => {
			const counts = JSON.parse(job.counts) as {
				total: number;
				buku_kas: number;
				transaksi_kasir: number;
			};
			return {
				jobId: job.id,
				key: job.object_key,
				filename: job.object_key.split('/').pop()!,
				checksum: job.checksum,
				count: counts.total,
				counts: { buku_kas: counts.buku_kas, transaksi_kasir: counts.transaksi_kasir }
			};
		});
		if (!parts.length)
			return { kind: 'empty', message: 'Tidak ada transaksi aktif dalam rentang tanggal ini.' };
		return {
			kind: 'completed',
			parts,
			count: parts.reduce((n, p) => n + p.count, 0),
			key: parts[0].key,
			filename: parts[0].filename,
			counts: {
				buku_kas: parts.reduce((n, p) => n + p.counts.buku_kas, 0),
				transaksi_kasir: parts.reduce((n, p) => n + p.counts.transaksi_kasir, 0)
			}
		};
	};
	if (!bucket) throw new ArchiveUseCaseError(503, 'Storage tidak tersedia');

	// Eligible recount dulu: resume hanya bila tak ada row baru.
	const eligible = await countEligibleRows(rawDb, branch, cutoff, start);
	if (eligible === 0) return empty();

	const { chunkHeaders, maxChunks } = resolveChunkLimits(options);
	const { parts, exhausted, interrupted } = await runChunks(
		{ rawDb, bucket, branch, year, cutoff, cutoffWita, start, range: options?.range },
		chunkHeaders,
		maxChunks
	);
	if (parts.length === 0) return empty();

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
	const remaining = exhausted ? 0 : await countEligibleRows(rawDb, branch, cutoff, start);
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

export function previewArchiveRangeForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	from: string,
	through: string
) {
	return previewArchiveRange(getRawDb(platform, branch), branch, from, through);
}

export function runArchiveForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	year: number,
	range?: ArchiveDateRange
) {
	const bucket = platform?.env?.STORAGE as ArchiveBucket | undefined;
	return runArchive(getRawDb(platform, branch), bucket, branch, year, { range });
}

interface ArchiveDownload {
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
