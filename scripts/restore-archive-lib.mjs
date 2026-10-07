import { createHash, randomUUID } from 'node:crypto';

/** @typedef {Record<string, unknown>} Row */
/** @typedef {{meta: {schema_version?: number, archive_id?: string, id?: string, branch?: string, counts?: {buku_kas: number, transaksi_kasir: number}}, buku_kas: Row[], transaksi_kasir?: Row[]}} Archive */

/**
 * Kontrak versi snapshot arsip (AUD-041). Writer kanonik
 * (src/lib/server/archiveUseCase.ts ARCHIVE_SCHEMA_VERSION) hanya emit
 * versi terbaru. Decoder menerima 1-3; versi lebih baru DITOLAK sebelum
 * apply agar field baru (preparation/provenance/nomor/struk) tak hilang
 * diam-diam. Decoder era v2 (daftar [1, 2]) menolak v3 lewat gerbang sama.
 */
export const SUPPORTED_ARCHIVE_VERSIONS = [1, 2, 3];

/**
 * Peta field per versi: required harus ada; defaulted diisi seperti
 * fieldValue() bila arsip lama tak punya (tanpa mengarang histori).
 * Daftar kolom kanonik = BK_FIELDS/TK_FIELDS di bawah; exporter
 * (ARCHIVE_*_FIELDS di archiveUseCase.ts) disamakan via tes.
 */
export const ARCHIVE_VERSION_CONTRACT = {
	1: {
		note: 'Legacy: kolom bisnis inti; preparation/nomor/policy/receipt default.',
		required: ['id'],
		defaulted: ['preparation_state', 'preparation_revision', 'nomor_harian', 'tanggal_nomor']
	},
	2: {
		note: 'Nomor harian + preparation + policy + receipt snapshot.',
		required: ['id'],
		defaulted: ['preparation_revision', 'total_tambahan', 'nominal_hpp']
	},
	3: {
		note: 'Versi kanonik penuh: semua field bisnis/stok/pesanan eksplisit.',
		required: ['id'],
		defaulted: ['preparation_revision', 'total_tambahan', 'nominal_hpp']
	}
};

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

/** @param {unknown} value */
function isFiniteNumber(value) {
	return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
		? Number.isFinite(Number(value))
		: false;
}

/** @param {Row} row */
function validateBukuKasBusiness(row) {
	/** @type {string[]} */
	const fieldErrors = [];
	if (row.tipe !== 'in' && row.tipe !== 'out')
		fieldErrors.push(`Tipe kas row ${row.id} tidak valid`);
	if (!['pendapatan_usaha', 'beban_usaha', 'lainnya'].includes(String(row.jenis)))
		fieldErrors.push(`Jenis kas row ${row.id} tidak valid`);
	if (
		(row.tipe === 'in' && !['pendapatan_usaha', 'lainnya'].includes(String(row.jenis))) ||
		(row.tipe === 'out' && !['beban_usaha', 'lainnya'].includes(String(row.jenis)))
	)
		fieldErrors.push(`Pasangan tipe/jenis row ${row.id} tidak valid`);
	if (!['pos', 'catat', 'stok'].includes(String(row.sumber)))
		fieldErrors.push(`Sumber kas row ${row.id} tidak valid`);
	if (typeof row.waktu !== 'string' || !Number.isFinite(Date.parse(row.waktu)))
		fieldErrors.push(`Waktu kas row ${row.id} tidak valid`);
	if (!isFiniteNumber(row.nominal) || Number(row.nominal) < 0)
		fieldErrors.push(`Nominal kas row ${row.id} tidak valid`);
	if (isFiniteNumber(row.nominal) && Number(row.nominal) > Number.MAX_SAFE_INTEGER)
		fieldErrors.push(`Nominal kas row ${row.id} melebihi batas aman`);
	if (
		row.metode_bayar !== null &&
		row.metode_bayar !== undefined &&
		!['tunai', 'non-tunai', 'qris'].includes(String(row.metode_bayar))
	)
		fieldErrors.push(`Metode bayar row ${row.id} tidak valid`);
	if (row.receipt_snapshot !== null && row.receipt_snapshot !== undefined) {
		try {
			JSON.parse(String(row.receipt_snapshot));
		} catch {
			fieldErrors.push(`Snapshot struk row ${row.id} tidak valid`);
		}
	}
	return fieldErrors;
}

