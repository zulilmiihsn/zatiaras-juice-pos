/**
 * Archive use case — orkestrasi pengarsipan transaksi lama.
 *
 * Route (`src/routes/api/archive/+server.ts`) hanya: auth, parsing, panggil
 * fungsi di sini, petakan hasil/error ke HTTP. Seluruh SQL, klaim atomik,
 * snapshot R2, readback, summary, dan finalisasi tinggal di sini.
 *
 * Tidak import SvelteKit. Error domain memakai ArchiveUseCaseError yang
 * membawa status HTTP; route memetakan ke kitError/json.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from './branchResolver';
import {
	acquireArchiveJob,
	countEligibleRows,
	cutoffForYear,
	deterministicSummaryId,
	getCompletedJobForYear,
	manifestIntactSql,
	sealManifestItems,
	setJobStatus,
	sha256Hex,
	verifyReadbackBytes
} from './archiveService';

export interface ArchiveBucket {
	put(key: string, value: string, opts?: unknown): Promise<unknown>;
	get(
		key: string
	): Promise<null | { text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }>;
}

export class ArchiveUseCaseError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ArchiveUseCaseError';
		this.status = status;
	}
}

export interface ArchiveRow {
	id: string;
	transaction_id?: string | null;
	revision?: number | null;
	sumber?: unknown;
	waktu?: unknown;
	tipe?: unknown;
	jenis?: unknown;
	metode_bayar?: unknown;
	nominal?: unknown;
	[key: string]: unknown;
}

export interface ManualSummary {
	tanggal_wita: string;
	tipe: string;
	jenis: string;
	metode_bayar: string | null;
	count: number;
	total_nominal: number;
}

export interface ArchiveSnapshot {
	archive: Record<string, unknown>;
	content: string;
	checksum: string;
	key: string;
	filename: string;
	itemManifest: Array<{ id: string; transaction_id: string | null; revision: number }>;
	tkIds: string[];
	total: number;
}

export type ArchiveResult =
	| { kind: 'empty'; message: string }
	| { kind: 'resumed'; count: number; key: string; message: string; filename?: string }
	| {
			kind: 'completed';
			count: number;
			key: string;
			filename: string;
			content: string;
			counts: { buku_kas: number; transaksi_kasir: number };
	  };

export interface ArchivePreview {
	branch: string;
	before_year: number;
	cutoff_wita: string;
	counts: { buku_kas: number; pos: number; manual: number; transaksi_kasir: number };
	financials: { total_in: number; total_out: number };
}

export function validateArchiveYear(year: number): void {
	if (!Number.isInteger(year) || year < 2020 || year > 2100) {
		throw new ArchiveUseCaseError(400, 'Tahun tidak valid');
	}
}

/** Rakit snapshot arsip dari baris yang sudah dibaca. Murni kecuali `now`. */
export function buildArchiveSnapshot(input: {
	branch: string;
	year: number;
	cutoffWita: Date;
	archiveJobId: string;
	bukuKas: ArchiveRow[];
	transaksiKasir: Array<Record<string, unknown>>;
	now?: Date;
}): ArchiveSnapshot {
	const { branch, year, cutoffWita, archiveJobId, bukuKas, transaksiKasir } = input;
	const now = input.now ?? new Date();
	const itemManifest = bukuKas.map((r) => ({
		id: String(r.id),
		transaction_id: (r.transaction_id as string | null) ?? null,
		revision: Number(r.revision ?? 0)
	}));
	const tkIds = transaksiKasir.map((r) => String(r.id)).filter(Boolean);
	const archive = {
		meta: {
			schema_version: 2,
			archive_id: archiveJobId,
			job_id: archiveJobId,
			branch,
			before_year: year,
			cutoff_wita: cutoffWita.toISOString(),
			exported_at: now.toISOString(),
			counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
		},
		items: itemManifest,
		buku_kas: bukuKas,
		transaksi_kasir: transaksiKasir
	};
	const content = JSON.stringify(archive);
	const checksum = sha256Hex(content);
	const filename = `arsip-${branch}-sebelum-${year}-${archiveJobId.slice(0, 8)}.json`;
	const key = `arsip/${branch}/${year}/${filename}`;
	return {
		archive,
		content,
		checksum,
		key,
		filename,
		itemManifest,
		tkIds,
		total: bukuKas.length + transaksiKasir.length
	};
}

