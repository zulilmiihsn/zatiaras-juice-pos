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
import {
	acquireArchiveJob,
	countEligibleRows,
	cutoffForYear,
	deterministicSummaryId,
	getCompletedJobForYear,
	manifestIntactSql,
	sealManifestItems,
	setJobStatus,
	verifyReadbackBytes
} from './archiveService';
import {
	ArchiveUseCaseError,
	type ArchiveRow,
	ARCHIVE_BUKU_KAS_FIELDS,
	ARCHIVE_TRANSAKSI_KASIR_FIELDS,
	buildArchiveSnapshot,
	summarizeManualRows
} from './archiveSnapshot';

export { ArchiveUseCaseError };

export interface ArchiveBucket {
	put(key: string, value: string, opts?: unknown): Promise<unknown>;
	get(
		key: string
	): Promise<null | { text: () => Promise<string>; body?: ReadableStream<Uint8Array> }>;
}

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

/**
 * Budget chunk arsip: maksimal 1000 header per
 * chunk, snapshot ≤2MB per objek R2, maksimal 3 chunk per panggilan Worker
 * (recall melanjutkan otomatis karena row terarsip hilang dari eligibility).
 * ID per chunk dikirim sebagai satu parameter JSON (json_each), jadi ukuran
 * chunk tak dibatasi 100 bind-param D1 maupun jumlah statement batch.
 * Dulu 50 header/1MB/10 chunk: setahun 500 transaksi/hari = ±3.650 file
 * dan ±365 panggilan.
 */
export const ARCHIVE_CHUNK_HEADERS = 1000;
export const ARCHIVE_CHUNK_MAX_BYTES = 2_000_000;
export const ARCHIVE_MAX_CHUNKS_PER_CALL = 3;

