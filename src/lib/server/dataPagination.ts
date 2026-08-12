import { error as kitError } from '@sveltejs/kit';

export const DEFAULT_DATA_LIMIT = 200;
export const MAX_DATA_LIMIT = 500;

export type DataCursor = {
	sortValue: string;
	id: string;
};

export type CursorPage<T> = {
	data: T[];
	nextCursor: string | null;
	hasMore: boolean;
};

export function parseDataLimit(
	raw: string | null,
	defaultLimit = DEFAULT_DATA_LIMIT,
	maxLimit = MAX_DATA_LIMIT
): number {
	if (raw == null || raw.trim() === '') return defaultLimit;
	if (!/^\d+$/.test(raw)) throw kitError(400, 'limit harus berupa bilangan bulat');

	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1 || value > maxLimit) {
		throw kitError(400, `limit harus antara 1 dan ${maxLimit}`);
	}
	return value;
}

export function encodeDataCursor(cursor: DataCursor): string {
	return btoa(JSON.stringify(cursor));
}

export function decodeDataCursor(raw: string | null): DataCursor | null {
	if (!raw) return null;
	if (raw.length > 1024) throw kitError(400, 'cursor terlalu panjang');

	try {
		const value = JSON.parse(atob(raw)) as Partial<DataCursor>;
		if (
			typeof value.sortValue !== 'string' ||
			!value.sortValue ||
			typeof value.id !== 'string' ||
			!value.id
		) {
			throw new Error('invalid cursor payload');
		}
		return { sortValue: value.sortValue, id: value.id };
	} catch {
		throw kitError(400, 'cursor tidak valid');
	}
}

export function toCursorPage<T>(
	rows: T[],
	limit: number,
	getCursor: (row: T) => DataCursor
): CursorPage<T> {
	const hasMore = rows.length > limit;
	const data = hasMore ? rows.slice(0, limit) : rows;
	const last = data.at(-1);
	return {
		data,
		hasMore,
		nextCursor: hasMore && last ? encodeDataCursor(getCursor(last)) : null
	};
}
