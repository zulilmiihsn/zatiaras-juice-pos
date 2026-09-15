import { and, asc, desc, eq, gte, like, lt, lte, gt, or, sql, type SQL } from 'drizzle-orm';
import { bukuKas } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { toCursorPage } from '$lib/server/dataPagination';
import { sanitizeUpdatePayload } from '$lib/server/resourceRouteHelpers';
import { containsPosLedger, POS_LEDGER_ROUTE_MESSAGE } from '$lib/server/ledgerPolicy';
import { newMutationToken, batchClaimChanges } from '$lib/server/ledgerCas';
import { error as kitError } from '@sveltejs/kit';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

export interface BukuKasFilter {
	startTime?: string | null;
	endTime?: string | null;
	sumber?: string | null;
	tipe?: string | null;
	id?: string | null;
	transactionId?: string | null;
	idSesiToko?: string | null;
	/** 'asc' default lama; 'desc' untuk riwayat terbaru dulu. */
	direction?: string | null;
	search?: string | null;
	metode?: string | null;
}

/**
 * Mengambil daftar data buku_kas dengan filter dan opsi cursor pagination.
 */
export async function getBukuKasList(
	db: Database,
	branch: string,
	filter: BukuKasFilter,
	limit: number,
	cursor: { sortValue: string; id: string } | null,
	cursorPagination: boolean
) {
	const rows = await getBukuKasQuery(db, branch, filter, limit, cursor, cursorPagination);
	if (!cursorPagination) return { rows, isPage: false as const };
	return {
		page: toCursorPage(rows, limit, (row) => ({ sortValue: row.waktu, id: String(row.id) })),
		isPage: true as const
	};
}

/**
 * Query inti buku_kas dipakai GET biasa + cursor pagination.
 * Filter search/metode/tanggal diterapkan SEBELUM limit di server.
 * direction 'desc' = terbaru dulu (waktu DESC, id DESC); default 'asc' lama.
 */
async function getBukuKasQuery(
	db: Database,
	branch: string,
	filter: BukuKasFilter,
	limit: number,
	cursor: { sortValue: string; id: string } | null,
	cursorPagination: boolean
) {
	const descDir = filter.direction === 'desc';
	const filters: SQL[] = [eq(bukuKas.cabang_id, branch)];
	if (filter.startTime) filters.push(gte(bukuKas.waktu, filter.startTime));
	if (filter.endTime) filters.push(lte(bukuKas.waktu, filter.endTime));
	if (filter.sumber) filters.push(eq(bukuKas.sumber, filter.sumber));
	if (filter.tipe) filters.push(eq(bukuKas.tipe, filter.tipe));
	if (filter.id) filters.push(eq(bukuKas.id, filter.id));
	if (filter.transactionId) filters.push(eq(bukuKas.transaction_id, filter.transactionId));
	if (filter.idSesiToko) filters.push(eq(bukuKas.id_sesi_toko, filter.idSesiToko));
	if (filter.metode) {
		if (filter.metode === 'tunai') filters.push(eq(bukuKas.metode_bayar, 'tunai'));
		else if (filter.metode === 'qris' || filter.metode === 'non-tunai')
			filters.push(or(eq(bukuKas.metode_bayar, 'qris'), eq(bukuKas.metode_bayar, 'non-tunai'))!);
	}
	if (filter.search) {
		const q = `%${filter.search}%`;
		filters.push(or(like(bukuKas.deskripsi, q), like(bukuKas.nama_pelanggan, q))!);
	}
	if (cursor) {
		filters.push(
			descDir
				? or(
						lt(bukuKas.waktu, cursor.sortValue),
						and(eq(bukuKas.waktu, cursor.sortValue), lt(bukuKas.id, cursor.id))
					)!
				: or(
						gt(bukuKas.waktu, cursor.sortValue),
						and(eq(bukuKas.waktu, cursor.sortValue), gt(bukuKas.id, cursor.id))
					)!
		);
	}

	return db
		.select()
		.from(bukuKas)
		.where(and(...filters))
		.orderBy(
			...(descDir ? [desc(bukuKas.waktu), desc(bukuKas.id)] : [asc(bukuKas.waktu), asc(bukuKas.id)])
		)
		.limit(cursorPagination ? limit + 1 : limit);
}

