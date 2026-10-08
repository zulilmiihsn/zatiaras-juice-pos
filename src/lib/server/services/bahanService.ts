import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { bahan, bahanMutasi } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { sanitizeUpdatePayload } from '$lib/server/resourceRouteHelpers';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
import { loadStockPolicy } from '$lib/server/stockPolicy';
import { error as kitError } from '@sveltejs/kit';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

function nonNegativeNumber(value: unknown, label: string): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed < 0) throw kitError(400, `${label} tidak valid`);
	return parsed;
}

/**
 * Mengambil daftar data bahan baku berdasarkan cabang.
 */
export async function getBahanList(db: Database, branch: string, limit: number) {
	return db
		.select()
		.from(bahan)
		.where(eq(bahan.cabang_id, branch))
		.orderBy(asc(bahan.nama))
		.limit(limit);
}

/**
 * Menyisipkan bahan baku baru dengan kalkulasi biaya beli dan biaya per satuan.
 */
export async function insertBahanRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	payload: Array<Record<string, unknown>>
) {
	const rows = payload.map((row) => {
		const purchaseQuantity = nonNegativeNumber(row.jumlah_beli_terakhir, 'Jumlah porsi');
		const purchaseCost = nonNegativeNumber(row.biaya_beli_terakhir, 'Biaya beli');
		const yieldVal =
			row.yield_persen != null ? Math.min(100, Math.max(1, Number(row.yield_persen))) : 100;
		return {
			...row,
			satuan: row.satuan || 'gram',
			tipe_satuan: row.tipe_satuan ? String(row.tipe_satuan).trim() : 'berat',
			isi_per_kemasan: nonNegativeNumber(row.isi_per_kemasan, 'Isi kemasan') || 1,
			satuan_beli: row.satuan_beli ? String(row.satuan_beli).trim() : null,
			kategori: row.kategori ? String(row.kategori).trim() : 'Bahan Baku',
			stok_saat_ini: nonNegativeNumber(row.stok_saat_ini, 'Stok'),
			ambang_stok: nonNegativeNumber(row.ambang_stok, 'Minimum stok'),
			yield_persen: yieldVal,
			biaya_per_satuan: calculateEffectiveUnitCost(purchaseCost, purchaseQuantity, yieldVal),
			jumlah_beli_terakhir: purchaseQuantity,
			biaya_beli_terakhir: purchaseCost
		};
	}) as Array<typeof bahan.$inferInsert>;

	await db.insert(bahan).values(rows as (typeof bahan.$inferInsert)[]);
	await publish(platform, branch, 'bahan', 'insert', { id: rows[0]?.id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'insert', rows[0]?.id, {
		count: rows.length
	});
	return { ok: true, data: rows };
}

/**
 * Memperbarui data bahan dan menghitung ulang biaya per satuan bila komponen biaya berubah.
 */
export async function updateBahanRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string,
	payload: Record<string, unknown>
) {
	const safePayload = sanitizeUpdatePayload(payload);
	// Saldo bukan metadata (AUD-009): PATCH tak boleh menulis stok_saat_ini —
	// form basi akan menghapus mutasi checkout bersamaan. Saldo eksplisit hanya
	// lewat mutasi atomik / purchase / rekonsiliasi. Stok awal tetap via create.
	if ('stok_saat_ini' in safePayload) {
		throw kitError(400, 'Saldo bahan hanya lewat mutasi stok atau rekonsiliasi, bukan edit bahan');
	}
	const current = await db
		.select({
			jumlah_beli_terakhir: bahan.jumlah_beli_terakhir,
			biaya_beli_terakhir: bahan.biaya_beli_terakhir,
			yield_persen: bahan.yield_persen
		})
		.from(bahan)
		.where(and(eq(bahan.cabang_id, branch), eq(bahan.id, String(id))))
		.get();
	if (!current) throw kitError(404, 'Bahan tidak ditemukan');

	if ('kategori' in safePayload && safePayload.kategori !== undefined) {
		safePayload.kategori = safePayload.kategori
			? String(safePayload.kategori).trim()
			: 'Bahan Baku';
	}
	if ('stok_saat_ini' in safePayload)
		safePayload.stok_saat_ini = nonNegativeNumber(safePayload.stok_saat_ini, 'Stok');
	if ('ambang_stok' in safePayload) {
		safePayload.ambang_stok = nonNegativeNumber(safePayload.ambang_stok, 'Minimum stok');
	}
	if ('jumlah_beli_terakhir' in safePayload) {
		safePayload.jumlah_beli_terakhir = nonNegativeNumber(
			safePayload.jumlah_beli_terakhir,
			'Jumlah porsi'
		);
	}
	if ('tipe_satuan' in safePayload && safePayload.tipe_satuan !== undefined) {
		safePayload.tipe_satuan = String(safePayload.tipe_satuan).trim();
	}
	if ('isi_per_kemasan' in safePayload) {
		safePayload.isi_per_kemasan =
			nonNegativeNumber(safePayload.isi_per_kemasan, 'Isi kemasan') || 1;
	}
	if ('satuan_beli' in safePayload && safePayload.satuan_beli !== undefined) {
		safePayload.satuan_beli = safePayload.satuan_beli
			? String(safePayload.satuan_beli).trim()
			: null;
	}
	if ('yield_persen' in safePayload && safePayload.yield_persen !== undefined) {
		const parsedYield = Number(safePayload.yield_persen);
		safePayload.yield_persen = Number.isFinite(parsedYield)
			? Math.min(100, Math.max(1, parsedYield))
			: 100;
	}

	const costInputsChanged = ['jumlah_beli_terakhir', 'biaya_beli_terakhir', 'yield_persen'].some(
		(key) => key in safePayload
	);
	delete safePayload.biaya_per_satuan;
	if (costInputsChanged) {
		const purchaseQuantity = Number(
			safePayload.jumlah_beli_terakhir ?? current.jumlah_beli_terakhir
		);
		const purchaseCost = Number(safePayload.biaya_beli_terakhir ?? current.biaya_beli_terakhir);
		const yieldPercent = Number(safePayload.yield_persen ?? current.yield_persen ?? 100);
		safePayload.biaya_per_satuan = calculateEffectiveUnitCost(
			purchaseCost,
			purchaseQuantity,
			yieldPercent
		);
	}

	await db
		.update(bahan)
		.set(safePayload)
		.where(and(eq(bahan.cabang_id, branch), eq(bahan.id, String(id))));
	await publish(platform, branch, 'bahan', 'update', { id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'update', id, {
		fields: Object.keys(payload)
	});
	return { ok: true };
}

/**
 * Menghapus bahan dengan proteksi foreign key bila masih dipakai di resep_produk.
 */
export async function deleteBahanRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string
) {
	const used = await rawDb
		.prepare(`SELECT id FROM resep_produk WHERE cabang_id = ? AND bahan_id = ? LIMIT 1`)
		.bind(branch, id)
		.first();
	if (used) throw kitError(409, 'Bahan masih dipakai di resep menu');

	await db.delete(bahan).where(and(eq(bahan.cabang_id, branch), eq(bahan.id, id)));
	await publish(platform, branch, 'bahan', 'delete', { id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'delete', id);
	return { ok: true };
}

/**
 * Mengambil daftar riwayat mutasi stok bahan.
 */
export async function getBahanMutasiList(
	db: Database,
	branch: string,
	bahanId: string | null,
	limit: number
) {
	const filters: SQL[] = [eq(bahanMutasi.cabang_id, branch)];
	if (bahanId) filters.push(eq(bahanMutasi.bahan_id, bahanId));

	return db
		.select()
		.from(bahanMutasi)
		.where(and(...filters))
		.orderBy(desc(bahanMutasi.created_at))
		.limit(limit);
}

/**
 * Mencatat mutasi bahan dan memperbarui stok bahan saat ini secara atomik (batch D1).
 */
export async function recordBahanMutasi(
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	row: Record<string, unknown>
) {
	const bahanId = String(row.bahan_id || '');
	const quantityDelta = Number(row.delta_jumlah || 0);
	if (!bahanId || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
		throw kitError(400, 'Mutasi bahan tidak valid');
	}

	const item = (await rawDb
		.prepare(`SELECT id FROM bahan WHERE cabang_id = ? AND id = ? LIMIT 1`)
		.bind(branch, bahanId)
		.first()) as { id: string } | null;
	if (!item) throw kitError(404, 'Bahan tidak ditemukan');

	const now = new Date().toISOString();
	try {
		await rawDb.batch([
			rawDb
				.prepare(
					`UPDATE bahan
					 SET stok_saat_ini = COALESCE(stok_saat_ini, 0) + ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ?`
				)
				.bind(quantityDelta, now, branch, bahanId),
			rawDb
				.prepare(
					`INSERT INTO bahan_mutasi (
						id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber,
						referensi_id, catatan, dibuat_oleh, created_at
					)
					VALUES (
						?, ?, ?, ?,
						(SELECT stok_saat_ini FROM bahan WHERE cabang_id = ? AND id = ?),
						?, ?, ?, ?, ?
					)`
				)
				.bind(
					row.id,
					branch,
					bahanId,
					quantityDelta,
					branch,
					bahanId,
					String(row.source || 'manual'),
					row.referensi_id == null ? null : String(row.referensi_id),
					row.catatan == null ? null : String(row.catatan).slice(0, 160),
					session?.username || session?.userId || null,
					now
				)
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('CHECK') || message.includes('INSUFFICIENT_INGREDIENT')) {
			throw kitError(409, 'Stok bahan tidak mencukupi');
		}
		throw error;
	}

	await publish(platform, branch, 'bahan_mutasi', 'insert', { id: row.id as string });
	await publish(platform, branch, 'bahan', 'update', { id: bahanId });
	await auditDataChange(rawDb, branch, session, 'bahan_mutasi', 'insert', row.id as string, {
		bahan_id: bahanId,
		delta_jumlah: quantityDelta
	});

	return { ok: true, data: [row] };
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function getBahanMutasiListForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	bahanId: string | null,
	limit: number
) {
	return getBahanMutasiList(getDb(platform, branch), branch, bahanId, limit);
}

export async function recordBahanMutasiForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	row: Record<string, unknown>
) {
	const rawDb = getRawDb(platform, branch);
	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		throw kitError(
			409,
			'Mutasi stok manual dijeda. Gunakan alur rekonsiliasi untuk menyesuaikan stok.'
		);
	}
	return recordBahanMutasi(rawDb, branch, session, platform, row);
}

