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

export async function publishBranchEvent(
	env: Record<string, unknown> | undefined,
	branchId: string,
	table: RealtimeTable,
	action: RealtimeAction,
	extra: Partial<BranchEventPayload> = {}
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

		const id = hub.idFromName(branchId);
		const stub = hub.get(id);
		await stub.fetch(
			new Request('https://realtime.local/publish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			})
		);
	} catch (error) {
		console.warn('[realtime] Failed to publish branch event', error);
	}
}
