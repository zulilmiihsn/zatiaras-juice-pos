import { createHash } from 'node:crypto';
import { decodeDecimalNumber } from '../src/lib/utils/currency.ts';
import { decodeReceiptSnapshot } from '../src/lib/utils/receiptSnapshot.ts';

/** @typedef {Record<string, unknown>} Row */
/** @typedef {{meta: {schema_version?: number, archive_id?: string, id?: string, branch?: string, counts?: {buku_kas: number, transaksi_kasir: number}}, buku_kas: Row[], transaksi_kasir?: Row[]}} Archive */

/**
 * Kontrak versi snapshot arsip. Writer kanonik
 * (src/lib/server/archiveSnapshot.ts ARCHIVE_SCHEMA_VERSION) hanya emit
 * versi terbaru. Decoder menerima 1-3; versi lebih baru DITOLAK sebelum
 * apply agar field baru (preparation/provenance/nomor/struk) tak hilang
 * diam-diam. Decoder era v2 (daftar [1, 2]) menolak v3 lewat gerbang sama.
 */
export const SUPPORTED_ARCHIVE_VERSIONS = [1, 2, 3];

/**
 * Peta field per versi: required harus ada; defaulted diisi seperti
 * fieldValue() bila arsip lama tak punya (tanpa mengarang histori).
 * Daftar kolom kanonik = BK_FIELDS/TK_FIELDS di bawah; exporter
 * (ARCHIVE_*_FIELDS di archiveSnapshot.ts) disamakan via tes.
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
	const flags = argv[0]?.startsWith('--') ? argv : argv.slice(2);
	/** @type {Map<string,string>} */ const values = new Map();
	/** @type {Set<string>} */ const modes = new Set();
	for (let i = 0; i < flags.length; i++) {
		const flag = flags[i];
		if (['--file', '--binding', '--expect-sha256', '--chunk-rows', '--persist-to'].includes(flag)) {
			const value = flags[++i];
			if (!value || value.startsWith('--') || values.has(flag))
				throw new Error(`Nilai ${flag} wajib tunggal`);
			values.set(flag, value);
		} else if (['--apply', '--dry-run', '--remote', '--local'].includes(flag)) modes.add(flag);
		else throw new Error(`Argumen tidak diizinkan: ${flag}`);
	}
	if (
		(modes.has('--apply') && modes.has('--dry-run')) ||
		(modes.has('--remote') && modes.has('--local')) ||
		(modes.has('--remote') && values.has('--persist-to'))
	)
		throw new Error('Mode restore bertentangan');
	return {
		file: values.get('--file') ?? null,
		apply: modes.has('--apply'),
		remote: modes.has('--remote'),
		binding: values.get('--binding') ?? null,
		expectSha256: values.get('--expect-sha256') ?? null,
		chunkRows: values.get('--chunk-rows') ?? null,
		persistTo: values.get('--persist-to') ?? null
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
	return decodeDecimalNumber(value) !== null;
}
/** @param {unknown} value @param {number} minimum */
function safeInteger(value, minimum = 0) {
	const number = decodeDecimalNumber(value);
	return number !== null && Number.isSafeInteger(number) && number >= minimum;
}
/** @param {unknown} value */
function identifier(value) {
	return (
		(typeof value === 'string' && value.trim() !== '') ||
		(typeof value === 'number' && safeInteger(value, 1))
	);
}
/** @param {unknown} value */
function validTimestamp(value) {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
			value
		)
	)
		return false;
	const day = value.slice(0, 10);
	const date = new Date(`${day}T00:00:00.000Z`);
	return (
		Number.isFinite(date.getTime()) &&
		date.toISOString().slice(0, 10) === day &&
		Number.isFinite(Date.parse(value)) &&
		(value.length === 10 || Number(value.slice(11, 13)) < 24)
	);
}
/** @param {Row} row @param {string[]} fields @param {string[]} errors */
function validateText(row, fields, errors) {
	for (const field of fields)
		if (row[field] != null && typeof row[field] !== 'string')
			errors.push(`Nilai ${field} row ${row.id} tidak valid`);
}
/** @param {Row} row @param {string[]} errors */
function validateDates(row, errors) {
	for (const field of ['created_at', 'updated_at', 'preparation_completed_at'])
		if (row[field] != null && !validTimestamp(row[field]))
			errors.push(`Tanggal ${field} row ${row.id} tidak valid`);
}
/** Compare only persisted fields; never recalculate from the current catalog. @param {Row} row @param {string[]} errors */
function validateLineAmounts(row, errors) {
	if (
		safeInteger(row.harga) &&
		safeInteger(row.jumlah, 1) &&
		safeInteger(row.nominal) &&
		BigInt(Number(row.harga)) * BigInt(Number(row.jumlah)) !== BigInt(Number(row.nominal))
	)
		errors.push(`Subtotal detail ${row.id ?? ''} tidak cocok dengan harga/jumlah`);
	if (
		safeInteger(row.harga_dasar) &&
		safeInteger(row.total_tambahan) &&
		safeInteger(row.harga) &&
		BigInt(Number(row.harga_dasar)) + BigInt(Number(row.total_tambahan)) !==
			BigInt(Number(row.harga))
	)
		errors.push(`Harga detail ${row.id ?? ''} tidak cocok dengan harga dasar/tambahan`);
}

