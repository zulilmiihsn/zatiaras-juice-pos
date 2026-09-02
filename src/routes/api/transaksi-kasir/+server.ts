import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { buildDailySummaryReversalStatements } from '$lib/server/dailySummary';
import { hasDatabaseColumn } from '$lib/server/schemaCapabilities';
import { decodeDataCursor, parseDataLimit, toCursorPage } from '$lib/server/dataPagination';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import type { RequestHandler } from './$types';

/**
 * /api/transaksi-kasir — Resource route untuk tabel `transaksi_kasir` (item transaksi POS).
 * Menggantikan dispatch dari /api/data?table=transaksi_kasir.
 * Invariant KRITIS:
 *   1. GET pakai raw SQL + deteksi kolom snapshot opsional (migrasi skema bertahap).
 *      Cursor pagination pada (created_at, id).
 *   2. POST menolak insert POS (sumber='pos' atau insert apa pun ke tabel ini) → 409,
 *      arahkan ke /api/pos/transaction (yang juga maintain tabel agregat harian).
 *   3. DELETE by transaction_id: reverse ringkasan, restore stok, dan hapus
 *      transaksi dalam satu batch atomik. Semua kegagalan membatalkan void.
 * RBAC: insert → kasir/pemilik (tapi POS diblokir lihat di atas); delete → pemilik.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const rawDb = getRawDb(platform, branch);
	const startTime = url.searchParams.get('start');
	const endTime = url.searchParams.get('end');
	const id = url.searchParams.get('id');
	const transactionId = url.searchParams.get('transaction_id');
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const cursor = decodeDataCursor(url.searchParams.get('cursor'));
	const cursorPagination = url.searchParams.get('pagination') === 'cursor' || cursor !== null;

	const filters = ['cabang_id = ?'];
	const values: unknown[] = [branch];
	if (startTime) {
		filters.push('created_at >= ?');
		values.push(startTime);
	}
	if (endTime) {
		filters.push('created_at <= ?');
		values.push(endTime);
	}
	if (id) {
		filters.push('id = ?');
		values.push(id);
	}
	if (transactionId) {
		filters.push('transaction_id = ?');
		values.push(transactionId);
	}
	if (cursor) {
		filters.push('(created_at > ? OR (created_at = ? AND id > ?))');
		values.push(cursor.sortValue, cursor.sortValue, cursor.id);
	}
	const bukuKasIdsParam = url.searchParams.get('buku_kas_ids');
	if (bukuKasIdsParam) {
		const ids = bukuKasIdsParam.split(',').filter(Boolean);
		if (ids.length) {
			filters.push(`buku_kas_id IN (${ids.map(() => '?').join(',')})`);
			values.push(...ids);
		}
	}

	// [CATATAN]: Deteksi apakah kolom snapshot sudah ada (migrasi skema bertahap antar-DB).
	const hasSnapshots = await hasDatabaseColumn(rawDb, branch, 'transaksi_kasir', 'nama_produk');
	const snapshotSelect = hasSnapshots
		? `nama_produk, harga_dasar, total_tambahan, snapshot_tambahan, gula, es, catatan, snapshot_hpp, nominal_hpp`
		: `NULL AS nama_produk, NULL AS harga_dasar, 0 AS total_tambahan, NULL AS snapshot_tambahan,
			NULL AS gula, NULL AS es, NULL AS catatan, NULL AS snapshot_hpp, 0 AS nominal_hpp`;
	const rows = await rawDb
		.prepare(
			`SELECT
				id, cabang_id, buku_kas_id, produk_id, nama_kustom, jumlah, nominal, harga,
				${snapshotSelect},
				transaction_id, created_at, updated_at
			 FROM transaksi_kasir
			 WHERE ${filters.join(' AND ')}
				 ORDER BY created_at ASC, id ASC
				 LIMIT ?`
		)
		.bind(...values, cursorPagination ? limit + 1 : limit)
		.all();
	const data = (rows.results || []) as Array<{ id: string; created_at: string }>;
	if (!cursorPagination) return json(data);
	return json(
		toCursorPage(data, limit, (row) => ({ sortValue: row.created_at, id: String(row.id) }))
	);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	// [CATATAN]: Blokir: transaksi POS harus lewat /api/pos/transaction (yang juga maintain agregat harian).
	throw kitError(409, 'Transaksi POS harus lewat /api/pos/transaction');
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const transactionId = url.searchParams.get('transaction_id');
	if (!transactionId) throw kitError(400, 'transaction_id diperlukan');

	const rawDb = getRawDb(platform, branch);

	// [CATATAN]: P0-4: kumpulkan apa yang harus DIKEMBALIKAN sebelum baris dihapus.
	// [CATATAN]: Stok produk: dari item POS (jumlah per produk, hanya yang lacak_stok).
	const itemRows = ((
		await rawDb
			.prepare(
				`SELECT produk_id, jumlah FROM transaksi_kasir WHERE cabang_id = ? AND transaction_id = ?`
			)
			.bind(branch, transactionId)
			.all()
	).results || []) as Array<{ produk_id: string | null; jumlah: number }>;
	if (itemRows.length === 0) throw kitError(404, 'Transaksi POS tidak ditemukan');

	const summaryReversal = await buildDailySummaryReversalStatements(rawDb, branch, transactionId);
	if (!summaryReversal.found) {
		throw kitError(409, 'Transaksi POS tidak konsisten dengan buku kas');
	}

	// [CATATAN]: Stok bahan: balikkan PERSIS mutasi yang ditulis checkout (bukan re-compute resep
	// [CATATAN]: yang bisa sudah berubah). Kegagalan query harus membatalkan seluruh void.
	const mutasiRows = ((
		await rawDb
			.prepare(
				`SELECT bahan_id, delta_jumlah FROM bahan_mutasi
				 WHERE cabang_id = ? AND referensi_id = ? AND sumber = 'pos_transaction'`
			)
			.bind(branch, transactionId)
			.all()
	).results || []) as Array<{ bahan_id: string; delta_jumlah: number }>;

	const now = new Date().toISOString();
	const actor = session.username || session.userId;
	const statements = [...summaryReversal.statements];

	for (const it of itemRows) {
		if (!it.produk_id) continue;
		statements.push(
			rawDb
				.prepare(
					`UPDATE produk SET stok = COALESCE(stok, 0) + ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ? AND lacak_stok = 1`
				)
				.bind(it.jumlah, now, branch, it.produk_id)
		);
	}

	for (const m of mutasiRows) {
		const restore = -m.delta_jumlah; // delta checkout negatif → kembalikan positif
		statements.push(
			rawDb
				.prepare(
					`UPDATE bahan SET stok_saat_ini = COALESCE(stok_saat_ini, 0) + ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ?`
				)
				.bind(restore, now, branch, m.bahan_id)
		);
		statements.push(
			rawDb
				.prepare(
					`INSERT INTO bahan_mutasi (
						id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber,
						referensi_id, catatan, dibuat_oleh, created_at
					)
					VALUES (?, ?, ?, ?,
						(SELECT stok_saat_ini FROM bahan WHERE cabang_id = ? AND id = ?),
						'void', ?, ?, ?, ?)`
				)
				.bind(
					crypto.randomUUID(),
					branch,
					m.bahan_id,
					restore,
					branch,
					m.bahan_id,
					transactionId,
					`Void transaksi ${transactionId}`.slice(0, 160),
					actor,
					now
				)
		);
	}

	// [CATATAN]: P0-5: hapus item + kas dalam SATU batch (atomik) — bukan dua HTTP non-atomik.
	statements.push(
		rawDb
			.prepare(`DELETE FROM transaksi_kasir WHERE cabang_id = ? AND transaction_id = ?`)
			.bind(branch, transactionId)
	);
	statements.push(
		rawDb
			.prepare(`DELETE FROM buku_kas WHERE cabang_id = ? AND transaction_id = ?`)
			.bind(branch, transactionId)
	);

	await rawDb.batch(statements);

	await publish(platform, branch, 'transaksi_kasir', 'delete', { transaction_id: transactionId });
	await publish(platform, branch, 'buku_kas', 'delete', { transaction_id: transactionId });
	await auditDataChange(rawDb, branch, session, 'transaksi_kasir', 'void', null, {
		transaction_id: transactionId,
		restored_products: itemRows.length,
		restored_bahan: mutasiRows.length
	});
	return json({ ok: true });
};