/**
 * Menyisipkan baris buku_kas dengan verifikasi ledger policy dan deduplikasi id.
 */
export async function insertBukuKasRows(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	rows: Array<Record<string, unknown>>
) {
	if (containsPosLedger(rows)) throw kitError(409, POS_LEDGER_ROUTE_MESSAGE);
	for (const row of rows) {
		for (const k of ['revision', 'mutation_token']) delete (row as Record<string, unknown>)[k];
	}

	// Dedup by id
	const newRows: Array<Record<string, unknown>> = [];
	for (const row of rows) {
		const existing = await rawDb
			.prepare('SELECT id FROM buku_kas WHERE cabang_id = ? AND id = ? LIMIT 1')
			.bind(branch, String(row.id))
			.first();
		if (!existing) newRows.push(row);
	}
	if (newRows.length === 0) {
		return { ok: true, data: rows, duplicate: true };
	}

	await db.insert(bukuKas).values(newRows as (typeof bukuKas.$inferInsert)[]);
	await publish(platform, branch, 'buku_kas', 'insert', {
		id: newRows[0]?.id as string | undefined,
		transaction_id: newRows[0]?.transaction_id as string | undefined
	});
	await auditDataChange(
		rawDb,
		branch,
		session,
		'buku_kas',
		'insert',
		newRows[0]?.id as string | number | null | undefined,
		{
			count: newRows.length,
			transaction_id: newRows[0]?.transaction_id
		}
	);
	return { ok: true, data: rows };
}

/**
 * Memperbarui baris buku_kas secara atomik, termasuk penyesuaian ringkasan harian jika transaksi POS.
 */