/**
 * Rekap transaksi manual (non-pos) per hari WITA. Murni.
 * POS dilewati karena sudah memiliki penjualan_produk_harian.
 */
export function summarizeManualRows(bukuKas: ArchiveRow[]): Map<string, ManualSummary> {
	const summaries = new Map<string, ManualSummary>();
	for (const r of bukuKas) {
		const sumber = String(r.sumber || '');
		if (sumber === 'pos') continue;

		const waktuStr = String(r.waktu || '');
		let tanggalWita = '';
		try {
			const d = new Date(waktuStr);
			const witaTime = new Date(d.getTime() + 8 * 60 * 60 * 1000);
			tanggalWita = witaTime.toISOString().slice(0, 10);
		} catch {
			tanggalWita = waktuStr.slice(0, 10);
		}

		const tipe = String(r.tipe || 'in');
		const jenis = String(r.jenis || 'lainnya');
		const metode = r.metode_bayar ? String(r.metode_bayar) : null;
		const nominal = Number(r.nominal || 0);

		const summaryKey = `${tanggalWita}:${tipe}:${jenis}:${metode || 'none'}`;
		const current = summaries.get(summaryKey) || {
			tanggal_wita: tanggalWita,
			tipe,
			jenis,
			metode_bayar: metode,
			count: 0,
			total_nominal: 0
		};
		current.count += 1;
		current.total_nominal += nominal;
		summaries.set(summaryKey, current);
	}
	return summaries;
}

