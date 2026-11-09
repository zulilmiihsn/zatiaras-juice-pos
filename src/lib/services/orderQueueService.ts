import { parseApiError } from '$lib/utils/errorHandling';
import type { OrderQueuePage, PreparationState } from '$lib/server/orderQueue/types';

async function readError(response: Response, fallback: string): Promise<Error> {
	return new Error(await parseApiError(response, fallback));
}

export async function fetchOrderQueue(
	state: PreparationState = 'pending',
	options: { cursor?: string | null; limit?: number } = {}
): Promise<OrderQueuePage> {
	const params = new URLSearchParams({ state });
	if (options.cursor) params.set('cursor', options.cursor);
	if (options.limit) params.set('limit', String(options.limit));
	const response = await fetch(`/api/antrean?${params.toString()}`, {
		credentials: 'include'
	});
	if (!response.ok) throw await readError(response, 'Gagal memuat Antrean');
	const payload = (await response.json()) as { ok: boolean; data: OrderQueuePage };
	if (!payload.ok || !payload.data || !Array.isArray(payload.data.items)) {
		throw new Error('Respons Antrean tidak valid');
	}
	return payload.data;
}