export async function updateBukuKasRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string,
	payload: Record<string, unknown>
) {
	const existing = (await rawDb
		.prepare(
			'SELECT id, sumber, transaction_id, nominal, waktu, metode_bayar, revision FROM buku_kas WHERE cabang_id = ? AND id = ? LIMIT 1'
		)
		.bind(branch, String(id))
		.first()) as {
		id: string;
		sumber?: string;
		transaction_id?: string;
		nominal?: number;
		waktu?: string;
		metode_bayar?: string;
		revision?: number | null;
	} | null;
	if (!existing) throw kitError(404, 'Entri buku kas tidak ditemukan');

	const isPos = String(existing.sumber || '').toLowerCase() === 'pos';
	const payloadKeys = Object.keys(payload).filter((k) => k !== 'updated_at');
	const isOnlyUpdatingPaymentMethod = payloadKeys.length === 1 && payloadKeys[0] === 'metode_bayar';

	if (isPos && !isOnlyUpdatingPaymentMethod) {
		throw kitError(409, POS_LEDGER_ROUTE_MESSAGE);
	}
	if (containsPosLedger([payload])) {
		throw kitError(409, POS_LEDGER_ROUTE_MESSAGE);
	}

	if (isPos && isOnlyUpdatingPaymentMethod) {
		const oldMethod =
			String(existing.metode_bayar || '').toLowerCase() === 'tunai' ? 'tunai' : 'non-tunai';
		const newMethod =
			String(payload.metode_bayar || '').toLowerCase() === 'tunai' ? 'tunai' : 'non-tunai';

		if (oldMethod === newMethod) return { ok: true, duplicate: true };
		if (existing.transaction_id) {
			const siblings = (await rawDb
				.prepare(
					`SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id = ? AND transaction_id = ? AND sumber = 'pos'`
				)
				.bind(branch, existing.transaction_id)
				.first()) as { n?: number } | null;
			if (Number(siblings?.n ?? 1) > 1) throw kitError(409, 'Transaksi legacy tidak konsisten');
		}
		const expectedRevision = Number(existing.revision ?? 0);
		const mutationToken = newMutationToken();
		const now = new Date().toISOString();
		const guardArgs = [branch, existing.id, mutationToken] as const;
		const statements = [
			rawDb
				.prepare(
					`UPDATE buku_kas SET metode_bayar = ?, revision = revision + 1, mutation_token = ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ? AND sumber = 'pos' AND revision = ?`
				)
				.bind(newMethod, mutationToken, now, branch, existing.id, expectedRevision)
		];

		const gross = Number(existing.nominal || 0);
		const salesDateRow = (await rawDb
			.prepare("SELECT date(datetime(?, '+8 hours')) AS tanggal_penjualan")
			.bind(existing.waktu || now)
			.first()) as { tanggal_penjualan?: string } | null;
		const salesDate = salesDateRow?.tanggal_penjualan;
		const guardSql = `AND EXISTS (SELECT 1 FROM buku_kas WHERE cabang_id = ? AND id = ? AND mutation_token = ?)`;

		if (salesDate && gross > 0) {
			if (newMethod === 'non-tunai') {
				statements.push(
					rawDb
						.prepare(
							`UPDATE ringkasan_penjualan_harian SET
								penjualan_tunai = MAX(0, penjualan_tunai - ?),
								penjualan_nontunai = penjualan_nontunai + ?,
								updated_at = ?
							WHERE cabang_id = ? AND tanggal_penjualan = ? ${guardSql}`
						)
						.bind(gross, gross, now, branch, salesDate, ...guardArgs)
				);
			} else {
				statements.push(
					rawDb
						.prepare(
							`UPDATE ringkasan_penjualan_harian SET
								penjualan_nontunai = MAX(0, penjualan_nontunai - ?),
								penjualan_tunai = penjualan_tunai + ?,
								updated_at = ?
							WHERE cabang_id = ? AND tanggal_penjualan = ? ${guardSql}`
						)
						.bind(gross, gross, now, branch, salesDate, ...guardArgs)
				);
			}

			if (existing.transaction_id) {
				const products =
					(
						(await rawDb
							.prepare(
								`SELECT COALESCE(produk_id, 'custom:' || nama_produk) AS produk_id,
									COALESCE(SUM(nominal), 0) AS gross
							 FROM transaksi_kasir
							 WHERE cabang_id = ? AND transaction_id = ?
							 GROUP BY COALESCE(produk_id, 'custom:' || nama_produk)`
							)
							.bind(branch, existing.transaction_id)
							.all()) as { results?: Array<{ produk_id?: string; gross?: number }> }
					).results || [];

				for (const p of products) {
					if (!p.produk_id) continue;
					const itemGross = Number(p.gross || 0);
					if (newMethod === 'non-tunai') {
						statements.push(
							rawDb
								.prepare(
									`UPDATE penjualan_produk_harian SET
										penjualan_tunai = MAX(0, penjualan_tunai - ?),
										penjualan_nontunai = penjualan_nontunai + ?,
										updated_at = ?
									WHERE cabang_id = ? AND tanggal_penjualan = ? AND produk_id = ? ${guardSql}`
								)
								.bind(itemGross, itemGross, now, branch, salesDate, p.produk_id, ...guardArgs)
						);
					} else {
						statements.push(
							rawDb
								.prepare(
									`UPDATE penjualan_produk_harian SET
										penjualan_nontunai = MAX(0, penjualan_nontunai - ?),
										penjualan_tunai = penjualan_tunai + ?,
										updated_at = ?
									WHERE cabang_id = ? AND tanggal_penjualan = ? AND produk_id = ? ${guardSql}`
								)
								.bind(itemGross, itemGross, now, branch, salesDate, p.produk_id, ...guardArgs)
						);
					}
				}
			}
		}

		const batchResults = (await rawDb.batch(statements)) as unknown;
		if (batchClaimChanges(batchResults) === 0) {
			const reread = (await rawDb
				.prepare(`SELECT metode_bayar FROM buku_kas WHERE cabang_id = ? AND id = ? LIMIT 1`)
				.bind(branch, existing.id)
				.first()) as { metode_bayar?: string } | null;
			const currentMethod =
				String(reread?.metode_bayar || '').toLowerCase() === 'tunai' ? 'tunai' : 'non-tunai';
			if (reread && currentMethod === newMethod) return { ok: true, duplicate: true };
			throw kitError(409, 'Transaksi berubah bersamaan. Muat ulang lalu coba lagi.');
		}

		await publish(platform, branch, 'buku_kas', 'update', {
			id,
			transaction_id: existing.transaction_id
		});
		if (existing.transaction_id) {
			await publish(platform, branch, 'transaksi_kasir', 'update', {
				transaction_id: existing.transaction_id
			});
		}
		await auditDataChange(rawDb, branch, session, 'buku_kas', 'update_metode_bayar', id, {
			transaction_id: existing.transaction_id,
			from: oldMethod,
			to: newMethod
		});
		return { ok: true };
	}

	const manualPayload = sanitizeUpdatePayload(payload as Partial<typeof bukuKas.$inferInsert>);
	for (const k of ['revision', 'mutation_token'])
		delete (manualPayload as Record<string, unknown>)[k];
	// Increment atomik satu statement (bukan snapshot+1) agar dua update tak berbagi versi.
	await db
		.update(bukuKas)
		.set({ ...manualPayload, revision: sql`revision + 1`, updated_at: new Date().toISOString() })
		.where(and(eq(bukuKas.cabang_id, branch), eq(bukuKas.id, String(id))));
	await publish(platform, branch, 'buku_kas', 'update', { id });
	await auditDataChange(rawDb, branch, session, 'buku_kas', 'update', id, {
		fields: Object.keys(payload)
	});
	return { ok: true };
}