export interface ArchivePart {
	jobId: string;
	key: string;
	filename: string;
	checksum: string;
	count: number;
	counts: { buku_kas: number; transaksi_kasir: number };
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

export interface ArchiveChunkCursor {
	waktu: string;
	id: string;
}

/** Pra-kondisi konflik sebelum klaim (sesi aktif, pesanan Antrean). Per chunk. */
async function assertArchivePreconditions(
	rawDb: D1Database,
	branch: BranchContext,
	cutoff: string
): Promise<void> {
	const activeSessionPre = (await rawDb
		.prepare(`SELECT id FROM sesi_toko WHERE cabang_id = ? AND is_active = 1 LIMIT 1`)
		.bind(branch)
		.first()
		.catch(() => null)) as { id?: string } | null;
	if (activeSessionPre?.id) {
		throw new ArchiveUseCaseError(
			409,
			'Konflik arsip: Sesi toko masih aktif di cabang ini. Tutup sesi kasir terlebih dahulu.'
		);
	}
	// Antrean transaksi offline ada di IndexedDB perangkat, tidak terlihat server. Replay yang
	// tiba sesudah arsip tetap aman: barisnya di bawah cutoff dan ikut terarsip pada panggilan
	// berikutnya karena runArchive menghitung ulang baris yang memenuhi syarat.
	const pendingOrdersPre = (await rawDb
		.prepare(
			`SELECT count(*) as cnt FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending' AND waktu < ?`
		)
		.bind(branch, cutoff)
		.first()
		.catch(() => null)) as { cnt?: number } | null;
	if (pendingOrdersPre && Number(pendingOrdersPre.cnt) > 0) {
		throw new ArchiveUseCaseError(
			409,
			`Konflik arsip: Ada ${pendingOrdersPre.cnt} pesanan Antrean belum selesai. Selesaikan dulu sebelum mengarsipkan.`
		);
	}
}

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

// SQLite sizes escaped TEXT without transferring it. Numeric transport/JSON differences
// fit 32 bytes per IEEE-754 scalar; raw numbers are still fetched, never SQL-JSON decoded.
function archiveRowReadBytes(alias: string, fields: readonly string[]): string {
	return `(${2 + fields.reduce((n, field) => n + field.length + 4, 0)} + ${fields
		.map((field) => {
			const column = `${alias}.${field}`;
			return `(CASE WHEN typeof(${column}) = 'blob' OR length(CAST(${column} AS BLOB)) > ${ARCHIVE_CHUNK_MAX_BYTES}
			THEN ${ARCHIVE_CHUNK_MAX_BYTES + 1}
			WHEN typeof(${column}) IN ('integer', 'real') THEN 32
			ELSE length(CAST(json_quote(${column}) AS BLOB)) END)`;
		})
		.join(' + ')})`;
}

function archiveGroupReadBytes(): string {
	return `(${archiveRowReadBytes('bk', [...ARCHIVE_BUKU_KAS_FIELDS, 'revision'])}
		+ ${archiveRowReadBytes('bk', ['id', 'transaction_id', 'revision'])}
		+ COALESCE((SELECT SUM(${archiveRowReadBytes('tk', ARCHIVE_TRANSAKSI_KASIR_FIELDS)})
			FROM transaksi_kasir tk WHERE tk.cabang_id = bk.cabang_id AND tk.buku_kas_id = bk.id), 0))`;
}

/** Compact locators first; guarded atomic payload reads prevent a preflight/growth race. */
async function readArchiveChunk(
	rawDb: D1Database,
	branch: BranchContext,
	cutoff: string,
	cursor: ArchiveChunkCursor | null,
	limit: number
): Promise<{
	bukuKas: ArchiveRow[];
	transaksiKasir: Array<Record<string, unknown>>;
	hasMore: boolean;
}> {
	const cursorSql = cursor ? 'AND ((bk.waktu > ?) OR (bk.waktu = ? AND bk.id > ?))' : '';
	const cursorBinds = cursor ? [cursor.waktu, cursor.waktu, cursor.id] : [];
	const groupBytes = archiveGroupReadBytes();
	const detailCount = `(SELECT COUNT(*) FROM transaksi_kasir tk
		WHERE tk.cabang_id = bk.cabang_id AND tk.buku_kas_id = bk.id)`;
	const compact = await rawDb
		.prepare(
			`SELECT CAST(bk.rowid AS TEXT) AS row_key,
		${groupBytes} AS bytes, ${detailCount} AS detail_count
		FROM buku_kas bk WHERE bk.cabang_id = ? AND bk.waktu < ? ${cursorSql}
		ORDER BY bk.waktu ASC, bk.id ASC LIMIT ?`
		)
		.bind(branch, cutoff, ...cursorBinds, limit + 1)
		.all<{ row_key: string; bytes: number; detail_count: number }>();
	const selected: Array<{ rowKey: string; bytes: number; detailCount: number }> = [];
	let usedBytes = 4096; // Bounded v3 metadata, array punctuation and job/key fields.
	for (const row of compact.results) {
		if (selected.length === limit) break;
		if (
			!/^-?\d{1,20}$/.test(row.row_key) ||
			!Number.isSafeInteger(row.bytes) ||
			row.bytes < 0 ||
			!Number.isSafeInteger(row.detail_count) ||
			row.detail_count < 0 ||
			usedBytes + row.bytes > ARCHIVE_CHUNK_MAX_BYTES
		) {
			if (selected.length > 0) break;
			throw new ArchiveUseCaseError(
				413,
				'Transaksi melebihi batas ukuran satu snapshot arsip. Pengarsipan dibatalkan tanpa membaca seluruh isi atau menghapus data transaksi ini; perlu review operator.'
			);
		}
		selected.push({ rowKey: row.row_key, bytes: row.bytes, detailCount: row.detail_count });
		usedBytes += row.bytes;
	}
	if (selected.length === 0) return { bukuKas: [], transaksiKasir: [], hasMore: false };
	// Materialize only the guarded locators, not fields. The same D1 transaction owns
	// both payload SELECTs, so no huge detail can arrive between the header/detail reads.
	// CROSS JOIN memaksa SQLite memulai dari baris terpilih (<= limit)
	// lalu lookup per rowid/indeks. Dengan JOIN biasa planner memindai semua
	// baris terkualifikasi cabang di tiap chunk (O(n) per chunk, O(n^2) per tahun).
	const guarded = `WITH selected AS MATERIALIZED (
		SELECT bk.rowid AS row_key FROM json_each(?) chosen CROSS JOIN buku_kas bk
		ON bk.rowid = CAST(json_extract(chosen.value, '$.rowKey') AS INTEGER)
		WHERE bk.cabang_id = ? AND bk.waktu < ? ${cursorSql}
		AND ${groupBytes} <= json_extract(chosen.value, '$.bytes')
		AND ${detailCount} = json_extract(chosen.value, '$.detailCount'))`;
	const selection = JSON.stringify(selected);
	const [headers, details] = await rawDb.batch<Record<string, unknown>>([
		rawDb
			.prepare(
				`${guarded} SELECT ${[...ARCHIVE_BUKU_KAS_FIELDS, 'revision'].map((f) => `bk.${f}`).join(', ')}
			FROM selected CROSS JOIN buku_kas bk ON bk.rowid = selected.row_key
			WHERE bk.cabang_id = ? ORDER BY bk.waktu ASC, bk.id ASC`
			)
			.bind(selection, branch, cutoff, ...cursorBinds, branch),
		rawDb
			.prepare(
				`${guarded} SELECT ${ARCHIVE_TRANSAKSI_KASIR_FIELDS.map((f) => `tk.${f}`).join(', ')}
			FROM selected CROSS JOIN buku_kas bk ON bk.rowid = selected.row_key
			CROSS JOIN transaksi_kasir tk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
			WHERE tk.cabang_id = ? ORDER BY tk.id ASC`
			)
			.bind(selection, branch, cutoff, ...cursorBinds, branch)
	]);
	if (
		headers.results.length !== selected.length ||
		details.results.length !== selected.reduce((n, row) => n + row.detailCount, 0)
	) {
		throw new ArchiveUseCaseError(
			409,
			'Data arsip berubah bersamaan sebelum pembacaan. Coba lagi setelah memeriksa transaksi.'
		);
	}
	return {
		bukuKas: headers.results as ArchiveRow[],
		transaksiKasir: details.results,
		hasMore: compact.results.length > selected.length
	};
}

/**
 * Jalankan pengarsipan penuh milik cabang aktif.
 * Klaim job atomik per cabang; snapshot R2 dulu, hapus exact ID dalam batch
 * atomik di bawah klaim finalisasi. Ledger tidak pernah terhapus tanpa
 * snapshot terverifikasi.
 *
 * Driver chunk — tiap chunk adalah job sendiri (klaim, snapshot
 * satu objek R2, readback, finalisasi atomik). Recall melanjutkan otomatis.
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
	if (eligible === 0) {
		const resumed = await findResumedArchive(rawDb, branch, year);
		if (resumed) return resumed;
		return {
			kind: 'empty',
			message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
		};
	}

	// Driver chunk. Tiap chunk = satu job (klaim, snapshot satu
	// objek R2, readback, finalisasi atomik). Recall melanjutkan otomatis
	// karena row terarsip hilang dari eligibility. Dibatasi per panggilan
	// agar invocasi worker tetap bounded; sisa dilaporkan via 'partial'.
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
	let cursor: ArchiveChunkCursor | null = null;
	const parts: ArchivePart[] = [];
	let archivedCount = 0;
	let archivedBukuKas = 0;
	let archivedTransaksiKasir = 0;
	let firstCounts = { buku_kas: 0, transaksi_kasir: 0 };
	let firstKey = '';
	let firstFilename = '';
	let firstJobId = '';
	let exhausted = false;
	let interrupted: string | null = null;
	for (let chunk = 0; chunk < maxChunks; chunk++) {
		let result: Awaited<ReturnType<typeof runArchiveChunkJob>>;
		try {
			result = await runArchiveChunkJob(
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
		archivedCount += result.part.count;
		archivedBukuKas += result.part.counts.buku_kas;
		archivedTransaksiKasir += result.part.counts.transaksi_kasir;
		if (parts.length === 1) {
			firstCounts = result.part.counts;
			firstKey = result.part.key;
			firstFilename = result.part.filename;
			firstJobId = result.part.jobId;
		}
		if (!result.hasMore) {
			exhausted = true;
			break;
		}
		cursor = result.nextCursor;
	}
	if (parts.length === 0) {
		const resumed = await findResumedArchive(rawDb, branch, year);
		if (resumed) return resumed;
		return {
			kind: 'empty',
			message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
		};
	}
	if (parts.length === 1 && exhausted) {
		return {
			kind: 'completed',
			count: archivedCount,
			key: firstKey,
			filename: firstFilename,
			counts: firstCounts,
			parts,
			job_id: firstJobId
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
	return {
		kind: 'completed',
		count: archivedCount,
		key: parts[parts.length - 1].key,
		filename: parts[parts.length - 1].filename,
		counts: { buku_kas: archivedBukuKas, transaksi_kasir: archivedTransaksiKasir },
		parts
	};

	// Satu chunk arsip sebagai job sendiri. Finalisasi atomik per chunk
	// memakai guard + kontrak yang sama dengan alur tunggal lama.
	async function runArchiveChunkJob(
		chunkCursor: ArchiveChunkCursor | null,
		partSeq: number | null,
		headersPerChunk: number
	): Promise<
		| { empty: true }
		| {
				empty: false;
				part: ArchivePart;
				nextCursor: ArchiveChunkCursor;
				hasMore: boolean;
		  }
	> {
		// Pra-kondisi segar per chunk (sesi aktif, pesanan Antrean).
		await assertArchivePreconditions(rawDb, branch, cutoff);

		// Baca chunk dulu (tanpa job): kosong = selesai tanpa job sampah.
		// Row hilang antara recount dan baca (void/concurrent delete) ikut tertangani.
		const peek = await readArchiveChunk(rawDb, branch, cutoff, chunkCursor, headersPerChunk);
		if (peek.bukuKas.length === 0) return { empty: true } as const;
		let chunkHasMore = peek.hasMore;
		let bukuKas = peek.bukuKas;
		let transaksiKasir = peek.transaksiKasir;

		// Klaim job atomik per cabang (cutoff berbeda pun saling eksklusi).
		let job;
		try {
			job = await acquireArchiveJob(rawDb, branch, year, cutoff);
		} catch (e) {
			if ((e as Error & { code?: string }).code === 'ARCHIVE_LOCKED')
				throw new ArchiveUseCaseError(
					409,
					'Proses pengarsipan sedang berjalan untuk cabang ini. Coba lagi nanti.'
				);
			throw e;
		}
		const archiveJobId = job.id;
		let jobOwner = job.owner_token;

		try {
			// Tandai uploading (gagal ownership = worker lama, batalkan).
			if (!(await setJobStatus(rawDb, archiveJobId, jobOwner, 'uploading')))
				throw new ArchiveUseCaseError(409, 'Klaim arsip kedaluwarsa. Coba lagi.');

			// Kecilkan snapshot bila di atas budget byte; sisa ikut chunk berikut.
			// Kursor dihitung dari baris TERAKHIR yang kept agar tak ada yang hilang.
			let snapshot = buildArchiveSnapshot({
				branch,
				year,
				cutoffWita,
				archiveJobId,
				bukuKas,
				transaksiKasir,
				partSuffix: partSeq === null ? null : partSeq
			});
			// Paruh sampai muat atau tinggal satu header (1000 header = maks 10 paruhan).
			while (
				Buffer.byteLength(snapshot.content, 'utf8') > ARCHIVE_CHUNK_MAX_BYTES &&
				bukuKas.length > 1
			) {
				const keep = Math.max(1, Math.ceil(bukuKas.length / 2));
				bukuKas = bukuKas.slice(0, keep);
				const kept = new Set(bukuKas.map((r) => String(r.id)));
				transaksiKasir = transaksiKasir.filter((r) =>
					kept.has(String((r as Record<string, unknown>).buku_kas_id))
				);
				chunkHasMore = true;
				snapshot = buildArchiveSnapshot({
					branch,
					year,
					cutoffWita,
					archiveJobId,
					bukuKas,
					transaksiKasir,
					partSuffix: partSeq === null ? null : partSeq
				});
			}
			// A header and its details are indivisible. Never upload an oversized last group.
			if (Buffer.byteLength(snapshot.content, 'utf8') > ARCHIVE_CHUNK_MAX_BYTES) {
				throw new ArchiveUseCaseError(
					413,
					'Transaksi melebihi batas ukuran satu snapshot arsip. Pengarsipan dibatalkan tanpa menghapus data transaksi ini; perlu review operator.'
				);
			}
			const lastKept = bukuKas[bukuKas.length - 1];
			const nextCursor: ArchiveChunkCursor = {
				waktu: String(lastKept.waktu),
				id: String(lastKept.id)
			};
			const total = bukuKas.length + transaksiKasir.length;
			const { content, checksum, key, filename, itemManifest, tkIds } = snapshot;
			const archiveId = archiveJobId;
			await sealManifestItems(
				rawDb,
				archiveJobId,
				branch,
				itemManifest.map((m) => ({
					id: m.id,
					transaction_id: m.transaction_id,
					revision: m.revision
				}))
			);

			// Simpan ke R2 DULU — kalau gagal, lempar error & JANGAN hapus apa pun dari DB
			if (!bucket) throw new ArchiveUseCaseError(503, 'Storage tidak tersedia');
			await bucket.put(key, content, {
				httpMetadata: { contentType: 'application/json' },
				customMetadata: {
					branch,
					archive_id: archiveId,
					before_year: String(year),
					count: String(total),
					sha256: checksum
				}
			});

			// Verifikasi ISI readback (hash + ukuran), bukan sekadar ada.
			const readback = await bucket.get(key);
			if (!readback)
				throw new ArchiveUseCaseError(
					500,
					'Verifikasi integritas arsip R2 gagal: objek tidak dapat dibaca kembali'
				);
			verifyReadbackBytes(content, await readback.text());

			const manualSummaries = summarizeManualRows(bukuKas);
			const tkIdsJson = JSON.stringify(tkIds);
			const bukuKasIdsJson = JSON.stringify(itemManifest.map((m) => m.id));

			const finalizeToken = crypto.randomUUID();
			const nowMs = Date.now();
			// Validate the snapshot once, before this batch starts deleting its rows.
			const manifestOk = manifestIntactSql();
			const batchStatements = [
				// A successful claim is the stable guard for every effect in this atomic batch.
				rawDb
					.prepare(
						`UPDATE archive_jobs SET status = 'finalizing', owner_token = ?, updated_at = ?
					 WHERE id = ? AND owner_token = ? AND status IN ('claimed','uploading')
					 AND lease_expires_at > ?
					 AND NOT EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id = ? AND is_active = 1)
					 AND NOT EXISTS (SELECT 1 FROM buku_kas
						WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending' AND waktu < ?)
					 AND ${manifestOk}
					 AND (SELECT COUNT(*) FROM archive_job_items WHERE job_id = ? AND cabang_id = ?) = ?
					 AND (SELECT COUNT(*) FROM transaksi_kasir tk
					      JOIN archive_job_items m ON m.buku_kas_id = tk.buku_kas_id AND m.cabang_id = tk.cabang_id
					      WHERE m.job_id = ?) = ?
					 AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
					      WHERE NOT EXISTS (SELECT 1 FROM transaksi_kasir tk WHERE tk.cabang_id = ? AND tk.id = expected.value))`
					)
					.bind(
						finalizeToken,
						new Date().toISOString(),
						archiveJobId,
						jobOwner,
						nowMs,
						branch,
						branch,
						cutoff,
						branch,
						archiveJobId,
						archiveJobId,
						branch,
						itemManifest.length,
						archiveJobId,
						tkIds.length,
						tkIdsJson,
						branch
					)
			];
			const jobGuard = `EXISTS (SELECT 1 FROM archive_jobs WHERE id = ? AND owner_token = ? AND status = 'finalizing')`;

			// 1. Ringkasan arsip manual, ID deterministik job+dimensi (retry tidak ganda).
			// Satu statement per chunk (JSON), bukan satu INSERT per grup, agar
			// batch atomik tak membengkak saat chunk berisi ribuan baris manual.
			const summaryRows = [...manualSummaries.values()].map((s) => ({
				id: deterministicSummaryId(archiveJobId, s.tanggal_wita, s.tipe, s.jenis, s.metode_bayar),
				tanggal_wita: s.tanggal_wita,
				tipe: s.tipe,
				jenis: s.jenis,
				metode_bayar: s.metode_bayar,
				jumlah_transaksi: s.count,
				total_nominal: s.total_nominal
			}));
			if (summaryRows.length) {
				batchStatements.push(
					rawDb
						.prepare(
							`INSERT INTO ringkasan_kas_arsip_harian (
						id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar,
						jumlah_transaksi, total_nominal, created_at
					)
					SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.tanggal_wita'),
						json_extract(value, '$.tipe'), json_extract(value, '$.jenis'),
						json_extract(value, '$.metode_bayar'), json_extract(value, '$.jumlah_transaksi'),
						json_extract(value, '$.total_nominal'), ?
					FROM json_each(?)
					WHERE ${jobGuard} AND NOT EXISTS (
						SELECT 1 FROM ringkasan_kas_arsip_harian r WHERE r.id = json_extract(value, '$.id')
					)`
						)
						.bind(
							branch,
							archiveId,
							new Date().toISOString(),
							JSON.stringify(summaryRows),
							archiveJobId,
							finalizeToken
						)
				);
			}

			// 2. Delete exact snapshot IDs under the winning claim (no recheck after deletion).
			// transaksi detail dulu, header terakhir.
			// Satu statement per tabel: ID chunk sebagai satu parameter JSON.
			batchStatements.push(
				rawDb
					.prepare(
						`DELETE FROM transaksi_kasir WHERE cabang_id = ?
						 AND id IN (SELECT value FROM json_each(?)) AND ${jobGuard}`
					)
					.bind(branch, tkIdsJson, archiveJobId, finalizeToken),
				rawDb
					.prepare(
						`DELETE FROM buku_kas WHERE cabang_id = ?
						 AND id IN (SELECT value FROM json_each(?)) AND ${jobGuard}`
					)
					.bind(branch, bukuKasIdsJson, archiveJobId, finalizeToken)
			);

			batchStatements.push(
				rawDb
					.prepare(
						`UPDATE archive_jobs SET status = 'completed', object_key = ?, checksum = ?, counts = ?, updated_at = ?
					 WHERE id = ? AND owner_token = ? AND status = 'finalizing'`
					)
					.bind(
						key,
						checksum,
						JSON.stringify({
							total,
							buku_kas: bukuKas.length,
							transaksi_kasir: transaksiKasir.length
						}),
						new Date().toISOString(),
						archiveJobId,
						finalizeToken
					)
			);

			const finalResults = (await rawDb.batch(batchStatements)) as unknown as Array<{
				changes?: number;
				meta?: { changes?: number };
			}>;
			const claimChanges =
				typeof finalResults?.[0]?.changes === 'number'
					? finalResults[0].changes
					: (finalResults?.[0]?.meta?.changes ?? 0);
			if (claimChanges === 0) {
				throw new ArchiveUseCaseError(
					409,
					'Arsip berubah bersamaan (sesi/lease/edit/void). Snapshot orphan, ledger utuh. Coba lagi.'
				);
			}
			// Ownership changes only after the batch commits; on rollback/claim loss cleanup
			// must still use the original owner. Never describe a committed delete as untouched.
			jobOwner = finalizeToken;

			// Pointer legacy agar UI lama tetap resume; bukan sumber status utama.
			await rawDb
				.prepare(
					`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(cabang_id, kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = excluded.updated_at`
				)
				.bind(
					crypto.randomUUID(),
					branch,
					`archive_job_${year}`,
					JSON.stringify({
						id: archiveJobId,
						status: 'completed',
						year,
						key,
						filename,
						count: total,
						checksum,
						completed_at: new Date().toISOString()
					}),
					new Date().toISOString()
				)
				.run()
				.catch(() => {});

			return {
				empty: false,
				part: {
					jobId: archiveJobId,
					key,
					filename,
					checksum,
					count: total,
					counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
				},
				nextCursor,
				hasMore: chunkHasMore
			};
		} catch (err) {
			if (typeof archiveJobId === 'string' && typeof jobOwner === 'string') {
				const msg = err instanceof Error ? err.message : String(err);
				const orphan = /bersamaan|kedaluwarsa|lease|upload/i.test(msg);
				await setJobStatus(rawDb, archiveJobId, jobOwner, orphan ? 'orphan' : 'failed').catch(
					() => {}
				);
			}
			throw err;
		}
	}
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
