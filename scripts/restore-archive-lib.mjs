import { createHash, randomUUID } from 'node:crypto';

/** @typedef {Record<string, unknown>} Row */
/** @typedef {{meta: {schema_version?: number, archive_id?: string, id?: string, branch?: string, counts?: {buku_kas: number, transaksi_kasir: number}}, buku_kas: Row[], transaksi_kasir?: Row[]}} Archive */

/** @param {string[]} argv */
export function parseRestoreArgs(argv) {
	/** @param {string} name */
	const at = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : null;
	};
	return {
		file: at('--file'),
		apply: argv.includes('--apply') && !argv.includes('--dry-run'),
		remote: argv.includes('--remote'),
		binding: at('--binding'),
		expectSha256: at('--expect-sha256')
	};
}

/** @param {string} content */
export function sha256Hex(content) {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** @param {unknown} value */
export function sqlVal(value) {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Non-finite archive number');
		return String(value);
	}
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replace(/'/g, "''")}'`;
}

/** @param {Archive} archive */
export function validateArchive(archive) {
	/** @type {string[]} */
	const errors = [];
	if (
		!archive ||
		typeof archive !== 'object' ||
		!archive.meta ||
		!Array.isArray(archive.buku_kas)
	) {
		return {
			ok: false,
			errors: ['Missing meta / buku_kas'],
			branch: '',
			buku_kas: [],
			transaksi_kasir: []
		};
	}
	const branch = archive.meta.branch || '';
	if (!['samarinda', 'samarinda2', 'balikpapan', 'balikpapan2', 'berau'].includes(branch))
		errors.push('Cabang arsip tidak valid');
	if (![1, 2].includes(Number(archive.meta.schema_version || 1)))
		errors.push('Versi arsip tidak didukung');
	if (!(archive.meta.archive_id || archive.meta.id)) errors.push('Identitas arsip wajib');
	const buku_kas = archive.buku_kas;
	const transaksi_kasir = archive.transaksi_kasir ?? [];
	if (!Array.isArray(transaksi_kasir))
		return {
			ok: false,
			errors: ['transaksi_kasir harus array'],
			branch,
			buku_kas,
			transaksi_kasir: []
		};
	if (
		archive.meta.counts &&
		(archive.meta.counts.buku_kas !== buku_kas.length ||
			archive.meta.counts.transaksi_kasir !== transaksi_kasir.length)
	)
		errors.push('Counts arsip tidak cocok');
	const ids = new Set();
	for (const row of buku_kas) {
		if (!row || !row.id || ids.has(String(row.id))) {
			errors.push('ID buku kas invalid/duplikat');
			continue;
		}
		ids.add(String(row.id));
		if (row.cabang_id && row.cabang_id !== branch) errors.push(`Cabang row ${row.id} berbeda`);
		const policyMode = row.stock_policy_mode ?? null;
		const policyRevision = row.stock_policy_revision ?? null;
		if (policyMode !== null && !['tracked', 'ignored'].includes(String(policyMode)))
			errors.push(`Mode policy row ${row.id} tidak valid`);
		if (
			policyRevision !== null &&
			(!Number.isInteger(Number(policyRevision)) || Number(policyRevision) < 0)
		)
			errors.push(`Revision policy row ${row.id} tidak valid`);
		if ((policyMode === null) !== (policyRevision === null))
			errors.push(`Pasangan policy row ${row.id} tidak lengkap`);
		if (
			row.stock_replay_disposition != null &&
			![
				'normal',
				'stale_to_ignored',
				'owner_approved_current',
				'owner_approved_after_recount'
			].includes(String(row.stock_replay_disposition))
		)
			errors.push(`Disposisi replay row ${row.id} tidak valid`);
	}
	const detailIds = new Set();
	for (const row of transaksi_kasir) {
		if (!row || !row.id || detailIds.has(String(row.id))) {
			errors.push('ID detail invalid/duplikat');
			continue;
		}
		detailIds.add(String(row.id));
		if (!ids.has(String(row.buku_kas_id))) errors.push(`Orphan detail ${row.id}`);
		if (row.cabang_id && row.cabang_id !== branch) errors.push(`Cabang detail ${row.id} berbeda`);
	}
	return { ok: errors.length === 0, errors, branch, buku_kas, transaksi_kasir };
}

// Compare all restored business values. Operational revision/token and updated_at
// are not transaction content; legacy missing values use the same defaults as INSERT.
export const BK_FIELDS = [
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
	'stock_policy_mode',
	'stock_policy_revision',
	'stock_replay_disposition',
	'id_sesi_toko',
	'created_at'
];
export const TK_FIELDS = [
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
];
const NUMERIC_FIELDS = new Set([
	'nominal',
	'jumlah',
	'harga',
	'harga_dasar',
	'total_tambahan',
	'nominal_hpp'
]);

/** @param {Row} row @param {string} field */
function fieldValue(row, field) {
	const value = row[field] ?? (['total_tambahan', 'nominal_hpp'].includes(field) ? 0 : null);
	return value !== null && NUMERIC_FIELDS.has(field) ? Number(value) : value;
}

/** @param {Row[]} snapshotRows @param {Map<string, Row>} existingById @param {string[]} fields */
export function diffAgainstExisting(snapshotRows, existingById, fields) {
	/** @type {Row[]} */ const skip = [];
	/** @type {{id: unknown, expected: Row, actual: Row}[]} */ const conflict = [];
	/** @type {Row[]} */ const insert = [];
	for (const row of snapshotRows) {
		const current = existingById.get(String(row.id));
		if (!current) insert.push(row);
		else if (fields.every((field) => fieldValue(current, field) === fieldValue(row, field)))
			skip.push(row);
		else conflict.push({ id: row.id, expected: row, actual: current });
	}
	return { skip, conflict, insert };
}

/** @param {Archive} archive @param {{sha256?: string}} opts */
export function buildRestoreSql(archive, opts = {}) {
	const validated = validateArchive(archive);
	if (!validated.ok) throw new Error(validated.errors.join('; '));
	const { branch, buku_kas, transaksi_kasir } = validated;
	const archiveId = archive.meta.archive_id || archive.meta.id || '';
	const now = new Date().toISOString();
	const lines = ['-- ZatiarasPOS Archive Restore Transaction', 'BEGIN TRANSACTION;'];
	// Failing SQL assertion aborts the enclosing D1/SQLite transaction BEFORE cleanup.
	// SQLite json() is used to raise an error without persistent guard tables/triggers.
	/** @param {string} condition @param {string} code */
	const guard = (condition, code) =>
		lines.push(`SELECT CASE WHEN (${condition}) THEN 1 ELSE json(${sqlVal(code)}) END;`);
	/** @param {string} table @param {Row[]} rows @param {string[]} fields */
	function assertUnchanged(table, rows, fields) {
		for (const row of rows) {
			const normalized = { ...row, cabang_id: row.cabang_id || branch };
			const same = fields.map((f) => `${f} IS ${sqlVal(fieldValue(normalized, f))}`).join(' AND ');
			guard(
				`NOT EXISTS (SELECT 1 FROM ${table} WHERE id = ${sqlVal(row.id)} AND NOT (${same}))`,
				`RESTORE_CONFLICT:${table}:${row.id}`
			);
		}
	}
	assertUnchanged('buku_kas', buku_kas, BK_FIELDS);
	assertUnchanged('transaksi_kasir', transaksi_kasir, TK_FIELDS);
	for (const row of buku_kas.filter((r) => r.sumber === 'pos')) {
		const date = `date(datetime(${sqlVal(row.waktu)}, '+8 hours'))`;
		guard(
			`EXISTS (SELECT 1 FROM ringkasan_penjualan_harian WHERE cabang_id=${sqlVal(branch)} AND tanggal_penjualan=${date})`,
			'RESTORE_MISSING_POS_SUMMARY'
		);
	}
	for (const row of transaksi_kasir) {
		const header = buku_kas.find((h) => h.id === row.buku_kas_id);
		if (header?.sumber !== 'pos') continue;
		const productId = row.produk_id ?? `custom:${row.nama_produk}`;
		guard(
			`EXISTS (SELECT 1 FROM penjualan_produk_harian WHERE cabang_id=${sqlVal(branch)} AND tanggal_penjualan=date(datetime(${sqlVal(row.created_at || header.waktu)}, '+8 hours')) AND produk_id=${sqlVal(productId)})`,
			'RESTORE_MISSING_PRODUCT_SUMMARY'
		);
	}
	lines.push(
		`DELETE FROM ringkasan_kas_arsip_harian WHERE cabang_id=${sqlVal(branch)} AND archive_id=${sqlVal(archiveId)};`
	);
	/** @param {string} table @param {Row[]} rows @param {string[]} fields */
	function insertRows(table, rows, fields) {
		for (const row of rows) {
			const normalized = { ...row, cabang_id: row.cabang_id || branch };
			const restoredMarker = table === 'buku_kas' ? ['restored_from_archive'] : [];
			const columns = ['id', ...fields, ...restoredMarker, 'updated_at'];
			const values = [
				row.id,
				...fields.map((f) => fieldValue(normalized, f)),
				...(table === 'buku_kas' ? [1] : []),
				row.updated_at || now
			];
			lines.push(
				`INSERT INTO ${table} (${columns.join(',')}) SELECT ${values.map(sqlVal).join(',')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE id=${sqlVal(row.id)});`
			);
		}
	}
	insertRows('buku_kas', buku_kas, BK_FIELDS);
	insertRows('transaksi_kasir', transaksi_kasir, TK_FIELDS);
	lines.push(
		`INSERT INTO pengaturan(id,cabang_id,kunci,nilai,updated_at) VALUES(${sqlVal(randomUUID())},${sqlVal(branch)},${sqlVal('archive_restore_' + archiveId)},${sqlVal(JSON.stringify({ restored_at: now, archive_id: archiveId, sha256: opts.sha256 || null }))},${sqlVal(now)}) ON CONFLICT(cabang_id,kunci) DO UPDATE SET nilai=excluded.nilai,updated_at=excluded.updated_at;`
	);
	lines.push(
		`UPDATE archive_jobs SET status='restored',updated_at=${sqlVal(now)} WHERE cabang_id=${sqlVal(branch)} AND id=${sqlVal(archiveId)} AND status='completed';`
	);
	lines.push('COMMIT;');
	return { sql: lines.join('\n'), statements: lines.slice(2, -1), branch, archiveId };
}
