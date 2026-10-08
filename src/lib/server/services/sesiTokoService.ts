import { and, desc, eq, type SQL } from 'drizzle-orm';
import { sesiToko } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { error as kitError } from '@sveltejs/kit';
import { normalizeMoney } from '$lib/server/checkout/utils';

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
 * Membuka toko: tepat satu sesi aktif per cabang (AUD-010).
 * Atomic via INSERT ... WHERE NOT EXISTS dalam satu statement — dua buka
 * bersamaan menghasilkan tepat satu pemenang; yang kalah 409 tanpa mutasi.
 * Retry id sama mengembalikan duplikat stabil.
 */
export async function insertSesiTokoRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	rows: Array<Record<string, unknown>>
) {
	if (!Array.isArray(rows) || rows.length !== 1) {
		throw kitError(400, 'Buka toko harus satu sesi per request');
	}
	const row = rows[0];
	const id = String(row.id ?? '').trim();
	if (!id) throw kitError(400, 'ID sesi tidak valid');
	const kasAwal =
		typeof row.kas_awal === 'number'
			? row.kas_awal
			: typeof row.kas_awal === 'string' && row.kas_awal.trim()
				? Number(row.kas_awal)
				: Number.NaN;
	if (!Number.isFinite(kasAwal) || kasAwal < 0) throw kitError(400, 'Modal awal tidak valid');
	if (kasAwal > Number.MAX_SAFE_INTEGER) throw kitError(400, 'Modal awal melebihi batas aman');
	const normalizedKasAwal = normalizeMoney(kasAwal);
	const normalizedRow = { ...row, kas_awal: normalizedKasAwal };
	const waktuBuka = typeof row.waktu_buka === 'string' ? row.waktu_buka : '';
	if (!waktuBuka || !Number.isFinite(Date.parse(waktuBuka))) {
		throw kitError(400, 'Waktu buka tidak valid');
	}

	const byId = (await rawDb
		.prepare(
			'SELECT id, kas_awal, waktu_buka FROM sesi_toko WHERE cabang_id = ? AND id = ? LIMIT 1'
		)
		.bind(branch, id)
		.first()) as { id?: string; kas_awal?: number; waktu_buka?: string } | null;
	if (byId?.id) {
		if (Number(byId.kas_awal) !== normalizedKasAwal || byId.waktu_buka !== waktuBuka) {
			throw kitError(409, 'ID pembukaan sesi sudah digunakan dengan data yang berbeda.');
		}
		return { ok: true, data: [normalizedRow], duplicate: true };
	}

	const now = new Date().toISOString();
	let openedChanges = 0;
	try {
		const opened = (await rawDb
			.prepare(
				`INSERT INTO sesi_toko (id, cabang_id, kas_awal, waktu_buka, waktu_tutup, is_active, created_at, updated_at)
				 SELECT ?, ?, ?, ?, NULL, 1, ?, ? WHERE NOT EXISTS
				 (SELECT 1 FROM sesi_toko WHERE cabang_id = ? AND is_active = 1)`
			)
			.bind(id, branch, normalizedKasAwal, waktuBuka, now, now, branch)
			.run()) as unknown as { meta?: { changes?: number } };
		openedChanges = Number(opened?.meta?.changes ?? 0);
	} catch (error) {
		// Balapan sempit: keduanya lolos NOT EXISTS, unique index memenangkan satu.
		const message = error instanceof Error ? error.message : String(error);
		if (!/UNIQUE constraint failed/i.test(message)) throw error;
	}
	if (openedChanges === 0) {
		const raced = (await rawDb
			.prepare(
				'SELECT id, kas_awal, waktu_buka FROM sesi_toko WHERE cabang_id = ? AND id = ? LIMIT 1'
			)
			.bind(branch, id)
			.first()) as { id?: string; kas_awal?: number; waktu_buka?: string } | null;
		if (raced?.id) {
			if (Number(raced.kas_awal) !== normalizedKasAwal || raced.waktu_buka !== waktuBuka) {
				throw kitError(409, 'ID pembukaan sesi sudah digunakan dengan data yang berbeda.');
			}
			return { ok: true, data: [normalizedRow], duplicate: true };
		}
		throw kitError(409, 'Toko sudah dibuka. Tutup sesi aktif dahulu sebelum membuka baru.');
	}

	await publish(platform, branch, 'sesi_toko', 'insert', { id });
	await auditDataChange(rawDb, branch, session, 'sesi_toko', 'insert', id, { count: 1 });
	return { ok: true, data: [normalizedRow] };
}

