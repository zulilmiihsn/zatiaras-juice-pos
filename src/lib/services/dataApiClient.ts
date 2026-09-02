import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { parseApiError } from '$lib/utils/errorHandling';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { refreshBus } from '$lib/utils/refreshBus';

export type DataRecord = Record<string, unknown>;

export type DataPage<T> = {
	data: T[];
	nextCursor: string | null;
	hasMore: boolean;
};

export type DataMutationResult<T extends DataRecord = DataRecord> = {
	ok: boolean;
	data?: T[];
	duplicate?: boolean;
};

const PAGE_SIZE = 200;
const MAX_ACCUMULATED_ROWS = 50_000;

function currentBranch(): string {
	return selectedBranch.value || 'default';
}

async function parseError(response: Response, operation: string): Promise<Error> {
	const detail = await parseApiError(response, `HTTP ${response.status}`);
	return new Error(`${operation} gagal: ${detail}`);
}

function isDataRecord(value: unknown): value is DataRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRows<T extends DataRecord>(value: unknown, operation: string): T[] {
	if (!Array.isArray(value) || !value.every(isDataRecord)) {
		throw new Error(`${operation} gagal: format respons data tidak valid`);
	}
	return value as T[];
}

function parsePage<T extends DataRecord>(value: unknown, operation: string): DataPage<T> {
	if (!isDataRecord(value)) throw new Error(`${operation} gagal: format halaman tidak valid`);
	const data = parseRows<T>(value.data, operation);
	if (value.nextCursor !== null && typeof value.nextCursor !== 'string') {
		throw new Error(`${operation} gagal: cursor tidak valid`);
	}
	if (typeof value.hasMore !== 'boolean') {
		throw new Error(`${operation} gagal: status pagination tidak valid`);
	}
	return { data, nextCursor: value.nextCursor, hasMore: value.hasMore };
}

function parseMutation<T extends DataRecord>(
	value: unknown,
	operation: string
): DataMutationResult<T> {
	if (!isDataRecord(value) || typeof value.ok !== 'boolean') {
		throw new Error(`${operation} gagal: format respons mutasi tidak valid`);
	}
	let data: T[] | undefined;
	if (value.data !== undefined) {
		if (isDataRecord(value.data)) data = [value.data as T];
		else if (Array.isArray(value.data) && value.data.every(isDataRecord)) data = value.data as T[];
		else throw new Error(`${operation} gagal: data mutasi tidak valid`);
	}
	if (value.duplicate !== undefined && typeof value.duplicate !== 'boolean') {
		throw new Error(`${operation} gagal: status duplikat tidak valid`);
	}
	return {
		ok: value.ok,
		data,
		duplicate: value.duplicate as boolean | undefined
	};
}

// [CATATAN]: ─── Table → per-resource URL map ────────────────────────────────────────
// [CATATAN]: Resource route RESTful pengganti god endpoint /api/data.
// [CATATAN]: Tambahkan entry di sini saat tabel baru ditambahkan.

const READ_ROUTES = {
	produk: '/api/produk',
	kategori: '/api/kategori',
	tambahan: '/api/tambahan',
	bahan: '/api/bahan',
	resep_produk: '/api/resep-produk',
	bahan_mutasi: '/api/bahan-mutasi',
	hpp_settings: '/api/hpp-settings',
	buku_kas: '/api/buku-kas',
	transaksi_kasir: '/api/transaksi-kasir',
	sesi_toko: '/api/sesi-toko',
	pengaturan: '/api/pengaturan',
	// [CATATAN]: Virtual reads (aggregate/dashboard)
	dashboard_stats: '/api/dashboard/stats',
	weekly_income_summary: '/api/dashboard/weekly',
	best_sellers_summary: '/api/dashboard/best-sellers',
	pos_kas_7hari: '/api/dashboard/pos-kas-7hari',
	laporan_aggregate: '/api/reports/aggregate'
} as const;

const WRITE_ROUTES = {
	produk: '/api/produk',
	kategori: '/api/kategori',
	tambahan: '/api/tambahan',
	bahan: '/api/bahan',
	resep_produk: '/api/resep-produk',
	bahan_mutasi: '/api/bahan-mutasi',
	hpp_settings: '/api/hpp-settings',
	buku_kas: '/api/buku-kas',
	transaksi_kasir: '/api/transaksi-kasir',
	sesi_toko: '/api/sesi-toko',
	pengaturan: '/api/pengaturan'
} as const;

export type ReadResource = keyof typeof READ_ROUTES;
export type WriteResource = keyof typeof WRITE_ROUTES;

// [CATATAN]: ─── GET helpers ──────────────────────────────────────────────────────────

