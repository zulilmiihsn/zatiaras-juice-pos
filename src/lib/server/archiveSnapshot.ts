/**
 * Kontrak snapshot arsip: versi skema, kolom yang masuk snapshot, perakitan snapshot,
 * dan ringkasan harian kas manual. Murni (tanpa I/O); dipakai use case arsip dan
 * divalidasi ulang oleh skrip restore (scripts/restore-archive-lib.mjs).
 */

import { sha256Hex } from './archiveService';

/** Error domain arsip yang membawa status HTTP; route memetakan ke respons. */
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

/** Versi skema snapshot kanonik. Writer hanya emit versi ini. */
export const ARCHIVE_SCHEMA_VERSION = 3;

/**
 * Kolom ledger yang masuk snapshot. Sama dengan BK_FIELDS/
 * TK_FIELDS di scripts/restore-archive-lib.mjs (disamakan via tes,
 * bukan import, agar bundle worker tak menarik node:crypto).
 * `revision` hanya untuk manifest, bukan isi snapshot.
 */
export const ARCHIVE_BUKU_KAS_FIELDS = [
	'id',
	'cabang_id',
	'waktu',
	'sumber',
	'tipe',
	'jenis',
	'nominal',
	'jumlah',
	'deskripsi',
	'nama_pelanggan',
	'metode_bayar',
	'transaction_id',
	'idempotency_key',
	'request_fingerprint',
	'receipt_snapshot',
	'nomor_harian',
	'tanggal_nomor',
	'stock_policy_mode',
	'stock_policy_revision',
	'stock_replay_disposition',
	'preparation_state',
	'preparation_revision',
	'preparation_completed_at',
	'preparation_completed_by',
	'id_sesi_toko',
	'created_at'
] as const;

export const ARCHIVE_TRANSAKSI_KASIR_FIELDS = [
	'id',
	'cabang_id',
	'buku_kas_id',
	'produk_id',
	'nama_kustom',
	'jumlah',
	'nominal',
	'harga',
	'nama_produk',
	'harga_dasar',
	'total_tambahan',
	'snapshot_tambahan',
	'gula',
	'es',
	'catatan',
	'snapshot_hpp',
	'nominal_hpp',
	'transaction_id',
	'created_at'
] as const;

/**
 * Rakit snapshot arsip dari baris yang sudah dibaca. Murni kecuali `now`.
 * Baris diproyeksikan ke kontrak kolom eksplisit: kolom di luar
 * kontrak (revision/token operasional, updated_at, kolom masa depan) tak
 * masuk snapshot. `revision` hanya dipakai manifest klaim/idempotency.
 */
export function buildArchiveSnapshot(input: {
	branch: string;
	year: number;
	cutoffWita: Date;
	archiveJobId: string;
	bukuKas: ArchiveRow[];
	transaksiKasir: Array<Record<string, unknown>>;
	now?: Date;
	/** Nomor part chunk. null = objek tunggal dengan key legacy. */
	partSuffix?: number | null;
}): ArchiveSnapshot {
	const { branch, year, cutoffWita, archiveJobId, bukuKas, transaksiKasir } = input;
	const partSuffix = input.partSuffix ?? null;
	const now = input.now ?? new Date();
	const itemManifest = bukuKas.map((r) => {
		// Hanya angka bulat aman: '' / boolean / NaN tak boleh menjadi revision 0/1.
		const revision = r.revision ?? 0;
		if (typeof revision !== 'number' || !Number.isSafeInteger(revision))
			throw new ArchiveUseCaseError(
				422,
				`Revision transaksi ${String(r.id)} tidak valid; pengarsipan dibatalkan tanpa menghapus data, perlu review operator.`
			);
		return {
			id: String(r.id),
			transaction_id: (r.transaction_id as string | null) ?? null,
			revision
		};
	});
	const tkIds = transaksiKasir.map((r) => String(r.id)).filter(Boolean);
	const projectRow = (row: Record<string, unknown>, fields: readonly string[]) => {
		const projected: Record<string, unknown> = {};
		for (const field of fields) {
			if (field in row) projected[field] = row[field];
		}
		return projected;
	};
	const snapshotBukuKas = bukuKas.map((r) =>
		projectRow(r as Record<string, unknown>, ARCHIVE_BUKU_KAS_FIELDS)
	);
	const snapshotTransaksiKasir = transaksiKasir.map((r) =>
		projectRow(r, ARCHIVE_TRANSAKSI_KASIR_FIELDS)
	);
	const archive = {
		meta: {
			schema_version: ARCHIVE_SCHEMA_VERSION,
			archive_id: archiveJobId,
			job_id: archiveJobId,
			branch,
			before_year: year,
			cutoff_wita: cutoffWita.toISOString(),
			exported_at: now.toISOString(),
			counts: { buku_kas: snapshotBukuKas.length, transaksi_kasir: snapshotTransaksiKasir.length }
		},
		items: itemManifest,
		buku_kas: snapshotBukuKas,
		transaksi_kasir: snapshotTransaksiKasir
	};
	const content = JSON.stringify(archive);
	const checksum = sha256Hex(content);
	const baseFilename = `arsip-${branch}-sebelum-${year}-${archiveJobId.slice(0, 8)}.json`;
	const filename =
		partSuffix === null
			? baseFilename
			: baseFilename.replace(/\.json$/, `.part-${String(partSuffix).padStart(4, '0')}.json`);
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
