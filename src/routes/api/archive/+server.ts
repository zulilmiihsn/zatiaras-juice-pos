import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
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
} from '$lib/server/archiveService';
import type { RequestHandler } from './$types';

/**
 * Preview arsip transaksi lama (sebelum tahun tertentu) tanpa mutasi data.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const year = Number(url.searchParams.get('before_year'));
	if (!Number.isInteger(year) || year < 2020 || year > 2100) {
		throw kitError(400, 'Parameter before_year tidak valid');
	}

	const cutoffWita = new Date(`${year}-01-01T00:00:00+08:00`);
	const cutoff = cutoffWita.toISOString();
	const rawDb = getRawDb(platform, branch);

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

	return json({
		ok: true,
		preview: true,
		branch,
		before_year: year,
		cutoff_wita: cutoffWita.toISOString(),
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
	});
};

/**
 * Arsip transaksi lama (sebelum tahun tertentu) milik cabang aktif.
 *
 * Alur AMAN (Anti-TOCTOU & WITA Aware):
 *   1. Hitung cutoff tepat awal tahun WITA (UTC+8).
 *   2. Ambil exact rows buku_kas + transaksi_kasir sebelum cutoff.
 *   3. Simpan snapshot lengkap ke R2 dengan SHA-256 checksum & readback verification.
 *   4. Rekapitulasi kas manual ke ringkasan_kas_arsip_harian.
 *   5. Baru hapus EXACT IDs yang sudah terarsip dari D1 dalam batch atomik.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = (await request.json().catch(() => null)) as { before_year?: number } | null;
	const year = Number(body?.before_year);
	if (!Number.isInteger(year) || year < 2020 || year > 2100) {
		throw kitError(400, 'Tahun tidak valid');
	}

	// [CATATAN]: Cutoff 1 Jan 00:00 WITA (UTC+8) -> dikonversi ke UTC ISO string
	const { cutoffWita, cutoff } = cutoffForYear(year);

	const rawDb = getRawDb(platform, branch);
	const bucket = platform?.env?.STORAGE as
		| {
				put: (k: string, v: string, o?: unknown) => Promise<unknown>;
				get: (k: string) => Promise<null | {
					text: () => Promise<string>;
					arrayBuffer: () => Promise<ArrayBuffer>;
				}>;
		  }
		| undefined;
	if (!bucket) throw kitError(503, 'Storage tidak tersedia');

	// Eligible recount dulu: resume hanya bila tak ada row baru.
	// Retry sesudah sukses (row sudah terhapus) kembali hasil sama;
	// row baru/backdate/restored memicu job baru, bukan resume tahun.
	const eligible = await countEligibleRows(rawDb, branch, cutoff);
	if (eligible === 0) {
		const completed = await getCompletedJobForYear(rawDb, branch, year).catch(() => null);
		if (completed?.object_key) {
			let count = 0;
			try {
				count = Number((JSON.parse(completed.counts || '{}') as { total?: number }).total || 0);
			} catch {}
			return json({
				ok: true,
				resumed: true,
				count,
				key: completed.object_key,
				message: `Arsip tahun ${year} telah selesai diproses sebelumnya (snapshot di-resume).`
			});
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
					return json({
						ok: true,
						resumed: true,
						count: parsed.count || 0,
						key: parsed.key,
						filename: parsed.filename,
						message: `Arsip tahun ${year} telah selesai diproses sebelumnya (snapshot di-resume).`
					});
				}
			} catch {}
		}
		return json({
			ok: true,
			count: 0,
			message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
		});
	}

	// Pemeriksaan konflik SEBELUM klaim agar job gagal tak memblokir cabang.
	const activeSessionPre = (await rawDb
		.prepare(`SELECT id FROM sesi_toko WHERE cabang_id = ? AND is_active = 1 LIMIT 1`)
		.bind(branch)
		.first()
		.catch(() => null)) as { id?: string } | null;
	if (activeSessionPre?.id) {
		throw kitError(
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
		throw kitError(
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
			throw kitError(409, 'Proses pengarsipan sedang berjalan untuk cabang ini. Coba lagi nanti.');
		throw e;
	}
	const archiveJobId = job.id;
	let jobOwner = job.owner_token;

	try {
		// Tandai uploading (gagal ownership = worker lama, batalkan).
		if (!(await setJobStatus(rawDb, archiveJobId, jobOwner, 'uploading')))
			throw kitError(409, 'Klaim arsip kedaluwarsa. Coba lagi.');

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
		const bukuKas = (bukuKasResult?.results || []) as Array<Record<string, unknown>>;
		const transaksiKasir = (transaksiKasirResult?.results || []) as Array<Record<string, unknown>>;

		const total = bukuKas.length + transaksiKasir.length;
		if (total === 0) {
			// Row hilang antara recount dan snapshot (void/concurent delete): tak ada yang diarsipkan.
			await setJobStatus(rawDb, archiveJobId, jobOwner, 'completed', {
				counts: JSON.stringify({ total: 0, buku_kas: 0, transaksi_kasir: 0 })
			});
			return json({
				ok: true,
				count: 0,
				message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
			});
		}

		const archiveId = archiveJobId;
		const itemManifest = bukuKas.map((r) => ({
			id: String(r.id),
			transaction_id: (r.transaction_id as string | null) ?? null,
			revision: Number(r.revision ?? 0)
		}));
		const tkIds = transaksiKasir.map((r) => String(r.id)).filter(Boolean);
		const archive = {
			meta: {
				schema_version: 2,
				archive_id: archiveId,
				job_id: archiveJobId,
				branch,
				before_year: year,
				cutoff_wita: cutoffWita.toISOString(),
				exported_at: new Date().toISOString(),
				counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
			},
			items: itemManifest,
			buku_kas: bukuKas,
			transaksi_kasir: transaksiKasir
		};
		const content = JSON.stringify(archive);
		const checksum = sha256Hex(content);
		const filename = `arsip-${branch}-sebelum-${year}-${archiveId.slice(0, 8)}.json`;
		const key = `arsip/${branch}/${year}/${filename}`;
		await sealManifestItems(
			rawDb,
			archiveJobId,
			branch,
			bukuKas.map((r) => ({
				id: String(r.id),
				transaction_id: (r.transaction_id as string | null) ?? null,
				revision: Number(r.revision ?? 0)
			}))
		);

		// [CATATAN]: Simpan ke R2 DULU — kalau gagal, lempar error & JANGAN hapus apa pun dari DB
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

		// F19: verifikasi ISI readback (hash + ukuran), bukan sekadar ada.
		const readback = await bucket.get(key);
		if (!readback)
			throw kitError(500, 'Verifikasi integritas arsip R2 gagal: objek tidak dapat dibaca kembali');
		verifyReadbackBytes(content, await readback.text());

		// [CATATAN]: Rekapitulasi transaksi manual ke ringkasan_kas_arsip_harian agar histori laporan tetap utuh
		const manualSummaries = new Map<
			string,
			{
				tanggal_wita: string;
				tipe: string;
				jenis: string;
				metode_bayar: string | null;
				count: number;
				total_nominal: number;
			}
		>();

		for (const r of bukuKas) {
			const sumber = String(r.sumber || '');
			if (sumber === 'pos') continue; // POS sudah memiliki penjualan_produk_harian

			const waktuStr = String(r.waktu || '');
			let tanggalWita = '';
			try {
				const d = new Date(waktuStr);
				// Add 8 hours for WITA
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
			const current = manualSummaries.get(summaryKey) || {
				tanggal_wita: tanggalWita,
				tipe,
				jenis,
				metode_bayar: metode,
				count: 0,
				total_nominal: 0
			};
			current.count += 1;
			current.total_nominal += nominal;
			manualSummaries.set(summaryKey, current);
		}

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
					JSON.stringify({ total, ...archive.meta.counts }),
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
			throw kitError(
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

		return json({
			ok: true,
			count: total,
			key,
			filename,
			content,
			counts: archive.meta.counts
		});
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
};
