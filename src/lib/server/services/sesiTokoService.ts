import { and, desc, eq, type SQL } from 'drizzle-orm';
import { sesiToko } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { sanitizeUpdatePayload } from '$lib/server/resourceRouteHelpers';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

/**
 * Mengambil daftar sesi toko berdasarkan cabang dan filter aktif.
 */
export async function getSesiTokoList(
	db: Database,
	branch: string,
	id: string | null,
	active: string | null,
	limit: number
) {
	const filters: SQL[] = [eq(sesiToko.cabang_id, branch)];
	if (id) filters.push(eq(sesiToko.id, id));
	if (active === 'true') filters.push(eq(sesiToko.is_active, true));
	if (active === 'false') filters.push(eq(sesiToko.is_active, false));

	return db
		.select()
		.from(sesiToko)
		.where(and(...filters))
		.orderBy(desc(sesiToko.created_at))
		.limit(limit);
}

/**
 * Ringkasan sesi: agregasi SELURUH ledger sesi dalam satu query.
 * Formula laci: modal awal + pemasukan tunai − pengeluaran tunai.
 * totalPemasukan mencakup semua `in` (jangan disebut penjualan POS bila ada setoran manual).
 */
export async function getSesiSummary(rawDb: D1Database, branch: string, sessionId: string) {
	const row = (await rawDb
		.prepare(
			`SELECT s.id AS id, s.kas_awal AS modalAwal,
				COALESCE(SUM(CASE WHEN b.tipe = 'in' THEN b.nominal ELSE 0 END), 0) AS totalPemasukan,
				COALESCE(SUM(CASE WHEN b.tipe = 'in' AND b.metode_bayar = 'tunai' THEN b.nominal ELSE 0 END), 0) AS pemasukanTunai,
				COALESCE(SUM(CASE WHEN b.tipe = 'in' AND b.metode_bayar != 'tunai' THEN b.nominal ELSE 0 END), 0) AS pemasukanNonTunai,
				COALESCE(SUM(CASE WHEN b.tipe = 'out' AND b.metode_bayar = 'tunai' THEN b.nominal ELSE 0 END), 0) AS pengeluaranTunai,
				COUNT(b.id) AS baris
			 FROM sesi_toko s
			 LEFT JOIN buku_kas b ON b.cabang_id = s.cabang_id AND b.id_sesi_toko = s.id
			 WHERE s.cabang_id = ? AND s.id = ?
			 GROUP BY s.id, s.kas_awal
			 LIMIT 1`
		)
		.bind(branch, sessionId)
		.first()) as {
		id?: string;
		modalAwal?: number;
		totalPemasukan?: number;
		pemasukanTunai?: number;
		pemasukanNonTunai?: number;
		pengeluaranTunai?: number;
		baris?: number;
	} | null;
	if (!row?.id) return null;
	const modalAwal = Number(row.modalAwal || 0);
	const pemasukanTunai = Number(row.pemasukanTunai || 0);
	const pengeluaranTunai = Number(row.pengeluaranTunai || 0);
	return {
		id: row.id,
		modalAwal,
		totalPemasukan: Number(row.totalPemasukan || 0),
		pemasukanTunai,
		pemasukanNonTunai: Number(row.pemasukanNonTunai || 0),
		pengeluaranTunai,
		uangKasir: modalAwal + pemasukanTunai - pengeluaranTunai,
		baris: Number(row.baris || 0)
	};
}

/**
 * Menyisipkan sesi toko baru (buka toko).
 */
export async function insertSesiTokoRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	rows: Array<Record<string, unknown>>
) {
	await db.insert(sesiToko).values(rows as (typeof sesiToko.$inferInsert)[]);
	await publish(platform, branch, 'sesi_toko', 'insert', { id: rows[0]?.id as string | undefined });
	await auditDataChange(
		rawDb,
		branch,
		session,
		'sesi_toko',
		'insert',
		rows[0]?.id as string | number | null | undefined,
		{
			count: rows.length
		}
	);
	return { ok: true, data: rows };
}

/**
 * Memperbarui data sesi toko (tutup toko, update kas akhir).
 */
export async function updateSesiTokoRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string,
	payload: Record<string, unknown>
) {
	await db
		.update(sesiToko)
		.set(sanitizeUpdatePayload(payload as Partial<typeof sesiToko.$inferInsert>))
		.where(and(eq(sesiToko.cabang_id, branch), eq(sesiToko.id, id)));
	await publish(platform, branch, 'sesi_toko', 'update', { id });
	await auditDataChange(rawDb, branch, session, 'sesi_toko', 'update', id, {
		fields: Object.keys(payload)
	});
	return { ok: true };
}