export function getBahanListForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	limit: number
) {
	return getBahanList(getDb(platform, branch), branch, limit);
}

export async function insertBahanRowsForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	rows: Array<Record<string, unknown>>
) {
	const rawDb = getRawDb(platform, branch);
	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		for (const row of rows) {
			const stokAwal = Number(row.stok_saat_ini ?? 0);
			if (Number.isFinite(stokAwal) && stokAwal !== 0) {
				throw kitError(409, 'Stok awal bahan harus 0 saat monitoring nonaktif');
			}
			if (row.ambang_stok !== undefined && row.ambang_stok !== null) {
				throw kitError(409, 'Ambang stok tidak dapat diatur saat monitoring nonaktif');
			}
			row.stok_saat_ini = 0;
		}
	}
	return insertBahanRows(getDb(platform, branch), rawDb, branch, session, platform, rows);
}

export async function updateBahanRowForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	id: string,
	payload: Record<string, unknown>
) {
	const rawDb = getRawDb(platform, branch);
	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		if ('stok_saat_ini' in payload || 'ambang_stok' in payload) {
			throw kitError(
				409,
				'Saldo stok hanya dapat diubah lewat rekonsiliasi saat monitoring nonaktif'
			);
		}
	}
	return updateBahanRow(getDb(platform, branch), rawDb, branch, session, platform, id, payload);
}

export function deleteBahanRowForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	id: string
) {
	return deleteBahanRow(
		getDb(platform, branch),
		getRawDb(platform, branch),
		branch,
		session,
		platform,
		id
	);
}
