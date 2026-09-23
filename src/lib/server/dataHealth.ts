/**
 * Data health detector — query read-only untuk audit pra-migrasi.
 *
 * Dipakai operator SEBELUM menambah constraint/uniqueness: bila detector
 * menemukan baris, migrasi enforcement harus berhenti dan data diperbaiki
 * manual (jangan dedup/hapus otomatis). Lihat ENGINEERING-IMPROVEMENT-PLAN
 * Fase 5 dan DEVELOPER-GUIDE §9.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from './branchResolver';

export interface OrphanDetail {
	id: string;
	buku_kas_id: string | null;
}

export interface OrphanMutasi {
	id: string;
	bahan_id: string;
}

export interface NegativeStock {
	id: string;
	nama: string | null;
	stok: number | null;
	kind: 'produk' | 'bahan';
}

const LIMIT = 100;

/** Detail transaksi yang header buku_kas-nya hilang (cabang sama). */
export async function findOrphanTransaksiKasir(
	db: D1Database,
	branch: BranchId
): Promise<OrphanDetail[]> {
	const { results = [] } = (await db
		.prepare(
			`SELECT tk.id AS id, tk.buku_kas_id AS buku_kas_id
			 FROM transaksi_kasir tk
			 LEFT JOIN buku_kas bk
			   ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
			 WHERE tk.cabang_id = ? AND bk.id IS NULL
			 LIMIT ?`
		)
		.bind(branch, LIMIT)
		.all()) as { results?: OrphanDetail[] };
	return results.map((r) => ({ id: r.id, buku_kas_id: r.buku_kas_id }));
}

/** Mutasi bahan yang bahan induknya hilang (cabang sama). */
export async function findOrphanBahanMutasi(
	db: D1Database,
	branch: BranchId
): Promise<OrphanMutasi[]> {
	const { results = [] } = (await db
		.prepare(
			`SELECT m.id AS id, m.bahan_id AS bahan_id
			 FROM bahan_mutasi m
			 LEFT JOIN bahan b
			   ON b.cabang_id = m.cabang_id AND b.id = m.bahan_id
			 WHERE m.cabang_id = ? AND b.id IS NULL
			 LIMIT ?`
		)
		.bind(branch, LIMIT)
		.all()) as { results?: OrphanMutasi[] };
	return results.map((r) => ({ id: r.id, bahan_id: r.bahan_id }));
}

/** Stok negatif produk/bahan (cabang sama). */
export async function findNegativeStock(
	db: D1Database,
	branch: BranchId
): Promise<NegativeStock[]> {
	const { results: produk = [] } = (await db
		.prepare(
			`SELECT id, nama, stok FROM produk
			 WHERE cabang_id = ? AND COALESCE(stok, 0) < 0
			 LIMIT ?`
		)
		.bind(branch, LIMIT)
		.all()) as { results?: Array<{ id: string; nama: string | null; stok: number | null }> };
	const { results: bahan = [] } = (await db
		.prepare(
			`SELECT id, nama, stok_saat_ini AS stok FROM bahan
			 WHERE cabang_id = ? AND COALESCE(stok_saat_ini, 0) < 0
			 LIMIT ?`
		)
		.bind(branch, LIMIT)
		.all()) as { results?: Array<{ id: string; nama: string | null; stok: number | null }> };
	return [
		...produk.map((r) => ({ id: r.id, nama: r.nama, stok: r.stok, kind: 'produk' as const })),
		...bahan.map((r) => ({ id: r.id, nama: r.nama, stok: r.stok, kind: 'bahan' as const }))
	];
}

export interface DataHealthReport {
	orphanTransaksiKasir: OrphanDetail[];
	orphanBahanMutasi: OrphanMutasi[];
	negativeStock: NegativeStock[];
	clean: boolean;
}

/** Laporan gabungan; `clean` true bila tidak ada temuan. */
export async function checkDataHealth(db: D1Database, branch: BranchId): Promise<DataHealthReport> {
	const [orphanTransaksiKasir, orphanBahanMutasi, negativeStock] = await Promise.all([
		findOrphanTransaksiKasir(db, branch),
		findOrphanBahanMutasi(db, branch),
		findNegativeStock(db, branch)
	]);
	return {
		orphanTransaksiKasir,
		orphanBahanMutasi,
		negativeStock,
		clean:
			orphanTransaksiKasir.length === 0 &&
			orphanBahanMutasi.length === 0 &&
			negativeStock.length === 0
	};
}