/**
 * Menghapus satu baris buku_kas berdasarkan id.
 */
export async function deleteBukuKasRow(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	id: string
) {
	const existing = (await rawDb
		.prepare('SELECT id, sumber FROM buku_kas WHERE cabang_id = ? AND id = ? LIMIT 1')
		.bind(branch, String(id))
		.first()) as { id: string; sumber?: string } | null;
	if (!existing) throw kitError(404, 'Entri buku kas tidak ditemukan');
	if (containsPosLedger([existing])) throw kitError(409, POS_LEDGER_ROUTE_MESSAGE);

	await db.delete(bukuKas).where(and(eq(bukuKas.cabang_id, branch), eq(bukuKas.id, String(id))));
	await publish(platform, branch, 'buku_kas', 'delete', { id });
	await auditDataChange(rawDb, branch, session, 'buku_kas', 'delete', id);
	return { ok: true };
}

/**
 * Menghapus semua baris buku_kas berdasarkan transaction_id.
 */
export async function deleteBukuKasByTransaction(
	db: Database,
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	transactionId: string
) {
	const existing = ((
		await rawDb
			.prepare('SELECT id, sumber FROM buku_kas WHERE cabang_id = ? AND transaction_id = ?')
			.bind(branch, transactionId)
			.all()
	).results || []) as Array<{ id: string; sumber?: string }>;
	if (existing.length === 0) throw kitError(404, 'Entri buku kas tidak ditemukan');
	if (containsPosLedger(existing)) throw kitError(409, POS_LEDGER_ROUTE_MESSAGE);

	await db
		.delete(bukuKas)
		.where(and(eq(bukuKas.cabang_id, branch), eq(bukuKas.transaction_id, transactionId)));
	await publish(platform, branch, 'buku_kas', 'delete', { transaction_id: transactionId });
	await auditDataChange(rawDb, branch, session, 'buku_kas', 'delete_by_transaction', null, {
		transaction_id: transactionId
	});
	return { ok: true };
}