/** @param {unknown} value */
function validCost(value) {
	const amount = decodeDecimalNumber(value);
	return amount !== null && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER;
}
/** @param {unknown} value @returns {value is Row} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is Row[]} */
function validAddOns(value) {
	return (
		Array.isArray(value) &&
		value.every(
			(addOn) =>
				record(addOn) &&
				typeof addOn.nama === 'string' &&
				addOn.nama.trim() !== '' &&
				safeInteger(addOn.harga) &&
				(addOn.id == null || typeof addOn.id === 'string')
		)
	);
}
/** @param {Row} row @param {string[]} errors */
function validateDetailSnapshots(row, errors) {
	if (row.snapshot_tambahan != null && typeof row.snapshot_tambahan === 'string') {
		try {
			/** @type {unknown} */ const parsed = JSON.parse(row.snapshot_tambahan);
			if (!validAddOns(parsed)) throw new Error('shape');
			const total = parsed.reduce((sum, addOn) => sum + BigInt(Number(addOn.harga)), 0n);
			if (
				row.total_tambahan != null &&
				safeInteger(row.total_tambahan) &&
				total !== BigInt(Number(row.total_tambahan))
			)
				throw new Error('sum');
		} catch {
			errors.push(`Snapshot snapshot_tambahan detail ${row.id} tidak valid`);
		}
	}
	if (row.snapshot_hpp != null && typeof row.snapshot_hpp === 'string') {
		try {
			/** @type {unknown} */ const parsed = JSON.parse(row.snapshot_hpp);
			// Legacy {total} and checkout {nominal_hpp,...} are explicit supported shapes, not arbitrary JSON.
			if (!record(parsed) || (parsed.total == null && parsed.nominal_hpp == null))
				throw new Error('shape');
			for (const field of ['total', 'nominal_hpp', 'hpp_per_item'])
				if (parsed[field] != null && !validCost(parsed[field])) throw new Error('cost');
			if (
				parsed.jumlah != null &&
				(!safeInteger(parsed.jumlah, 1) || Number(parsed.jumlah) !== Number(row.jumlah))
			)
				throw new Error('quantity');
			for (const field of ['product_id', 'product_name', 'porsi'])
				if (parsed[field] != null && typeof parsed[field] !== 'string') throw new Error('text');
			if (
				parsed.product_id != null &&
				row.produk_id != null &&
				parsed.product_id !== String(row.produk_id)
			)
				throw new Error('product');
			if (
				parsed.ingredients != null &&
				(!Array.isArray(parsed.ingredients) ||
					!parsed.ingredients.every(
						(ingredient) =>
							record(ingredient) &&
							identifier(ingredient.bahan_id) &&
							(ingredient.nama == null || typeof ingredient.nama === 'string') &&
							(ingredient.satuan == null || typeof ingredient.satuan === 'string') &&
							validCost(ingredient.jumlah_per_item) &&
							validCost(ingredient.biaya_per_satuan)
					))
			)
				throw new Error('ingredients');
			// The producer records base-recipe HPP before adding topping HPP; equality would reject valid sales.
			const baseCost = decodeDecimalNumber(parsed.nominal_hpp ?? parsed.total);
			if (
				baseCost !== null &&
				row.nominal_hpp != null &&
				validCost(row.nominal_hpp) &&
				baseCost > Number(row.nominal_hpp)
			)
				throw new Error('hpp exceeds detail');
		} catch {
			errors.push(`Snapshot snapshot_hpp detail ${row.id} tidak valid`);
		}
	}
}