/** Preview arsip tanpa mutasi. */
export async function previewArchive(
	rawDb: D1Database,
	branch: BranchId,
	year: number
): Promise<ArchivePreview> {
	validateArchiveYear(year);
	const { cutoff } = cutoffForYear(year);

	const [bukuKasStats, transaksiCount] = await Promise.all([
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
			.first() as Promise<{ count?: number } | null>
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
		}
	};
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
	branch: BranchId,
	year: number
): Promise<ArchiveResult> {
	validateArchiveYear(year);
	const { cutoffWita, cutoff } = cutoffForYear(year);
	if (!bucket) throw new ArchiveUseCaseError(503, 'Storage tidak tersedia');

	// Eligible recount dulu: resume hanya bila tak ada row baru.
	const eligible = await countEligibleRows(rawDb, branch, cutoff);
	if (eligible === 0) {
		const completed = await getCompletedJobForYear(rawDb, branch, year).catch(() => null);
		if (completed?.object_key) {
			let count = 0;
			try {
				count = Number((JSON.parse(completed.counts || '{}') as { total?: number }).total || 0);
			} catch {}
			return {
				kind: 'resumed',
				count,
				key: completed.object_key,
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
						message: `Arsip tahun ${year} telah selesai diproses sebelumnya (snapshot di-resume).`
					};
				}
			} catch {}
		}
		return {
			kind: 'empty',
			message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
		};
	}

	// Pemeriksaan konflik SEBELUM klaim agar job gagal tak memblokir cabang.
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
	const pendingPre = (await rawDb
		.prepare(
			`SELECT count(*) as cnt FROM antrean_offline WHERE cabang_id = ? AND status IN ('pending', 'syncing')`
		)
		.bind(branch)
		.first()
		.catch(() => null)) as { cnt?: number } | null;
	if (pendingPre && Number(pendingPre.cnt) > 0) {
		throw new ArchiveUseCaseError(
			409,
			`Konflik arsip: Ada ${pendingPre.cnt} transaksi offline yang belum tersinkronisasi. Selesaikan sinkronisasi terlebih dahulu.`
		);
	}

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

		const [bukuKasResult, transaksiKasirResult] = (await rawDb.batch([
			rawDb
				.prepare('SELECT * FROM buku_kas WHERE cabang_id = ? AND waktu < ?')
				.bind(branch, cutoff),
			rawDb
				.prepare(
					`SELECT tk.* FROM transaksi_kasir tk
				 INNER JOIN buku_kas bk
					ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
				 WHERE tk.cabang_id = ? AND bk.waktu < ?`
				)
				.bind(branch, cutoff)
		])) as unknown as Array<{ results?: Array<Record<string, unknown>> }>;
		const bukuKas = ((bukuKasResult?.results || []) as Array<Record<string, unknown>>).map(
			(r) => r as ArchiveRow
		);
		const transaksiKasir = (transaksiKasirResult?.results || []) as Array<Record<string, unknown>>;

		const total = bukuKas.length + transaksiKasir.length;
		if (total === 0) {
			// Row hilang antara recount dan snapshot (void/concurent delete): tak ada yang diarsipkan.
			await setJobStatus(rawDb, archiveJobId, jobOwner, 'completed', {
				counts: JSON.stringify({ total: 0, buku_kas: 0, transaksi_kasir: 0 })
			});
			return {
				kind: 'empty',
				message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
			};
		}

		const snapshot = buildArchiveSnapshot({
			branch,
			year,
			cutoffWita,
			archiveJobId,
			bukuKas,
			transaksiKasir
		});
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
					archiveJobId,
					archiveJobId,
					branch,
					itemManifest.length,
					archiveJobId,
					tkIds.length,
					JSON.stringify(tkIds),
					branch
				)
		];
		const jobGuard = `EXISTS (SELECT 1 FROM archive_jobs WHERE id = ? AND owner_token = ? AND status = 'finalizing')`;

		// 1. Ringkasan arsip manual, ID deterministik job+dimensi (retry tidak ganda).
		for (const s of manualSummaries.values()) {
			const sid = deterministicSummaryId(
				archiveJobId,
				s.tanggal_wita,
				s.tipe,
				s.jenis,
				s.metode_bayar
			);
			batchStatements.push(
				rawDb
					.prepare(
						`INSERT INTO ringkasan_kas_arsip_harian (
						id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar,
						jumlah_transaksi, total_nominal, created_at
					)
					SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
					WHERE ${jobGuard} AND NOT EXISTS (SELECT 1 FROM ringkasan_kas_arsip_harian WHERE id = ?)`
					)
					.bind(
						sid,
						branch,
						archiveId,
						s.tanggal_wita,
						s.tipe,
						s.jenis,
						s.metode_bayar,
						s.count,
						s.total_nominal,
						new Date().toISOString(),
						archiveJobId,
						finalizeToken,
						sid
					)
			);
		}

		// 2. Delete exact snapshot IDs under the winning claim (no recheck after deletion).
		// transaksi detail dulu, header terakhir.
		for (let i = 0; i < tkIds.length; i += 50) {
			const chunk = tkIds.slice(i, i + 50);
			const placeholders = chunk.map(() => '?').join(',');
			batchStatements.push(
				rawDb
					.prepare(
						`DELETE FROM transaksi_kasir WHERE cabang_id = ? AND id IN (${placeholders})
						 AND ${jobGuard}`
					)
					.bind(branch, ...chunk, archiveJobId, finalizeToken)
			);
		}
		for (let i = 0; i < itemManifest.length; i += 20) {
			const chunk = itemManifest.slice(i, i + 20);
			const placeholders = chunk.map(() => '?').join(',');
			const ids = chunk.map((m) => m.id);
			batchStatements.push(
				rawDb
					.prepare(
						`DELETE FROM buku_kas WHERE cabang_id = ? AND id IN (${placeholders})
						 AND ${jobGuard}`
					)
					.bind(branch, ...ids, archiveJobId, finalizeToken)
			);
		}

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
			kind: 'completed',
			count: total,
			key,
			filename,
			content,
			counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
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
