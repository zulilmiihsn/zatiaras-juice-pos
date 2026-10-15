import { and, desc, eq, type SQL } from 'drizzle-orm';
import { resepProduk } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { error as kitError } from '@sveltejs/kit';
import { finiteNumber } from '$lib/server/payloadFields';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

/**
 * Mengambil daftar resep produk, dengan opsi filter produk_id.
 */
export async function getResepList(
	db: Database,
	branch: string,
	productId: string | null,
	limit: number
) {
	const filters: SQL[] = [eq(resepProduk.cabang_id, branch)];
	if (productId) filters.push(eq(resepProduk.produk_id, productId));

	return db
		.select()
		.from(resepProduk)
		.where(and(...filters))
		.orderBy(desc(resepProduk.created_at))
		.limit(limit);
}

const RECIPE_PORSI = new Set(['reguler', 'jumbo']);

type RecipeRow = {
	id: string;
	produk_id: string;
	bahan_id: string;
	porsi: string;
	jumlah_per_item: number;
	satuan_resep: string | null;
	jumlah_dasar_per_item: number;
};

/**
 * Normalisasi baris resep dari klien: hanya kolom resep, jumlah wajib angka positif, porsi
 * reguler/jumbo. Bahan dan produk wajib milik cabang yang sama; samarinda dan samarinda2
 * berbagi satu shard, jadi ID cabang lain bisa saja ada di database yang sama.
 */
async function normalizeRecipeRows(
	rawDb: D1Database,
	branch: string,
	payload: Array<Record<string, unknown>>,
	productId?: string
): Promise<RecipeRow[]> {
	const rows = payload.map((row): RecipeRow => {
		const jumlah = finiteNumber(row.jumlah_per_item);
		const dasar = finiteNumber(row.jumlah_dasar_per_item);
		const porsi =
			row.porsi == null || row.porsi === '' ? 'reguler' : String(row.porsi).trim().toLowerCase();
		const produkId = String(row.produk_id ?? productId ?? '').trim();
		const bahanId = String(row.bahan_id ?? '').trim();
		if (
			!produkId ||
			!bahanId ||
			(productId !== undefined && produkId !== productId) ||
			jumlah === null ||
			jumlah <= 0 ||
			!RECIPE_PORSI.has(porsi)
		) {
			throw kitError(400, 'Resep bahan tidak valid');
		}
		return {
			id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
			produk_id: produkId,
			bahan_id: bahanId,
			porsi,
			jumlah_per_item: jumlah,
			satuan_resep: row.satuan_resep ? String(row.satuan_resep).trim() : null,
			// Jumlah dasar kosong/0 memakai jumlah resep (perilaku lama).
			jumlah_dasar_per_item: dasar !== null && dasar > 0 ? dasar : jumlah
		};
	});
	if (rows.length === 0) return rows;
	const owned = await rawDb
		.prepare(
			`SELECT
				(SELECT COUNT(DISTINCT id) FROM bahan WHERE cabang_id = ? AND id IN (SELECT value FROM json_each(?))) AS bahan,
				(SELECT COUNT(DISTINCT id) FROM produk WHERE cabang_id = ? AND id IN (SELECT value FROM json_each(?))) AS produk`
		)
		.bind(
			branch,
			JSON.stringify([...new Set(rows.map((row) => row.bahan_id))]),
			branch,
			JSON.stringify([...new Set(rows.map((row) => row.produk_id))])
		)
		.first<{ bahan: number; produk: number }>();
	if (
		Number(owned?.bahan) !== new Set(rows.map((row) => row.bahan_id)).size ||
		Number(owned?.produk) !== new Set(rows.map((row) => row.produk_id)).size
	) {
		throw kitError(400, 'Produk atau bahan resep tidak ditemukan di cabang ini');
	}
	return rows;
}

/**
 * Menyisipkan komposisi resep bahan untuk produk.
 */
export async function insertResepRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	payload: Array<Record<string, unknown>>
) {
	const rows = (await normalizeRecipeRows(rawDb, branch, payload)).map((row) => ({
		...row,
		cabang_id: branch
	}));
	if (rows.length === 0) throw kitError(400, 'Resep bahan tidak valid');

	await db.insert(resepProduk).values(rows);
	await publish(platform, branch, 'resep_produk', 'insert', {
		id: rows[0]?.id,
		transaction_id: rows[0]?.produk_id as string | undefined
	});
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'insert', rows[0]?.id, {
		count: rows.length,
		produk_id: rows[0]?.produk_id
	});

	return { ok: true, data: rows };
}

/**
 * Mengganti seluruh resep bahan suatu produk secara atomik (batch D1).
 */
export async function replaceResepForProduct(
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	productId: string,
	payload: Array<Record<string, unknown>>
) {
	const rows = await normalizeRecipeRows(rawDb, branch, payload, productId);

	const now = new Date().toISOString();
	const statements = [
		rawDb
			.prepare('DELETE FROM resep_produk WHERE cabang_id = ? AND produk_id = ?')
			.bind(branch, productId),
		...rows.map((row) =>
			rawDb
				.prepare(
					`INSERT INTO resep_produk (
						id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					row.id,
					branch,
					productId,
					row.bahan_id,
					row.porsi,
					row.jumlah_per_item,
					row.satuan_resep,
					row.jumlah_dasar_per_item,
					now,
					now
				)
		)
	];

	await rawDb.batch(statements);
	await publish(platform, branch, 'resep_produk', 'update', {
		transaction_id: productId
	});
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'replace', null, {
		produk_id: productId,
		count: rows.length
	});

	return { ok: true, data: rows };
}

/**
 * Menghapus satu item baris resep produk berdasarkan id.
 */
export async function deleteResepRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string
) {
	await db
		.delete(resepProduk)
		.where(and(eq(resepProduk.cabang_id, branch), eq(resepProduk.id, String(id))));
	await publish(platform, branch, 'resep_produk', 'delete', { id });
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'delete', id);
	return { ok: true };
}

/**
 * Menghapus seluruh baris resep untuk suatu produk (bulk).
 */
export async function deleteResepByProduct(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	productId: string
) {
	await db
		.delete(resepProduk)
		.where(and(eq(resepProduk.cabang_id, branch), eq(resepProduk.produk_id, productId)));
	await publish(platform, branch, 'resep_produk', 'delete', { transaction_id: productId });
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'delete_by_product', null, {
		produk_id: productId
	});
	return { ok: true };
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function getResepListForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	productId: string | null,
	limit: number
) {
	return getResepList(getDb(platform, branch), branch, productId, limit);
}

export function insertResepRowsForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	payload: Array<Record<string, unknown>>
) {
	return insertResepRows(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		payload
	);
}

export function replaceResepForProductForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	productId: string,
	payload: Array<Record<string, unknown>>
) {
	return replaceResepForProduct(
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		productId,
		payload
	);
}

export function deleteResepRowForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	id: string
) {
	return deleteResepRow(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		id
	);
}

export function deleteResepByProductForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	productId: string
) {
	return deleteResepByProduct(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		productId
	);
}