/** @param {Row} row @param {string[]} errors */
function validateReceipt(row, errors) {
	if (row.receipt_snapshot == null) return; // Preserve explicitly unknown legacy content, never synthesize it.
	try {
		if (typeof row.receipt_snapshot !== 'string') throw new Error('type');
		/** @type {unknown} */ const raw = JSON.parse(row.receipt_snapshot);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('shape');
		const receipt = /** @type {Row} */ (raw);
		if (
			!safeInteger(receipt.total_amount) ||
			!safeInteger(receipt.total_qty, 1) ||
			!Array.isArray(receipt.items)
		)
			throw new Error('totals');
		let amount = 0n,
			quantity = 0n;
		for (const rawItem of receipt.items) {
			if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem))
				throw new Error('item');
			const item = /** @type {Row} */ (rawItem);
			if (!safeInteger(item.jumlah, 1) || !safeInteger(item.harga) || !safeInteger(item.nominal))
				throw new Error('item totals');
			for (const field of ['harga_dasar', 'total_tambahan'])
				if (item[field] != null && !safeInteger(item[field])) throw new Error('item amount');
			for (const field of ['product_id', 'nama', 'gula', 'es', 'catatan'])
				if (item[field] != null && typeof item[field] !== 'string') throw new Error('item text');
			if (item.tambahan != null) {
				if (!Array.isArray(item.tambahan)) throw new Error('addons');
				for (const rawAddon of item.tambahan) {
					if (!rawAddon || typeof rawAddon !== 'object' || Array.isArray(rawAddon))
						throw new Error('addon');
					const addon = /** @type {Row} */ (rawAddon);
					if (
						typeof addon.nama !== 'string' ||
						!addon.nama.trim() ||
						!safeInteger(addon.harga) ||
						(addon.id != null && typeof addon.id !== 'string')
					)
						throw new Error('addon fields');
				}
			}
			/** @type {string[]} */ const lineErrors = [];
			validateLineAmounts(item, lineErrors);
			if (lineErrors.length) throw new Error('line amounts');
			if (
				validAddOns(item.tambahan) &&
				safeInteger(item.total_tambahan) &&
				item.tambahan.reduce((sum, addOn) => sum + BigInt(Number(addOn.harga)), 0n) !==
					BigInt(Number(item.total_tambahan))
			)
				throw new Error('addon sum');
			// Both values have passed the integer machine-number boundary; BigInt prevents sum overflow.
			amount += BigInt(Number(item.nominal));
			quantity += BigInt(Number(item.jumlah));
		}
		if (
			amount !== BigInt(Number(receipt.total_amount)) ||
			quantity !== BigInt(Number(receipt.total_qty))
		)
			throw new Error('sum');
		for (const field of ['cash_received', 'change'])
			if (receipt[field] != null && !safeInteger(receipt[field])) throw new Error('cash');
		if (receipt.committed_at != null && !validTimestamp(receipt.committed_at))
			throw new Error('timestamp');
		if (receipt.customer_name != null && typeof receipt.customer_name !== 'string')
			throw new Error('customer');
		if (receipt.settings != null) {
			if (typeof receipt.settings !== 'object' || Array.isArray(receipt.settings))
				throw new Error('settings');
			const settings = /** @type {Row} */ (receipt.settings);
			for (const field of ['nama_toko', 'alamat', 'ucapan'])
				if (settings[field] != null && typeof settings[field] !== 'string')
					throw new Error('settings fields');
		}
		if (receipt.metode_bayar != null) {
			if (!['tunai', 'non-tunai', 'qris'].includes(String(receipt.metode_bayar)))
				throw new Error('payment');
			if (
				row.metode_bayar != null &&
				(receipt.metode_bayar === 'tunai') !== (row.metode_bayar === 'tunai')
			)
				throw new Error('payment header');
			if (
				receipt.metode_bayar === 'tunai' &&
				receipt.cash_received != null &&
				receipt.change != null &&
				BigInt(Number(receipt.cash_received)) - amount !== BigInt(Number(receipt.change))
			)
				throw new Error('cash change');
		}
		const decoded = decodeReceiptSnapshot(row.receipt_snapshot);
		if (
			!decoded ||
			decoded.total_amount !== decodeDecimalNumber(row.nominal) ||
			(row.jumlah != null && decoded.total_qty !== decodeDecimalNumber(row.jumlah))
		)
			throw new Error('header');
	} catch {
		errors.push(
			`Snapshot struk row ${row.id} tidak valid: shape/nominal/quantity/totals/tanggal tidak cocok`
		);
	}
}

/** Business preflight shared by JSON restore and SQL drill; no mutation/rounding/backfill here. @param {Row} row */
export function validateBukuKasBusiness(row) {
	/** @type {string[]} */ const fieldErrors = [];
	if (row.tipe !== 'in' && row.tipe !== 'out')
		fieldErrors.push(`Tipe kas row ${row.id} tidak valid`);
	if (
		typeof row.jenis !== 'string' ||
		!['pendapatan_usaha', 'beban_usaha', 'lainnya'].includes(row.jenis)
	)
		fieldErrors.push(`Jenis kas row ${row.id} tidak valid`);
	if (
		(row.tipe === 'in' && !['pendapatan_usaha', 'lainnya'].includes(String(row.jenis))) ||
		(row.tipe === 'out' && !['beban_usaha', 'lainnya'].includes(String(row.jenis)))
	)
		fieldErrors.push(`Pasangan tipe/jenis row ${row.id} tidak valid`);
	if (typeof row.sumber !== 'string' || !['pos', 'catat', 'stok'].includes(row.sumber))
		fieldErrors.push(`Sumber kas row ${row.id} tidak valid`);
	if (!validTimestamp(row.waktu)) fieldErrors.push(`Waktu kas row ${row.id} tidak valid`);
	if (!safeInteger(row.nominal))
		fieldErrors.push(`Nominal kas row ${row.id} tidak valid atau melebihi batas aman rupiah`);
	if (row.jumlah != null && !safeInteger(row.jumlah, row.sumber === 'pos' ? 1 : 0))
		fieldErrors.push(`Jumlah header row ${row.id} tidak valid`);
	if (
		row.metode_bayar != null &&
		!['tunai', 'non-tunai', 'qris'].includes(String(row.metode_bayar))
	)
		fieldErrors.push(`Metode bayar row ${row.id} tidak valid`);
	validateText(
		row,
		[
			'deskripsi',
			'nama_pelanggan',
			'metode_bayar',
			'transaction_id',
			'idempotency_key',
			'request_fingerprint',
			'id_sesi_toko',
			'preparation_completed_by'
		],
		fieldErrors
	);
	validateDates(row, fieldErrors);
	validateReceipt(row, fieldErrors);
	return fieldErrors;
}

