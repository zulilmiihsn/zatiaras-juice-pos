/**
 * Pembacaan satu chunk arsip: pemilihan baris yang muat di budget byte snapshot, lalu
 * pembacaan isinya secara atomik. Hanya baca; tidak mengubah data apa pun.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import {
	ArchiveUseCaseError,
	type ArchiveRow,
	ARCHIVE_BUKU_KAS_FIELDS,
	ARCHIVE_TRANSAKSI_KASIR_FIELDS
} from './archiveSnapshot';

/**
 * Budget chunk arsip: maksimal 1000 header per
 * chunk, snapshot ≤2MB per objek R2, maksimal 3 chunk per panggilan Worker
 * (recall melanjutkan otomatis karena row terarsip hilang dari eligibility).
 * ID per chunk dikirim sebagai satu parameter JSON (json_each), jadi ukuran
 * chunk tak dibatasi 100 bind-param D1 maupun jumlah statement batch.
 * Dulu 50 header/1MB/10 chunk: setahun 500 transaksi/hari = ±3.650 file
 * dan ±365 panggilan.
 */
export const ARCHIVE_CHUNK_HEADERS = 1000;
export const ARCHIVE_CHUNK_MAX_BYTES = 2_000_000;
export const ARCHIVE_MAX_CHUNKS_PER_CALL = 3;

export interface ArchiveChunkCursor {
	waktu: string;
	id: string;
}

// SQLite sizes escaped TEXT without transferring it. Numeric transport/JSON differences
// fit 32 bytes per IEEE-754 scalar; raw numbers are still fetched, never SQL-JSON decoded.
function archiveRowReadBytes(alias: string, fields: readonly string[]): string {
	return `(${2 + fields.reduce((n, field) => n + field.length + 4, 0)} + ${fields
		.map((field) => {
			const column = `${alias}.${field}`;
			return `(CASE WHEN typeof(${column}) = 'blob' OR length(CAST(${column} AS BLOB)) > ${ARCHIVE_CHUNK_MAX_BYTES}
			THEN ${ARCHIVE_CHUNK_MAX_BYTES + 1}
			WHEN typeof(${column}) IN ('integer', 'real') THEN 32
			ELSE length(CAST(json_quote(${column}) AS BLOB)) END)`;
		})
		.join(' + ')})`;
}

function archiveGroupReadBytes(): string {
	return `(${archiveRowReadBytes('bk', [...ARCHIVE_BUKU_KAS_FIELDS, 'revision'])}
		+ ${archiveRowReadBytes('bk', ['id', 'transaction_id', 'revision'])}
		+ COALESCE((SELECT SUM(${archiveRowReadBytes('tk', ARCHIVE_TRANSAKSI_KASIR_FIELDS)})
			FROM transaksi_kasir tk WHERE tk.cabang_id = bk.cabang_id AND tk.buku_kas_id = bk.id), 0))`;
}

