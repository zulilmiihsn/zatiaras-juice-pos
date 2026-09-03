import {
	dbGet,
	dbGetPage,
	dbPost,
	type DataPage,
	type DataRecord,
	type ReadResource,
	type WriteResource
} from '$lib/services/dataApiClient';

export class TransactionService {
	private static instance: TransactionService;

	static getInstance(): TransactionService {
		if (!TransactionService.instance) TransactionService.instance = new TransactionService();
		return TransactionService.instance;
	}

	async getRows(table: ReadResource, params: Record<string, string> = {}): Promise<DataRecord[]> {
		return dbGet(table, params);
	}

	async getRowsPage<T extends DataRecord = DataRecord>(
		table: 'buku_kas' | 'transaksi_kasir',
		params: Record<string, string> = {},
		cursor?: string | null
	): Promise<DataPage<T>> {
		return dbGetPage<T>(table, params, cursor);
	}

	async getOne(
		table: ReadResource,
		params: Record<string, string> = {}
	): Promise<DataRecord | null> {
		const rows = await dbGet(table, { limit: '1', ...params });
		return rows[0] || null;
	}

	async insertRows(
		table: WriteResource,
		payload: Record<string, unknown> | Record<string, unknown>[]
	) {
		return dbPost(table, 'insert', payload);
	}

	async updateRows(
		table: WriteResource,
		payload: Record<string, unknown>,
		where: Record<string, string>
	) {
		return dbPost(table, 'update', payload, where);
	}

	async deleteRows(table: WriteResource, where: Record<string, string>) {
		return dbPost(table, 'delete', {}, where);
	}

	async fetchAllDataParallel(
		table: ReadResource,
		startTime: string,
		endTime: string,
		_filters: Record<string, unknown> = {}
	): Promise<Record<string, unknown>[]> {
		return dbGet(table, { start: startTime, end: endTime });
	}
}

export const transactionService = TransactionService.getInstance();