/** @param {Row} row */
export function validateTransaksiKasirBusiness(row) {
	/** @type {string[]} */ const fieldErrors = [];
	if (!identifier(row.buku_kas_id)) fieldErrors.push(`Detail ${row.id} tanpa induk buku kas valid`);
	if (row.produk_id != null && !identifier(row.produk_id))
		fieldErrors.push(`Produk detail ${row.id} tidak valid`);
	if (!safeInteger(row.jumlah, 1)) fieldErrors.push(`Jumlah detail ${row.id} tidak valid`);
	if (!safeInteger(row.nominal)) fieldErrors.push(`Nominal detail ${row.id} tidak valid`);
	for (const field of ['harga', 'harga_dasar', 'total_tambahan'])
		if (row[field] != null && !safeInteger(row[field]))
			fieldErrors.push(`Nilai ${field} detail ${row.id} tidak valid`);
	if (
		row.nominal_hpp != null &&
		(!isFiniteNumber(row.nominal_hpp) ||
			Number(row.nominal_hpp) < 0 ||
			Number(row.nominal_hpp) > Number.MAX_SAFE_INTEGER)
	)
		fieldErrors.push(`Nilai nominal_hpp detail ${row.id} tidak valid`);
	validateText(
		row,
		[
			'nama_kustom',
			'nama_produk',
			'gula',
			'es',
			'catatan',
			'snapshot_tambahan',
			'snapshot_hpp',
			'transaction_id'
		],
		fieldErrors
	);
	validateDates(row, fieldErrors);
	validateLineAmounts(row, fieldErrors);
	validateDetailSnapshots(row, fieldErrors);
	return fieldErrors;
}

/** @param {Row} row @param {import('../src/lib/utils/receiptSnapshot.ts').ReceiptSnapshotItem} item @param {Row[] | null} addons */
function matchesReceiptLine(row, item, addons) {
	return (
		Number(row.jumlah) === item.jumlah &&
		Number(row.nominal) === item.nominal &&
		(row.harga == null || Number(row.harga) === item.harga) &&
		(row.harga_dasar == null || Number(row.harga_dasar) === item.harga_dasar) &&
		(row.total_tambahan == null || Number(row.total_tambahan) === item.total_tambahan) &&
		(row.produk_id == null ||
			item.product_id == null ||
			String(row.produk_id) === item.product_id) &&
		(row.nama_produk == null || row.nama_produk === item.nama) &&
		(addons === null ||
			matchOneToOne(
				addons,
				item.tambahan,
				(left, right) =>
					left.nama === right.nama &&
					Number(left.harga) === right.harga &&
					(left.id == null || right.id == null || left.id === right.id)
			)) &&
		['gula', 'es', 'catatan'].every(
			(field) =>
				row[field] == null || row[field] === item[/** @type {'gula' | 'es' | 'catatan'} */ (field)]
		)
	);
}

/** One-to-one matching, including ambiguous legacy NULLs, without recursion or an n² adjacency allocation.
 * @template L,R @param {L[]} rows @param {R[]} items @param {(left: L, right: R) => boolean} matches */
function matchOneToOne(rows, items, matches) {
	if (rows.length !== items.length) return false;
	const owners = Array.from(items, () => -1);
	const assigned = Array.from(rows, () => -1);
	for (let origin = 0; origin < rows.length; origin++) {
		const queue = [origin];
		const seenRows = new Set(queue);
		/** @type {Set<number>} */ const seenItems = new Set();
		/** @type {Map<number, number>} */ const parent = new Map();
		let found = false;
		for (let cursor = 0; cursor < queue.length && !found; cursor++) {
			let rowIndex = queue[cursor];
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				if (seenItems.has(itemIndex) || !matches(rows[rowIndex], items[itemIndex])) continue;
				seenItems.add(itemIndex);
				const owner = owners[itemIndex];
				if (owner < 0) {
					// Reassign the augmenting path so unknown legacy fields cannot steal a unique known match.
					while (true) {
						const previousItem = assigned[rowIndex];
						owners[itemIndex] = rowIndex;
						assigned[rowIndex] = itemIndex;
						if (rowIndex === origin) break;
						itemIndex = previousItem;
						const previousRow = parent.get(rowIndex);
						if (previousRow === undefined) throw new Error('matching path');
						rowIndex = previousRow;
					}
					found = true;
					break;
				}
				if (!seenRows.has(owner)) {
					seenRows.add(owner);
					parent.set(owner, rowIndex);
					queue.push(owner);
				}
			}
		}
		if (!found) return false;
	}
	return true;
}