/** Compact locators first; guarded atomic payload reads prevent a preflight/growth race. */
export async function readArchiveChunk(
	rawDb: D1Database,
	branch: BranchContext,
	cutoff: string,
	cursor: ArchiveChunkCursor | null,
	limit: number
): Promise<{
	bukuKas: ArchiveRow[];
	transaksiKasir: Array<Record<string, unknown>>;
	hasMore: boolean;
}> {
	const cursorSql = cursor ? 'AND ((bk.waktu > ?) OR (bk.waktu = ? AND bk.id > ?))' : '';
	const cursorBinds = cursor ? [cursor.waktu, cursor.waktu, cursor.id] : [];
	const groupBytes = archiveGroupReadBytes();
	const detailCount = `(SELECT COUNT(*) FROM transaksi_kasir tk
		WHERE tk.cabang_id = bk.cabang_id AND tk.buku_kas_id = bk.id)`;
	const compact = await rawDb
		.prepare(
			`SELECT CAST(bk.rowid AS TEXT) AS row_key,
		${groupBytes} AS bytes, ${detailCount} AS detail_count
		FROM buku_kas bk WHERE bk.cabang_id = ? AND bk.waktu < ? ${cursorSql}
		ORDER BY bk.waktu ASC, bk.id ASC LIMIT ?`
		)
		.bind(branch, cutoff, ...cursorBinds, limit + 1)
		.all<{ row_key: string; bytes: number; detail_count: number }>();
	const selected: Array<{ rowKey: string; bytes: number; detailCount: number }> = [];
	let usedBytes = 4096; // Bounded v3 metadata, array punctuation and job/key fields.
	for (const row of compact.results) {
		if (selected.length === limit) break;
		if (
			!/^-?\d{1,20}$/.test(row.row_key) ||
			!Number.isSafeInteger(row.bytes) ||
			row.bytes < 0 ||
			!Number.isSafeInteger(row.detail_count) ||
			row.detail_count < 0 ||
			usedBytes + row.bytes > ARCHIVE_CHUNK_MAX_BYTES
		) {
			if (selected.length > 0) break;
			throw new ArchiveUseCaseError(
				413,
				'Transaksi melebihi batas ukuran satu snapshot arsip. Pengarsipan dibatalkan tanpa membaca seluruh isi atau menghapus data transaksi ini; perlu review operator.'
			);
		}
		selected.push({ rowKey: row.row_key, bytes: row.bytes, detailCount: row.detail_count });
		usedBytes += row.bytes;
	}
	if (selected.length === 0) return { bukuKas: [], transaksiKasir: [], hasMore: false };
	// Materialize only the guarded locators, not fields. The same D1 transaction owns
	// both payload SELECTs, so no huge detail can arrive between the header/detail reads.
	// CROSS JOIN memaksa SQLite memulai dari baris terpilih (<= limit)
	// lalu lookup per rowid/indeks. Dengan JOIN biasa planner memindai semua
	// baris terkualifikasi cabang di tiap chunk (O(n) per chunk, O(n^2) per tahun).
	const guarded = `WITH selected AS MATERIALIZED (
		SELECT bk.rowid AS row_key FROM json_each(?) chosen CROSS JOIN buku_kas bk
		ON bk.rowid = CAST(json_extract(chosen.value, '$.rowKey') AS INTEGER)
		WHERE bk.cabang_id = ? AND bk.waktu < ? ${cursorSql}
		AND ${groupBytes} <= json_extract(chosen.value, '$.bytes')
		AND ${detailCount} = json_extract(chosen.value, '$.detailCount'))`;
	const selection = JSON.stringify(selected);
	const [headers, details] = await rawDb.batch<Record<string, unknown>>([
		rawDb
			.prepare(
				`${guarded} SELECT ${[...ARCHIVE_BUKU_KAS_FIELDS, 'revision'].map((f) => `bk.${f}`).join(', ')}
			FROM selected CROSS JOIN buku_kas bk ON bk.rowid = selected.row_key
			WHERE bk.cabang_id = ? ORDER BY bk.waktu ASC, bk.id ASC`
			)
			.bind(selection, branch, cutoff, ...cursorBinds, branch),
		rawDb
			.prepare(
				`${guarded} SELECT ${ARCHIVE_TRANSAKSI_KASIR_FIELDS.map((f) => `tk.${f}`).join(', ')}
			FROM selected CROSS JOIN buku_kas bk ON bk.rowid = selected.row_key
			CROSS JOIN transaksi_kasir tk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
			WHERE tk.cabang_id = ? ORDER BY tk.id ASC`
			)
			.bind(selection, branch, cutoff, ...cursorBinds, branch)
	]);
	if (
		headers.results.length !== selected.length ||
		details.results.length !== selected.reduce((n, row) => n + row.detailCount, 0)
	) {
		throw new ArchiveUseCaseError(
			409,
			'Data arsip berubah bersamaan sebelum pembacaan. Coba lagi setelah memeriksa transaksi.'
		);
	}
	return {
		bukuKas: headers.results as ArchiveRow[],
		transaksiKasir: details.results,
		hasMore: compact.results.length > selected.length
	};
}
