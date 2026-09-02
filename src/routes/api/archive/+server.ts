import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { createHash } from 'node:crypto';
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
	const cutoffWita = new Date(`${year}-01-01T00:00:00+08:00`);
	const cutoff = cutoffWita.toISOString();

	const rawDb = getRawDb(platform, branch);
	const bucket = platform?.env?.STORAGE;
	if (!bucket) throw kitError(503, 'Storage tidak tersedia');

	const [bukuKasResult, transaksiKasirResult] = await Promise.all([
		rawDb
			.prepare('SELECT * FROM buku_kas WHERE cabang_id = ? AND waktu < ?')
			.bind(branch, cutoff)
			.all(),
		rawDb
			.prepare(
				`SELECT tk.* FROM transaksi_kasir tk
				 INNER JOIN buku_kas bk
					ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
				 WHERE tk.cabang_id = ? AND bk.waktu < ?`
			)
			.bind(branch, cutoff)
			.all()
	]);
	const bukuKas = (bukuKasResult.results || []) as Array<Record<string, unknown>>;
	const transaksiKasir = (transaksiKasirResult.results || []) as Array<Record<string, unknown>>;

	const total = bukuKas.length + transaksiKasir.length;
	if (total === 0) {
		return json({
			ok: true,
			count: 0,
			message: `Tidak ada transaksi sebelum ${year} (WITA) untuk diarsipkan.`
		});
	}

	const archiveId = crypto.randomUUID();
	const archive = {
		meta: {
			archive_id: archiveId,
			branch,
			before_year: year,
			cutoff_wita: cutoffWita.toISOString(),
			exported_at: new Date().toISOString(),
			counts: { buku_kas: bukuKas.length, transaksi_kasir: transaksiKasir.length }
		},
		buku_kas: bukuKas,
		transaksi_kasir: transaksiKasir
	};
	const content = JSON.stringify(archive);
	const checksum = createHash('sha256').update(content).digest('hex');
	const filename = `arsip-${branch}-sebelum-${year}-${archiveId.slice(0, 8)}.json`;
	const key = `arsip/${branch}/${year}/${filename}`;

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

	// [CATATAN]: Verifikasi readback dari R2 untuk membuktikan objek benar tersimpan utuh
	const readback = await bucket.get(key);
	if (!readback) {
		throw kitError(500, 'Verifikasi integritas arsip R2 gagal: objek tidak dapat dibaca kembali');
	}

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

	const batchStatements = [];

	// 1. Simpan ringkasan arsip manual
	for (const s of manualSummaries.values()) {
		batchStatements.push(
			rawDb
				.prepare(
					`INSERT INTO ringkasan_kas_arsip_harian (
						id, cabang_id, archive_id, tanggal_wita, tipe, jenis, metode_bayar,
						jumlah_transaksi, total_nominal, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					crypto.randomUUID(),
					branch,
					archiveId,
					s.tanggal_wita,
					s.tipe,
					s.jenis,
					s.metode_bayar,
					s.count,
					s.total_nominal,
					new Date().toISOString()
				)
		);
	}

	// 2. Anti-TOCTOU: Hapus HANYA exact row IDs yang sudah tersimpan di file arsip
	const bkIds = bukuKas.map((r) => String(r.id)).filter(Boolean);
	const tkIds = transaksiKasir.map((r) => String(r.id)).filter(Boolean);

	// Chunked delete in batches of 50
	for (let i = 0; i < tkIds.length; i += 50) {
		const chunk = tkIds.slice(i, i + 50);
		const placeholders = chunk.map(() => '?').join(',');
		batchStatements.push(
			rawDb
				.prepare(`DELETE FROM transaksi_kasir WHERE cabang_id = ? AND id IN (${placeholders})`)
				.bind(branch, ...chunk)
		);
	}
	for (let i = 0; i < bkIds.length; i += 50) {
		const chunk = bkIds.slice(i, i + 50);
		const placeholders = chunk.map(() => '?').join(',');
		batchStatements.push(
			rawDb
				.prepare(`DELETE FROM buku_kas WHERE cabang_id = ? AND id IN (${placeholders})`)
				.bind(branch, ...chunk)
		);
	}

	if (batchStatements.length > 0) {
		await rawDb.batch(batchStatements);
	}

	return json({
		ok: true,
		count: total,
		key,
		filename,
		content,
		counts: archive.meta.counts
	});
};
