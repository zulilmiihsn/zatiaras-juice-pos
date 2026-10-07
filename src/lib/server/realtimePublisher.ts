export type RealtimeTable =
	| 'produk'
	| 'kategori'
	| 'tambahan'
	| 'bahan'
	| 'resep_produk'
	| 'bahan_mutasi'
	| 'hpp_settings'
	| 'buku_kas'
	| 'transaksi_kasir'
	| 'sesi_toko'
	| 'pengaturan'
	| 'stock_policy'
	| 'offline_stock_reviews'
	| 'profil';

export type RealtimeAction = 'insert' | 'update' | 'delete' | 'upsert' | 'sync';

export interface BranchEventPayload {
	branch_id: string;
	table: RealtimeTable;
	action: RealtimeAction;
	id?: string | number | null;
	transaction_id?: string | null;
	changed_at: string;
}

/**
 * Budget pengiriman realtime per event (AUD-049): DO hang tak boleh
 * menahan respons checkout. Abort membersihkan upstream; gagal = warn
 * best-effort, commit utama tetap sah (ADR 0002).
 */
export const REALTIME_PUBLISH_TIMEOUT_MS = 3000;

export async function publishBranchEvent(
	env: Record<string, unknown> | undefined,
	branchId: string,
	table: RealtimeTable,
	action: RealtimeAction,
	extra: Partial<BranchEventPayload> = {},
	timeoutMs: number = REALTIME_PUBLISH_TIMEOUT_MS
) {
	const hub = env?.REALTIME_HUB as
		| {
				idFromName(nama: string): unknown;
				get(id: unknown): { fetch(request: Request): Promise<Response> };
		  }
		| undefined;
	if (!hub) return;

	try {
		const payload: BranchEventPayload = {
			branch_id: branchId,
			table,
			action,
			changed_at: new Date().toISOString(),
			...extra
		};

		const budget = Math.max(1, timeoutMs);
		const id = hub.idFromName(branchId);
		const stub = hub.get(id);
		// AbortSignal untuk fetch patuh; timer backstop untuk stub yang
		// mengabaikan signal (tanpa ini balasan menggantung selamanya).
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				stub.fetch(
					new Request('https://realtime.local/publish', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload),
						signal: AbortSignal.timeout(budget)
					})
				),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error('realtime publish timeout')), budget);
				})
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	} catch (error) {
		console.warn('[realtime] Failed to publish branch event', error);
	}
}