/**
 * Ambil data dari per-resource GET route.
 * Params di-pass sebagai query string (tanpa `table` — sudah ada di URL).
 * `branch` tetap disertakan karena beberapa route menggunakannya.
 */
export async function dbGet<T extends DataRecord = DataRecord>(
	table: ReadResource,
	params: Record<string, string> = {}
): Promise<T[]> {
	const url = READ_ROUTES[table];
	if (!url) throw new Error(`[dataApiClient] dbGet: unknown table "${table}"`);
	const qs = new URLSearchParams({ branch: currentBranch(), ...params }).toString();
	const response = await fetch(`${url}?${qs}`);
	if (!response.ok) throw await parseError(response, `GET ${table}`);
	return parseRows<T>(await response.json(), `GET ${table}`);
}

export const dbGetStrict = dbGet;

/**
 * Ambil satu halaman cursor-paginated dari per-resource GET route.
 * Khusus buku_kas dan transaksi_kasir.
 */
export async function dbGetPage<T extends DataRecord = DataRecord>(
	table: 'buku_kas' | 'transaksi_kasir',
	params: Record<string, string> = {},
	cursor?: string | null
): Promise<DataPage<T>> {
	const url = READ_ROUTES[table];
	if (!url) throw new Error(`[dataApiClient] dbGetPage: unknown table "${table}"`);
	const query = new URLSearchParams({
		branch: currentBranch(),
		...params,
		pagination: 'cursor',
		limit: params.limit || String(PAGE_SIZE)
	});
	if (cursor) query.set('cursor', cursor);

	const response = await fetch(`${url}?${query.toString()}`);
	if (!response.ok) throw await parseError(response, `GET ${table} page`);
	return parsePage<T>(await response.json(), `GET ${table} page`);
}

export async function dbGetAll<T extends DataRecord = DataRecord>(
	table: 'buku_kas' | 'transaksi_kasir',
	params: Record<string, string> = {}
): Promise<T[]> {
	const rows: T[] = [];
	let cursor: string | null = null;
	do {
		const page: DataPage<T> = await dbGetPage<T>(table, params, cursor);
		rows.push(...page.data);
		if (rows.length > MAX_ACCUMULATED_ROWS) {
			throw new Error(`GET ${table} melebihi batas ${MAX_ACCUMULATED_ROWS} baris`);
		}
		cursor = page.nextCursor;
	} while (cursor);
	return rows;
}

// [CATATAN]: ─── POST (write) helper ───────────────────────────────────────────────────

/**
 * Kirim operasi tulis ke per-resource RESTful route.
 * - action='insert'   → POST ke /api/<resource>
 * - action='update'   → PATCH ke /api/<resource> (where clause via body)
 * - action='delete'   → DELETE ke /api/<resource> (where clause via query param)
 *
 * Body shape disesuaikan agar kompatibel dengan format WriteBody di server.
 */
export async function dbPost<T extends DataRecord = DataRecord>(
	table: WriteResource,
	action: 'insert' | 'update' | 'delete',
	payload: DataRecord | DataRecord[],
	where?: Record<string, string>
): Promise<DataMutationResult<T>> {
	const url = WRITE_ROUTES[table];
	if (!url) throw new Error(`[dataApiClient] dbPost: unknown table "${table}"`);

	if (action === 'insert') {
		const response = await fetchWithCsrfRetry(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload, branch: currentBranch() })
		});
		if (!response.ok) throw await parseError(response, `POST ${table}/insert`);
		await cacheOrchestrator.invalidateCacheOnChange(table);
		if (table === 'bahan' || table === 'bahan_mutasi') refreshBus.emit('stok');
		return parseMutation<T>(await response.json(), `POST ${table}/insert`);
	}

	if (action === 'update') {
		const response = await fetchWithCsrfRetry(url, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload, branch: currentBranch(), where })
		});
		if (!response.ok) throw await parseError(response, `PATCH ${table}`);
		await cacheOrchestrator.invalidateCacheOnChange(table);
		if (table === 'bahan' || table === 'bahan_mutasi') refreshBus.emit('stok');
		return parseMutation<T>(await response.json(), `PATCH ${table}`);
	}

	// [CATATAN]: action === 'delete' — where clause lewat query param (seperti di route DELETE handler).
	const qs = new URLSearchParams({ branch: currentBranch(), ...where }).toString();
	const response = await fetchWithCsrfRetry(`${url}?${qs}`, { method: 'DELETE' });
	if (!response.ok) throw await parseError(response, `DELETE ${table}`);
	await cacheOrchestrator.invalidateCacheOnChange(table);
	if (table === 'bahan' || table === 'bahan_mutasi') refreshBus.emit('stok');
	return parseMutation<T>(await response.json(), `DELETE ${table}`);
}
