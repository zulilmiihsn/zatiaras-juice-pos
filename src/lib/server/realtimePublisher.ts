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
 * Budget pengiriman realtime per event: DO hang tak boleh
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
	timeoutMs: number = REALTIME_PUBLISH_TIMEOUT_MS,
	parentSignal?: AbortSignal
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

		if (parentSignal?.aborted) return;
		const budget = Number.isFinite(timeoutMs)
			? Math.min(REALTIME_PUBLISH_TIMEOUT_MS, Math.max(1, timeoutMs))
			: REALTIME_PUBLISH_TIMEOUT_MS;
		const id = hub.idFromName(branchId);
		const stub = hub.get(id);
		// One owned timer aborts actual I/O and also bounds signal-ignoring adapters.
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onParentAbort: (() => void) | undefined;
		try {
			const cancelled = new Promise<never>((_resolve, reject) => {
				onParentAbort = () => {
					controller.abort(parentSignal?.reason);
					reject(controller.signal.reason);
				};
				parentSignal?.addEventListener('abort', onParentAbort, { once: true });
				timer = setTimeout(() => {
					controller.abort(new Error('realtime publish timeout'));
					reject(controller.signal.reason);
				}, budget);
			});
			await Promise.race([
				cancelled,
				stub.fetch(
					new Request('https://realtime.local/publish', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload),
						signal: controller.signal
					})
				)
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			if (onParentAbort) parentSignal?.removeEventListener('abort', onParentAbort);
		}
	} catch (error) {
		console.warn('[realtime] Failed to publish branch event', error);
	}
}