/** @param {Row} row */
function validateTransaksiKasirBusiness(row) {
	/** @type {string[]} */
	const fieldErrors = [];
	if (!row.buku_kas_id) fieldErrors.push(`Detail ${row.id} tanpa induk buku kas`);
	if (!isFiniteNumber(row.jumlah) || Number(row.jumlah) <= 0)
		fieldErrors.push(`Jumlah detail ${row.id} tidak valid`);
	if (!isFiniteNumber(row.nominal) || Number(row.nominal) < 0)
		fieldErrors.push(`Nominal detail ${row.id} tidak valid`);
	for (const field of ['harga', 'harga_dasar', 'total_tambahan', 'nominal_hpp']) {
		const value = row[field];
		if (value !== null && value !== undefined && (!isFiniteNumber(value) || Number(value) < 0))
			fieldErrors.push(`Nilai ${field} detail ${row.id} tidak valid`);
	}
	return fieldErrors;
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
	if (!SUPPORTED_ARCHIVE_VERSIONS.includes(Number(archive.meta.schema_version || 1)))
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
	const dailyNumbers = new Set();
	for (const row of buku_kas) {
		if (!row || !row.id || ids.has(String(row.id))) {
			errors.push('ID buku kas invalid/duplikat');
			continue;
		}
		ids.add(String(row.id));
		if (row.cabang_id && row.cabang_id !== branch) errors.push(`Cabang row ${row.id} berbeda`);
		errors.push(...validateBukuKasBusiness(row));
		const dailyNumber = row.nomor_harian ?? null;
		const dailyDate = row.tanggal_nomor ?? null;
		if ((dailyNumber === null) !== (dailyDate === null))
			errors.push(`Pasangan nomor harian row ${row.id} tidak lengkap`);
		const parsedNumber =
			typeof dailyNumber === 'number' ||
			(typeof dailyNumber === 'string' && dailyNumber.trim() !== '')
				? Number(dailyNumber)
				: NaN;
		const validNumber = Number.isSafeInteger(parsedNumber) && parsedNumber > 0;
		if (dailyNumber !== null && !validNumber) errors.push(`Nomor harian row ${row.id} tidak valid`);
		const parsedDate =
			typeof dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dailyDate)
				? new Date(`${dailyDate}T00:00:00.000Z`)
				: null;
		const validDate =
			parsedDate !== null &&
			Number.isFinite(parsedDate.getTime()) &&
			parsedDate.toISOString().slice(0, 10) === dailyDate;
		if (dailyDate !== null && !validDate) errors.push(`Tanggal nomor row ${row.id} tidak valid`);
		if (dailyNumber !== null && row.sumber !== 'pos')
			errors.push(`Nomor harian row ${row.id} hanya untuk POS`);
		if (validNumber && validDate) {
			const tuple = `${branch}/${dailyDate}/${parsedNumber}`;
			if (dailyNumbers.has(tuple)) errors.push(`Nomor harian duplikat dalam arsip: ${tuple}`);
			dailyNumbers.add(tuple);
		}
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
		const prepState = row.preparation_state ?? null;
		const prepRevision = row.preparation_revision ?? null;
		const prepAt = row.preparation_completed_at ?? null;
		const prepBy = row.preparation_completed_by ?? null;
		if (prepState !== null && !['pending', 'done'].includes(String(prepState)))
			errors.push(`Status persiapan row ${row.id} tidak valid`);
		if (
			prepRevision !== null &&
			(!Number.isInteger(Number(prepRevision)) || Number(prepRevision) < 0)
		)
			errors.push(`Revision persiapan row ${row.id} tidak valid`);
		const isLegacyPrep = prepState === null && prepAt === null && prepBy === null;
		const isPendingPrep = prepState === 'pending' && prepAt === null && prepBy === null;
		const isDonePrep = prepState === 'done' && prepAt !== null && prepBy !== null;
		if (!(isLegacyPrep || isPendingPrep || isDonePrep))
			errors.push(`Pasangan persiapan row ${row.id} tidak lengkap`);
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
		errors.push(...validateTransaksiKasirBusiness(row));
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
	'nomor_harian',
	'tanggal_nomor',
	'stock_policy_mode',
	'stock_policy_revision',
	'stock_replay_disposition',
	'preparation_state',
	'preparation_revision',
	'preparation_completed_at',
	'preparation_completed_by',
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
/** @type {Record<string, true>} */
const NUMERIC_FIELDS = {
	nominal: true,
	jumlah: true,
	harga: true,
	harga_dasar: true,
	total_tambahan: true,
	nominal_hpp: true,
	preparation_revision: true,
	nomor_harian: true
};

/** @param {Row} row @param {string} field */
function fieldValue(row, field) {
	let value = row[field];
	if (value === undefined || value === null) {
		if (field === 'preparation_revision') return 0;
		if (['total_tambahan', 'nominal_hpp'].includes(field)) return 0;
		return null;
	}
	return NUMERIC_FIELDS[field] ? Number(value) : value;
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
	// Restore preserves official numbers and only advances their allocator high-water mark.
	/** @type {Map<string, number>} */
	const dailyMaxima = new Map();
	for (const row of buku_kas) {
		if (row.sumber !== 'pos' || row.nomor_harian == null) continue;
		const date = String(row.tanggal_nomor);
		const number = Number(fieldValue(row, 'nomor_harian'));
		dailyMaxima.set(date, Math.max(dailyMaxima.get(date) ?? 0, number));
	}
	for (const [date, number] of dailyMaxima) {
		lines.push(
			`INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES(${sqlVal(branch)},${sqlVal(date)},${sqlVal(number)}) ON CONFLICT(cabang_id,tanggal) DO UPDATE SET terakhir=MAX(pos_nomor_harian.terakhir,excluded.terakhir);`
		);
	}
	lines.push(
		`INSERT INTO pengaturan(id,cabang_id,kunci,nilai,updated_at) VALUES(${sqlVal(randomUUID())},${sqlVal(branch)},${sqlVal('archive_restore_' + archiveId)},${sqlVal(JSON.stringify({ restored_at: now, archive_id: archiveId, sha256: opts.sha256 || null }))},${sqlVal(now)}) ON CONFLICT(cabang_id,kunci) DO UPDATE SET nilai=excluded.nilai,updated_at=excluded.updated_at;`
	);
	lines.push(
		`UPDATE archive_jobs SET status='restored',updated_at=${sqlVal(now)} WHERE cabang_id=${sqlVal(branch)} AND id=${sqlVal(archiveId)} AND status='completed';`
	);
	lines.push('COMMIT;');
	return { sql: lines.join('\n'), statements: lines.slice(2, -1), branch, archiveId };
}