/** @param {Row[]} rows @param {import('../src/lib/utils/receiptSnapshot.ts').ReceiptSnapshotItem[]} items */
function receiptLinesMatch(rows, items) {
	const prepared = rows.map((row) => {
		/** @type {Row[] | null} */ let addons = null;
		if (row.snapshot_tambahan != null) {
			const value = JSON.parse(String(row.snapshot_tambahan));
			if (!validAddOns(value)) throw new Error('addon shape');
			addons = value;
		}
		return { row, addons };
	});
	return matchOneToOne(prepared, items, (left, right) =>
		matchesReceiptLine(left.row, right, left.addons)
	);
}

/** Shared full-set invariants for JSON restore and SQL drill. @param {Row[]} headers @param {Row[]} details */
export function validateRestoreRelationships(headers, details) {
	/** @type {string[]} */ const errors = [];
	/** @type {Map<string, Row[]>} */ const byHeader = new Map();
	for (const detail of details) {
		const key = String(detail.buku_kas_id);
		const group = byHeader.get(key) ?? [];
		group.push(detail);
		byHeader.set(key, group);
	}
	for (const header of headers) {
		const group = byHeader.get(String(header.id)) ?? [];
		if (!group.length) {
			// Explicitly unknown legacy POS headers may lack details/quantity/receipt; do not invent them.
			if (header.sumber === 'pos' && (header.receipt_snapshot != null || header.jumlah != null))
				errors.push(`Detail POS row ${header.id} tidak cocok: detail transaksi hilang`);
			continue;
		}
		if (
			!safeInteger(header.nominal) ||
			!group.every((row) => safeInteger(row.nominal) && safeInteger(row.jumlah, 1))
		)
			continue;
		const amount = group.reduce((sum, row) => sum + BigInt(Number(row.nominal)), 0n);
		const quantity = group.reduce((sum, row) => sum + BigInt(Number(row.jumlah)), 0n);
		if (amount !== BigInt(Number(header.nominal)))
			errors.push(`Nominal header/detail row ${header.id} tidak cocok`);
		if (
			header.jumlah != null &&
			safeInteger(header.jumlah) &&
			quantity !== BigInt(Number(header.jumlah))
		)
			errors.push(`Jumlah header/detail row ${header.id} tidak cocok`);
		for (const row of group)
			if (
				header.transaction_id != null &&
				row.transaction_id != null &&
				header.transaction_id !== row.transaction_id
			)
				errors.push(`Identitas transaksi header/detail row ${header.id} tidak cocok`);
		if (header.receipt_snapshot == null) continue;
		try {
			const receipt = decodeReceiptSnapshot(header.receipt_snapshot);
			if (!receipt) continue;
			if (!receiptLinesMatch(group, receipt.items)) throw new Error('receipt detail multiset');
		} catch {
			errors.push(`Snapshot struk/detail row ${header.id} tidak cocok`);
		}
	}
	return errors;
}

