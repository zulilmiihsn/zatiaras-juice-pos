/**
 * Satu chunk arsip sebagai job sendiri: pra-kondisi, baca, klaim, snapshot satu objek R2,
 * readback, lalu finalisasi atomik. Finalisasi per chunk memakai guard + kontrak yang sama
 * dengan alur tunggal lama; ledger tidak pernah terhapus tanpa snapshot terverifikasi.
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import {
	acquireArchiveJob,
	deterministicSummaryId,
	manifestIntactSql,
	sealManifestItems,
	setJobStatus,
	verifyReadbackBytes
} from './archiveService';
import {
	ARCHIVE_CHUNK_MAX_BYTES,
	readArchiveChunk,
	type ArchiveChunkCursor
} from './archiveChunkReader';
import {
	ArchiveUseCaseError,
	type ArchiveRow,
	type ArchiveSnapshot,
	buildArchiveSnapshot,
	summarizeManualRows
} from './archiveSnapshot';

export interface ArchiveBucket {
	put(key: string, value: string, opts?: unknown): Promise<unknown>;
	get(
		key: string
	): Promise<null | { text: () => Promise<string>; body?: ReadableStream<Uint8Array> }>;
}

export interface ArchivePart {
	jobId: string;
	key: string;
	filename: string;
	checksum: string;
	count: number;
	counts: { buku_kas: number; transaksi_kasir: number };
}

export interface ArchiveChunkContext {
	rawDb: D1Database;
	bucket: ArchiveBucket;
	branch: BranchContext;
	year: number;
	cutoff: string;
	cutoffWita: Date;
}

export type ArchiveChunkOutcome =
	| { empty: true }
	| { empty: false; part: ArchivePart; nextCursor: ArchiveChunkCursor; hasMore: boolean };

type ArchiveChunkRead = Awaited<ReturnType<typeof readArchiveChunk>>;

/** Baris chunk yang lolos budget byte: header dan detailnya tidak terpisah. */
interface FittedChunk {
	snapshot: ArchiveSnapshot;
	bukuKas: ArchiveRow[];
	transaksiKasir: Array<Record<string, unknown>>;
	hasMore: boolean;
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

/** Klaim job atomik per cabang (cutoff berbeda pun saling eksklusi). */
async function claimChunkJob(ctx: ArchiveChunkContext) {
	try {
		return await acquireArchiveJob(ctx.rawDb, ctx.branch, ctx.year, ctx.cutoff);
	} catch (e) {
		if ((e as Error & { code?: string }).code === 'ARCHIVE_LOCKED') {
			throw new ArchiveUseCaseError(
				409,
				'Proses pengarsipan sedang berjalan untuk cabang ini. Coba lagi nanti.'
			);
		}
		throw e;
	}
}

/**
 * Kecilkan snapshot bila di atas budget byte; sisa ikut chunk berikut.
 * Kursor dihitung dari baris TERAKHIR yang kept agar tak ada yang hilang.
 */
function fitChunkToBudget(
	ctx: ArchiveChunkContext,
	archiveJobId: string,
	partSeq: number | null,
	peek: ArchiveChunkRead
): FittedChunk {
	const build = (bukuKas: ArchiveRow[], transaksiKasir: Array<Record<string, unknown>>) =>
		buildArchiveSnapshot({
			branch: ctx.branch,
			year: ctx.year,
			cutoffWita: ctx.cutoffWita,
			archiveJobId,
			bukuKas,
			transaksiKasir,
			partSuffix: partSeq
		});

	let { bukuKas, transaksiKasir, hasMore } = peek;
	let snapshot = build(bukuKas, transaksiKasir);
	// Paruh sampai muat atau tinggal satu header (1000 header = maks 10 paruhan).
	while (
		Buffer.byteLength(snapshot.content, 'utf8') > ARCHIVE_CHUNK_MAX_BYTES &&
		bukuKas.length > 1
	) {
		const keep = Math.max(1, Math.ceil(bukuKas.length / 2));
		bukuKas = bukuKas.slice(0, keep);
		const kept = new Set(bukuKas.map((r) => String(r.id)));
		transaksiKasir = transaksiKasir.filter((r) => kept.has(String(r.buku_kas_id)));
		hasMore = true;
		snapshot = build(bukuKas, transaksiKasir);
	}
	// A header and its details are indivisible. Never upload an oversized last group.
	if (Buffer.byteLength(snapshot.content, 'utf8') > ARCHIVE_CHUNK_MAX_BYTES) {
		throw new ArchiveUseCaseError(
			413,
			'Transaksi melebihi batas ukuran satu snapshot arsip. Pengarsipan dibatalkan tanpa menghapus data transaksi ini; perlu review operator.'
		);
	}
	return { snapshot, bukuKas, transaksiKasir, hasMore };
}

/** Simpan ke R2 DULU lalu verifikasi ISI readback (hash + ukuran), bukan sekadar ada. */
async function uploadAndVerifySnapshot(
	ctx: ArchiveChunkContext,
	archiveJobId: string,
	snapshot: ArchiveSnapshot,
	total: number
): Promise<void> {
	const { bucket, branch, year } = ctx;
	const { content, checksum, key } = snapshot;
	// Kalau put gagal, error dilempar & JANGAN hapus apa pun dari DB.
	await bucket.put(key, content, {
		httpMetadata: { contentType: 'application/json' },
		customMetadata: {
			branch,
			archive_id: archiveJobId,
			before_year: String(year),
			count: String(total),
			sha256: checksum
		}
	});

	const readback = await bucket.get(key);
	if (!readback) {
		throw new ArchiveUseCaseError(
			500,
			'Verifikasi integritas arsip R2 gagal: objek tidak dapat dibaca kembali'
		);
	}
	verifyReadbackBytes(content, await readback.text());
}

/**
 * Batch finalisasi atomik: klaim finalisasi, ringkasan kas manual, hapus ID snapshot yang
 * persis sama, tandai job selesai. Setiap efek dijaga klaim `finalizing` milik job ini.
 */
function buildFinalizeStatements(
	ctx: ArchiveChunkContext,
	input: {
		archiveJobId: string;
		jobOwner: string;
		finalizeToken: string;
		chunk: FittedChunk;
		total: number;
	}
): D1PreparedStatement[] {
	const { rawDb, branch, cutoff } = ctx;
	const { archiveJobId, jobOwner, finalizeToken, chunk, total } = input;
	const { bukuKas, transaksiKasir } = chunk;
	const { checksum, key, itemManifest, tkIds } = chunk.snapshot;

	const manualSummaries = summarizeManualRows(bukuKas);
	const tkIdsJson = JSON.stringify(tkIds);
	const bukuKasIdsJson = JSON.stringify(itemManifest.map((m) => m.id));
	const nowMs = Date.now();
	// Validate the snapshot once, before this batch starts deleting its rows.
	const manifestOk = manifestIntactSql();
	const statements = [
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
		statements.push(
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
					archiveJobId,
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
	statements.push(
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

	statements.push(
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
	return statements;
}

/** Pointer legacy agar UI lama tetap resume; bukan sumber status utama. */
async function writeLegacyPointer(
	ctx: ArchiveChunkContext,
	archiveJobId: string,
	snapshot: ArchiveSnapshot,
	total: number
): Promise<void> {
	const { rawDb, branch, year } = ctx;
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
				key: snapshot.key,
				filename: snapshot.filename,
				count: total,
				checksum: snapshot.checksum,
				completed_at: new Date().toISOString()
			}),
			new Date().toISOString()
		)
		.run()
		// Arsip sudah commit; gagal menulis pointer legacy tidak boleh membatalkannya.
		.catch(() => {});
}

/** Tandai job gagal atau orphan (snapshot terunggah, ledger utuh) setelah kegagalan di tengah chunk. */
async function markJobFailed(
	rawDb: D1Database,
	archiveJobId: string,
	jobOwner: string,
	err: unknown
): Promise<void> {
	if (typeof archiveJobId !== 'string' || typeof jobOwner !== 'string') return;
	const msg = err instanceof Error ? err.message : String(err);
	const orphan = /bersamaan|kedaluwarsa|lease|upload/i.test(msg);
	// Pembersihan best-effort: error asli proses arsip yang harus sampai ke pemanggil.
	await setJobStatus(rawDb, archiveJobId, jobOwner, orphan ? 'orphan' : 'failed').catch(() => {});
}

/** Proses satu chunk. `partSeq` null = bagian pertama (key tanpa akhiran nomor). */
export async function runArchiveChunkJob(
	ctx: ArchiveChunkContext,
	chunkCursor: ArchiveChunkCursor | null,
	partSeq: number | null,
	headersPerChunk: number
): Promise<ArchiveChunkOutcome> {
	const { rawDb, branch, cutoff } = ctx;

	// Pra-kondisi segar per chunk (sesi aktif, pesanan Antrean).
	await assertArchivePreconditions(rawDb, branch, cutoff);

	// Baca chunk dulu (tanpa job): kosong = selesai tanpa job sampah.
	// Row hilang antara recount dan baca (void/concurrent delete) ikut tertangani.
	const peek = await readArchiveChunk(rawDb, branch, cutoff, chunkCursor, headersPerChunk);
	if (peek.bukuKas.length === 0) return { empty: true };

	const job = await claimChunkJob(ctx);
	const archiveJobId = job.id;
	let jobOwner = job.owner_token;

	try {
		// Tandai uploading (gagal ownership = worker lama, batalkan).
		if (!(await setJobStatus(rawDb, archiveJobId, jobOwner, 'uploading'))) {
			throw new ArchiveUseCaseError(409, 'Klaim arsip kedaluwarsa. Coba lagi.');
		}

		const chunk = fitChunkToBudget(ctx, archiveJobId, partSeq, peek);
		const { snapshot, bukuKas, transaksiKasir } = chunk;
		const lastKept = bukuKas[bukuKas.length - 1];
		const nextCursor: ArchiveChunkCursor = {
			waktu: String(lastKept.waktu),
			id: String(lastKept.id)
		};
		const total = bukuKas.length + transaksiKasir.length;
		await sealManifestItems(
			rawDb,
			archiveJobId,
			branch,
			snapshot.itemManifest.map((m) => ({
				id: m.id,
				transaction_id: m.transaction_id,
				revision: m.revision
			}))
		);

		await uploadAndVerifySnapshot(ctx, archiveJobId, snapshot, total);

		const finalizeToken = crypto.randomUUID();
		const finalResults = (await rawDb.batch(
			buildFinalizeStatements(ctx, { archiveJobId, jobOwner, finalizeToken, chunk, total })
		)) as unknown as Array<{ changes?: number; meta?: { changes?: number } }>;
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

		await writeLegacyPointer(ctx, archiveJobId, snapshot, total);

		return {
			empty: false,
			part: {
				jobId: archiveJobId,
				key: snapshot.key,
				filename: snapshot.filename,
				checksum: snapshot.checksum,
				count: total,
				counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
			},
			nextCursor,
			hasMore: chunk.hasMore
		};
	} catch (err) {
		await markJobFailed(rawDb, archiveJobId, jobOwner, err);
		throw err;
	}
}
