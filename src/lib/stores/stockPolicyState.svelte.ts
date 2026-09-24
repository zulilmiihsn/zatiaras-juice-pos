import { browser } from '$app/environment';
import { fetchStockPolicy, type StockPolicyMode } from '$lib/services/stockPolicyService';
import { realtimeManager } from '$lib/realtime/realtimeManager';

type PolicySnapshot = {
	mode: StockPolicyMode;
	revision: number;
	canManage: boolean;
	loaded: boolean;
	error: string;
};

let snapshot = $state<PolicySnapshot>({
	mode: 'tracked',
	revision: 0,
	canManage: false,
	loaded: false,
	error: ''
});

let inFlight: Promise<PolicySnapshot> | null = null;
let realtimeSubscribed = false;

async function loadFromServer(): Promise<PolicySnapshot> {
	const policy = await fetchStockPolicy();
	snapshot = {
		mode: policy.mode,
		revision: policy.revision,
		canManage: policy.can_manage_policy,
		loaded: true,
		error: ''
	};
	if (browser) {
		try {
			const branch = (localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda').trim();
			const key = `pos-stock-policy:${branch}`;
			// Pertahankan epoch_token katalog bila mode+revision masih sama; token
			// membuktikan epoch saat replay offline, jangan timpa dengan kosong.
			let epochToken = '';
			try {
				const stored = JSON.parse(localStorage.getItem(key) || 'null') as {
					mode?: unknown;
					revision?: unknown;
					epoch_token?: unknown;
				} | null;
				if (
					stored &&
					stored.mode === policy.mode &&
					stored.revision === policy.revision &&
					typeof stored.epoch_token === 'string'
				) {
					epochToken = stored.epoch_token;
				}
			} catch {
				epochToken = '';
			}
			localStorage.setItem(
				key,
				JSON.stringify({ mode: policy.mode, revision: policy.revision, epoch_token: epochToken })
			);
		} catch {
			// Best-effort; server tetap otoritatif.
		}
	}
	return snapshot;
}

export const stockPolicyState = {
	get mode(): StockPolicyMode {
		return snapshot.mode;
	},
	get revision(): number {
		return snapshot.revision;
	},
	get canManage(): boolean {
		return snapshot.canManage;
	},
	get loaded(): boolean {
		return snapshot.loaded;
	},
	get error(): string {
		return snapshot.error;
	},
	get ignored(): boolean {
		return snapshot.loaded && snapshot.mode === 'ignored';
	},
	refresh(): Promise<PolicySnapshot> {
		if (inFlight) return inFlight;
		inFlight = loadFromServer()
			.catch((error: unknown) => {
				snapshot = {
					...snapshot,
					loaded: true,
					error: error instanceof Error ? error.message : 'Gagal memuat pengaturan stok'
				};
				return snapshot;
			})
			.finally(() => {
				inFlight = null;
			});
		if (!realtimeSubscribed && browser) {
			realtimeSubscribed = true;
			try {
				realtimeManager.subscribe('stock_policy', () => {
					inFlight = null;
					void stockPolicyState.refresh();
				});
			} catch {
				// Realtime best-effort; refresh manual tetap tersedia.
			}
		}
		return inFlight;
	},
	applyLocal(mode: StockPolicyMode, revision: number): void {
		snapshot = { ...snapshot, mode, revision, loaded: true, error: '' };
	}
};