/** @param {Archive} archive */
export function validateArchive(archive) {
	/** @type {string[]} */
	const errors = [];
	if (
		!archive ||
		typeof archive !== 'object' ||
		!record(archive.meta) ||
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
	const version = decodeDecimalNumber(
		archive.meta.schema_version === undefined ? 1 : archive.meta.schema_version
	);
	if (version === null || !SUPPORTED_ARCHIVE_VERSIONS.includes(version))
		errors.push('Versi arsip tidak didukung');
	if (
		!identifier(archive.meta.archive_id || archive.meta.id) ||
		(archive.meta.archive_id != null && !identifier(archive.meta.archive_id)) ||
		(archive.meta.id != null && !identifier(archive.meta.id))
	)
		errors.push('Identitas arsip wajib dan valid');
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
	if (version === 3 && archive.meta.counts == null) errors.push('Counts arsip v3 wajib lengkap');
	if (
		archive.meta.counts != null &&
		(!record(archive.meta.counts) ||
			archive.meta.counts.buku_kas !== buku_kas.length ||
			archive.meta.counts.transaksi_kasir !== transaksi_kasir.length)
	)
		errors.push('Counts arsip tidak cocok');
	const ids = new Set();
	const dailyNumbers = new Set();
	for (const row of buku_kas) {
		if (!row || !identifier(row.id) || ids.has(String(row.id))) {
			errors.push('ID buku kas invalid/duplikat');
			continue;
		}
		ids.add(String(row.id));
		if (row.cabang_id != null && row.cabang_id !== branch)
			errors.push(`Cabang row ${row.id} berbeda`);
		errors.push(...validateBukuKasBusiness(row));
		const dailyNumber = row.nomor_harian ?? null;
		const dailyDate = row.tanggal_nomor ?? null;
		if ((dailyNumber === null) !== (dailyDate === null))
			errors.push(`Pasangan nomor harian row ${row.id} tidak lengkap`);
		const parsedNumber = decodeDecimalNumber(dailyNumber);
		const validNumber =
			parsedNumber !== null && Number.isSafeInteger(parsedNumber) && parsedNumber > 0;
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
		if (
			policyMode !== null &&
			(typeof policyMode !== 'string' || !['tracked', 'ignored'].includes(policyMode))
		)
			errors.push(`Mode policy row ${row.id} tidak valid`);
		if (policyRevision !== null && !safeInteger(policyRevision))
			errors.push(`Revision policy row ${row.id} tidak valid`);
		if ((policyMode === null) !== (policyRevision === null))
			errors.push(`Pasangan policy row ${row.id} tidak lengkap`);
		if (
			row.stock_replay_disposition != null &&
			(typeof row.stock_replay_disposition !== 'string' ||
				![
					'normal',
					'stale_to_ignored',
					'owner_approved_current',
					'owner_approved_after_recount'
				].includes(row.stock_replay_disposition))
		)
			errors.push(`Disposisi replay row ${row.id} tidak valid`);
		const prepState = row.preparation_state ?? null;
		const prepRevision = row.preparation_revision ?? null;
		const prepAt = row.preparation_completed_at ?? null;
		const prepBy = row.preparation_completed_by ?? null;
		if (prepState !== null && !['pending', 'done'].includes(String(prepState)))
			errors.push(`Status persiapan row ${row.id} tidak valid`);
		if (prepRevision !== null && !safeInteger(prepRevision))
			errors.push(`Revision persiapan row ${row.id} tidak valid`);
		const isLegacyPrep = prepState === null && prepAt === null && prepBy === null;
		const isPendingPrep = prepState === 'pending' && prepAt === null && prepBy === null;
		const isDonePrep = prepState === 'done' && prepAt !== null && prepBy !== null;
		if (!(isLegacyPrep || isPendingPrep || isDonePrep))
			errors.push(`Pasangan persiapan row ${row.id} tidak lengkap`);
	}
	const detailIds = new Set();
	for (const row of transaksi_kasir) {
		if (!row || !identifier(row.id) || detailIds.has(String(row.id))) {
			errors.push('ID detail invalid/duplikat');
			continue;
		}
		detailIds.add(String(row.id));
		if (!ids.has(String(row.buku_kas_id))) errors.push(`Orphan detail ${row.id}`);
		if (row.cabang_id != null && row.cabang_id !== branch)
			errors.push(`Cabang detail ${row.id} berbeda`);
		errors.push(...validateTransaksiKasirBusiness(row));
	}
	errors.push(
		...validateRestoreRelationships(
			buku_kas.filter((row) => record(row) && identifier(row.id)),
			transaksi_kasir.filter((row) => record(row) && identifier(row.id))
		)
	);
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
	nomor_harian: true,
	stock_policy_revision: true
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

/**
 * Rencana restore murni: validasi penuh seluruh arsip sebelum SQL
 * apa pun dirakit. Satu-satunya perakit SQL adalah buildRestoreChunks.
 */
/** @param {Archive} archive @param {{sha256?: string, now?: string}} opts */
export function planRestore(archive, opts = {}) {
	const validated = validateArchive(archive);
	if (!validated.ok) throw new Error(validated.errors.join('; '));
	const { branch, buku_kas, transaksi_kasir } = validated;
	const archiveId = archive.meta.archive_id || archive.meta.id || '';
	const now = opts.now || new Date().toISOString();
	return { branch, archiveId, now, sha256: opts.sha256 || null, buku_kas, transaksi_kasir };
}

/** Staging is resumable; ONLY final.statements may mutate live tables, in one atomic batch.
 * @param {Archive} archive @param {{sha256?: string, now?: string}} opts @param {number} maxRows */
export function buildRestoreChunks(archive, opts = {}, maxRows = DEFAULT_RESTORE_CHUNK_ROWS) {
	const plan = planRestore(archive, opts);
	const { branch, archiveId, now, buku_kas, transaksi_kasir } = plan;
	if (!Number.isSafeInteger(maxRows) || maxRows < 1 || !validTimestamp(now))
		throw new Error('Konfigurasi staging tidak valid');
	const digest = opts.sha256 ?? sha256Hex(JSON.stringify(archive));
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Digest archive tidak valid');
	const jobId = sha256Hex(JSON.stringify([branch, archiveId]));
	const job = `id=${sqlVal(jobId)} AND cabang_id=${sqlVal(branch)} AND sha256=${sqlVal(digest)}`;
	const active = `EXISTS (SELECT 1 FROM archive_restore_jobs WHERE ${job} AND status='staging')`;
	const rowsWhere = `r.job_id=${sqlVal(jobId)} AND r.cabang_id=${sqlVal(branch)}`;
	/** @param {string} condition @param {string} reason */
	const guard = (condition, reason) =>
		`SELECT CASE WHEN (${condition}) THEN 1 ELSE json(${sqlVal(reason)}) END;`;
	const init = [
		`INSERT INTO archive_restore_jobs(id,cabang_id,archive_id,sha256,expected_bk,expected_tk,status,created_at) VALUES(${sqlVal(jobId)},${sqlVal(branch)},${sqlVal(archiveId)},${sqlVal(digest)},${buku_kas.length},${transaksi_kasir.length},'staging',${sqlVal(now)}) ON CONFLICT DO NOTHING;`,
		guard(
			`EXISTS (SELECT 1 FROM archive_restore_jobs WHERE ${job} AND archive_id=${sqlVal(archiveId)} AND expected_bk=${buku_kas.length} AND expected_tk=${transaksi_kasir.length})`,
			'RESTORE_SOURCE_CONFLICT'
		)
	];
	/** @param {string} table @param {string[]} fields @param {Row[]} rows */
	const staged = (table, fields, rows) =>
		rows.map((row) => ({
			kind: table,
			row_id: String(row.id),
			data_json: JSON.stringify({
				id: String(row.id),
				...Object.fromEntries(
					fields.map((field) => [field, field === 'cabang_id' ? branch : fieldValue(row, field)])
				),
				updated_at: row.updated_at ?? null
			})
		}));
	const entries = [
		...staged('buku_kas', BK_FIELDS, buku_kas),
		...staged('transaksi_kasir', TK_FIELDS, transaksi_kasir)
	];
	/** @type {Array<{index: number, rows: number, sql: string, statements: string[]}>} */ const chunks =
		[];
	/** @param {typeof entries} batch */
	function flush(batch) {
		// Force the bounded input outermost; scanning all staged rows per input row is quadratic.
		const render = () => {
			const input = `json_each(${sqlVal(JSON.stringify(batch))})`;
			const statements = [
				...init,
				guard(
					`NOT (${active}) OR NOT EXISTS (SELECT 1 FROM ${input} x CROSS JOIN archive_restore_rows r WHERE ${rowsWhere} AND r.kind=json_extract(x.value,'$.kind') AND r.row_id=json_extract(x.value,'$.row_id') AND r.data_json IS NOT json_extract(x.value,'$.data_json'))`,
					'RESTORE_STAGE_CONFLICT'
				),
				`INSERT INTO archive_restore_rows(job_id,cabang_id,kind,row_id,data_json) SELECT ${sqlVal(jobId)},${sqlVal(branch)},json_extract(value,'$.kind'),json_extract(value,'$.row_id'),json_extract(value,'$.data_json') FROM ${input} WHERE ${active} ON CONFLICT DO NOTHING;`
			];
			assertRestoreSqlBudget(statements);
			return statements;
		};
		render(); // Check every phase before any caller can start staging, without retaining its SQL.
		chunks.push({
			index: chunks.length,
			rows: batch.length,
			get statements() {
				return render();
			},
			get sql() {
				return render().join('\n');
			}
		});
	}
	/** @type {typeof entries} */ let batch = [];
	let bytes = 0;
	for (const entry of entries) {
		const size = Buffer.byteLength(sqlVal(JSON.stringify(entry)), 'utf8') + 2;
		if (size > MAX_RESTORE_SQL_BYTES - 4096)
			throw new Error(
				'RESTORE_BUDGET_BLOCKED: satu row melampaui budget staging; review ADR/owner, jangan partial apply'
			);
		if (batch.length && (batch.length >= maxRows || bytes + size > MAX_RESTORE_SQL_BYTES - 4096)) {
			flush(batch);
			batch = [];
			bytes = 0;
		}
		batch.push(entry);
		bytes += size;
	}
	if (batch.length || !chunks.length) flush(batch);
	/** @param {string} table */
	const source = (table) =>
		`archive_restore_rows r WHERE ${rowsWhere} AND r.kind=${sqlVal(table)} AND ${active}`;
	/** @type {Array<[string, string[]]>} */ const tables = [
		['buku_kas', BK_FIELDS],
		['transaksi_kasir', TK_FIELDS]
	];
	/** @param {string} field */ const value = (field) => `json_extract(r.data_json, '$.${field}')`;
	const final = [
		init[1],
		guard(
			`NOT (${active}) OR ((SELECT COUNT(*) FROM ${source('buku_kas')})=${buku_kas.length} AND (SELECT COUNT(*) FROM ${source('transaksi_kasir')})=${transaksi_kasir.length})`,
			'RESTORE_STAGE_INCOMPLETE'
		),
		guard(
			`NOT (${active}) OR NOT EXISTS (SELECT 1 FROM archive_jobs WHERE id=${sqlVal(archiveId)} AND cabang_id=${sqlVal(branch)} AND status NOT IN ('completed','restored'))`,
			'RESTORE_ARCHIVE_BUSY'
		)
	];
	for (const [table, fields] of tables) {
		final.push(
			guard(
				`NOT EXISTS (SELECT 1 FROM archive_restore_rows r JOIN ${table} t ON t.id=r.row_id WHERE ${rowsWhere} AND r.kind=${sqlVal(table)} AND ${active} AND NOT (${fields.map((field) => `t.${field} IS ${value(field)}`).join(' AND ')}))`,
				`RESTORE_CONFLICT:${table}`
			)
		);
	}
	final.push(
		guard(
			`NOT EXISTS (SELECT 1 FROM ${source('buku_kas')} AND ${value('sumber')}='pos' AND NOT EXISTS (SELECT 1 FROM ringkasan_penjualan_harian s WHERE s.cabang_id=${sqlVal(branch)} AND s.tanggal_penjualan=date(datetime(${value('waktu')},'+8 hours'))))`,
			'RESTORE_MISSING_POS_SUMMARY'
		)
	);
	final.push(
		guard(
			`NOT EXISTS (SELECT 1 FROM archive_restore_rows r CROSS JOIN archive_restore_rows h ON h.job_id=r.job_id AND h.cabang_id=r.cabang_id AND h.kind='buku_kas' AND h.row_id=${value('buku_kas_id')} WHERE ${rowsWhere} AND r.kind='transaksi_kasir' AND ${active} AND json_extract(h.data_json,'$.sumber')='pos' AND NOT EXISTS (SELECT 1 FROM penjualan_produk_harian s WHERE s.cabang_id=${sqlVal(branch)} AND s.tanggal_penjualan=date(datetime(COALESCE(${value('created_at')},json_extract(h.data_json,'$.waktu')),'+8 hours')) AND s.produk_id=COALESCE(${value('produk_id')},'custom:'||${value('nama_produk')})))`,
			'RESTORE_MISSING_PRODUCT_SUMMARY'
		)
	);
	final.push(
		`DELETE FROM ringkasan_kas_arsip_harian WHERE cabang_id=${sqlVal(branch)} AND archive_id=${sqlVal(archiveId)} AND ${active};`
	);
	for (const [table, fields] of tables) {
		const marker = table === 'buku_kas' ? ',restored_from_archive' : '';
		final.push(
			`INSERT INTO ${table}(id,${fields.join(',')},updated_at${marker}) SELECT r.row_id,${fields.map(value).join(',')},COALESCE(${value('updated_at')},(SELECT created_at FROM archive_restore_jobs WHERE ${job}))${marker ? ',1' : ''} FROM ${source(table)} AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.id=r.row_id);`
		);
	}
	final.push(
		`INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) SELECT ${sqlVal(branch)},${value('tanggal_nomor')},MAX(${value('nomor_harian')}) FROM ${source('buku_kas')} AND ${value('sumber')}='pos' AND ${value('nomor_harian')} IS NOT NULL GROUP BY ${value('tanggal_nomor')} ON CONFLICT(cabang_id,tanggal) DO UPDATE SET terakhir=MAX(pos_nomor_harian.terakhir,excluded.terakhir);`
	);
	final.push(
		`INSERT INTO pengaturan(id,cabang_id,kunci,nilai,updated_at) SELECT ${sqlVal(jobId)},${sqlVal(branch)},${sqlVal('archive_restore_' + archiveId)},json_object('archive_id',${sqlVal(archiveId)},'sha256',${sqlVal(digest)},'restored_at',created_at),created_at FROM archive_restore_jobs WHERE ${job} AND status='staging' ON CONFLICT(cabang_id,kunci) DO UPDATE SET nilai=excluded.nilai,updated_at=excluded.updated_at;`
	);
	final.push(
		`UPDATE archive_jobs SET status='restored',updated_at=(SELECT created_at FROM archive_restore_jobs WHERE ${job}) WHERE cabang_id=${sqlVal(branch)} AND id=${sqlVal(archiveId)} AND status='completed' AND ${active};`
	);
	final.push(
		`UPDATE archive_restore_jobs SET status='completed',committed_at=created_at WHERE ${job} AND status='staging';`
	);
	final.push(
		`DELETE FROM archive_restore_rows WHERE job_id=${sqlVal(jobId)} AND cabang_id=${sqlVal(branch)} AND EXISTS (SELECT 1 FROM archive_restore_jobs WHERE ${job} AND status='completed');`
	);
	assertRestoreSqlBudget(final);
	return {
		chunks,
		totalRows: entries.length,
		branch,
		archiveId,
		jobId,
		sha256: digest,
		final: { statements: final, sql: final.join('\n') }
	};
}

export const MAX_RESTORE_SQL_BYTES = 90_000;
/** @param {string[]} statements */
function assertRestoreSqlBudget(statements) {
	if (statements.some((sql) => Buffer.byteLength(sql, 'utf8') > MAX_RESTORE_SQL_BYTES))
		throw new Error('RESTORE_BUDGET_BLOCKED: SQL melampaui budget; review ADR/owner');
}

/** Default baris per chunk: jauh di bawah batas variabel SQLite (999) dan budget batch D1. */
/** @type {number} */
export const DEFAULT_RESTORE_CHUNK_ROWS = 100;
