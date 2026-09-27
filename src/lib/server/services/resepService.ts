import { and, desc, eq, type SQL } from 'drizzle-orm';
import { resepProduk } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { error as kitError } from '@sveltejs/kit';

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
	const rows = payload.map((row) => ({
		...row,
		id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
		produk_id: String(row.produk_id || ''),
		bahan_id: String(row.bahan_id || ''),
		porsi: row.porsi ? String(row.porsi).trim().toLowerCase() : 'reguler',
		jumlah_per_item: Number(row.jumlah_per_item || 0),
		satuan_resep: row.satuan_resep ? String(row.satuan_resep).trim() : null,
		jumlah_dasar_per_item: Number(row.jumlah_dasar_per_item ?? row.jumlah_per_item ?? 0)
	}));

	if (rows.some((row) => !row.produk_id || !row.bahan_id || row.jumlah_per_item <= 0)) {
		throw kitError(400, 'Resep bahan tidak valid');
	}

	await db.insert(resepProduk).values(rows as (typeof resepProduk.$inferInsert)[]);
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
	const rows = payload.map((row) => ({
		...row,
		id: typeof row.id === 'string' && row.id ? row.id : crypto.randomUUID(),
		produk_id: String(row.produk_id || productId),
		bahan_id: String(row.bahan_id || ''),
		porsi: row.porsi ? String(row.porsi).trim().toLowerCase() : 'reguler',
		jumlah_per_item: Number(row.jumlah_per_item || 0),
		satuan_resep: row.satuan_resep ? String(row.satuan_resep).trim() : null,
		jumlah_dasar_per_item: Number(row.jumlah_dasar_per_item ?? row.jumlah_per_item ?? 0)
	}));

	if (
		rows.some((row) => row.produk_id !== productId || !row.bahan_id || row.jumlah_per_item <= 0)
	) {
		throw kitError(400, 'Resep bahan tidak valid');
	}

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
					row.porsi || 'reguler',
					row.jumlah_per_item,
					row.satuan_resep || null,
					row.jumlah_dasar_per_item || row.jumlah_per_item,
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