/**
 * Tutup sesi hanya melalui transisi active -> closed; opening data tidak dapat ditulis ulang.
 * CAS dan scope cabang ada pada UPDATE agar request bersamaan tidak menimpa snapshot pertama.
 */
export async function updateSesiTokoRow(
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string,
	payload: Record<string, unknown>
) {
	const fields = Object.keys(payload).sort();
	if (
		fields.length !== 2 ||
		fields[0] !== 'is_active' ||
		fields[1] !== 'waktu_tutup' ||
		payload.is_active !== false
	) {
		throw kitError(400, 'Payload penutupan sesi tidak valid');
	}
	const waktuTutup = typeof payload.waktu_tutup === 'string' ? payload.waktu_tutup : '';
	const waktuTutupMs = Date.parse(waktuTutup);
	if (!waktuTutup || !Number.isFinite(waktuTutupMs)) {
		throw kitError(400, 'Waktu tutup tidak valid');
	}

	const current = (await rawDb
		.prepare(
			'SELECT id, is_active, waktu_buka, waktu_tutup FROM sesi_toko WHERE cabang_id = ? AND id = ? LIMIT 1'
		)
		.bind(branch, id)
		.first()) as {
		id?: string;
		is_active?: number | null;
		waktu_buka?: string;
		waktu_tutup?: string | null;
	} | null;
	if (!current?.id) throw kitError(404, 'Sesi tidak ditemukan');
	const waktuBukaMs = Date.parse(String(current.waktu_buka ?? ''));
	if (!Number.isFinite(waktuBukaMs) || waktuTutupMs < waktuBukaMs) {
		throw kitError(400, 'Waktu tutup tidak boleh mendahului waktu buka');
	}
	if (Number(current.is_active) !== 1) {
		if (current.waktu_tutup === waktuTutup) return { ok: true, duplicate: true };
		throw kitError(409, 'Sesi sudah ditutup dengan waktu yang berbeda');
	}
	if (current.waktu_tutup != null) {
		throw kitError(409, 'Data sesi aktif tidak konsisten; penutupan ditolak');
	}

	const now = new Date().toISOString();
	const updated = (await rawDb
		.prepare(
			`UPDATE sesi_toko SET waktu_tutup = ?, is_active = 0, updated_at = ?
			 WHERE cabang_id = ? AND id = ? AND is_active = 1 AND waktu_tutup IS NULL`
		)
		.bind(waktuTutup, now, branch, id)
		.run()) as { meta?: { changes?: number } };
	if (Number(updated.meta?.changes ?? 0) !== 1) {
		const latest = (await rawDb
			.prepare(
				'SELECT is_active, waktu_tutup FROM sesi_toko WHERE cabang_id = ? AND id = ? LIMIT 1'
			)
			.bind(branch, id)
			.first()) as { is_active?: number | null; waktu_tutup?: string | null } | null;
		if (!latest) throw kitError(404, 'Sesi tidak ditemukan');
		if (Number(latest.is_active) !== 1 && latest.waktu_tutup === waktuTutup) {
			return { ok: true, duplicate: true };
		}
		throw kitError(409, 'Sesi berubah atau sudah ditutup. Muat ulang sebelum mencoba lagi.');
	}

	await publish(platform, branch, 'sesi_toko', 'update', { id });
	await auditDataChange(rawDb, branch, session, 'sesi_toko', 'update', id, {
		fields: ['waktu_tutup', 'is_active']
	});
	return { ok: true, duplicate: false };
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function getSesiTokoListForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	id: string | null,
	active: string | null,
	limit: number
) {
	return getSesiTokoList(getDb(platform, branch), branch, id, active, limit);
}

export function getSesiSummaryForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	sessionId: string
) {
	return getSesiSummary(getRawDb(platform, branch), branch, sessionId);
}

export function insertSesiTokoRowsForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	rows: Array<Record<string, unknown>>
) {
	return insertSesiTokoRows(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		rows
	);
}

export function updateSesiTokoRowForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	id: string,
	payload: Record<string, unknown>
) {
	return updateSesiTokoRow(getRawDb(platform, branch), branch, session, platform, id, payload);
}
