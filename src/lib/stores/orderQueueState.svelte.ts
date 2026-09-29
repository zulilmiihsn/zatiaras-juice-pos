import { browser } from '$app/environment';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { fetchOrderQueue } from '$lib/services/orderQueueService';
import { syncOrderStatusIntents } from '$lib/services/orderQueueSync';
import { getPendingTransactions } from '$lib/utils/offline';
import {
	buildLocalCardFromPending,
	clearOtherQueueSnapshots,
	filterQueueOrders,
	loadQueueSnapshot,
	loadStatusIntents,
	mergeQueueWithLocal,
	saveQueueSnapshot,
	saveStatusIntent,
	type StatusIntent,
	type UiOrder
} from '$lib/utils/orderQueueLocal';
import { getOfflineSessionBranch, readOfflineSessionSnapshot } from '$lib/auth/offlineSession';
import { userProfile } from '$lib/stores/userRole.svelte';
import type { PreparationState } from '$lib/server/orderQueue/types';

function currentBranch(): string {
	if (!browser) return 'samarinda';
	try {
		const fromSnapshot = getOfflineSessionBranch(readOfflineSessionSnapshot());
		if (fromSnapshot) return fromSnapshot;
		return (localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda').trim();
	} catch {
		return 'samarinda';
	}
}

function currentUserId(): string {
	try {
		const profile = userProfile.value as { id?: unknown; username?: unknown } | null;
		if (profile && typeof profile.id === 'string' && profile.id) return profile.id;
		if (profile && typeof profile.username === 'string' && profile.username) {
			return profile.username;
		}
		const snapshot = readOfflineSessionSnapshot();
		const user = snapshot?.user as { id?: unknown; username?: unknown } | undefined;
		if (user && typeof user.id === 'string' && user.id) return user.id;
		if (user && typeof user.username === 'string' && user.username) return user.username;
	} catch {
		// abaikan; pakai anon
	}
	return 'anon';
}

let pendingCount = $state(0);
let countFailed = $state(false);
let badgeStarted = false;
let badgeDisposers: Array<() => void> = [];
let badgeInFlight: Promise<void> | null = null;

async function refreshBadge(): Promise<void> {
	if (!browser) return;
	if (badgeInFlight) return badgeInFlight;
	badgeInFlight = (async () => {
		try {
			if (!navigator.onLine) {
				const branch = currentBranch();
				const pendings = (await getPendingTransactions().catch(() => [])) as Array<
					Record<string, unknown>
				>;
				const intents = await loadStatusIntents(branch);
				const localOnly = pendings
					.map((p) => buildLocalCardFromPending(p, branch))
					.filter((c): c is UiOrder => c !== null);
				const intentDone = new Set(
					intents.filter((i) => i.target === 'done').map((i) => i.idempotency_key)
				);
				pendingCount = localOnly.filter((c) => !intentDone.has(c.idempotency_key)).length;
				countFailed = false;
				return;
			}
			const page = await fetchOrderQueue('pending', { limit: 1 });
			const branch = currentBranch();
			const intents = await loadStatusIntents(branch).catch(() => [] as StatusIntent[]);
			const localPending = (await getPendingTransactions().catch(() => [])) as Array<
				Record<string, unknown>
			>;
			const localKeys = new Set(
				localPending
					.map((p) => buildLocalCardFromPending(p, branch))
					.filter((c): c is UiOrder => c !== null)
					.map((c) => c.idempotency_key)
			);
			const serverKeys = new Set(page.items.map((i) => String(i.idempotency_key)));
			const extraLocal = [...localKeys].filter((k) => !serverKeys.has(k)).length;
			const doneIntents = new Set(
				intents.filter((i) => i.target === 'done').map((i) => i.idempotency_key)
			);
			const hiddenByIntent = page.items.filter(
				(i) => doneIntents.has(String(i.idempotency_key)) && i.preparation_state === 'pending'
			).length;
			pendingCount = Math.max(0, page.pending_count - hiddenByIntent + extraLocal);
			countFailed = false;
		} catch {
			countFailed = true;
		} finally {
			badgeInFlight = null;
		}
	})();
	return badgeInFlight;
}

function startBadge(): void {
	if (!browser || badgeStarted) return;
	badgeStarted = true;
	void refreshBadge();
	badgeDisposers.push(realtimeManager.subscribe('buku_kas', () => void refreshBadge()));
	badgeDisposers.push(realtimeManager.subscribe('transaksi_kasir', () => void refreshBadge()));
	window.addEventListener('online', () => void refreshBadge());
	window.addEventListener('pending-synced', () => void refreshBadge());
	window.addEventListener('antrean-synced', () => void refreshBadge());
	window.addEventListener('antrean-conflict', () => void refreshBadge());
	window.addEventListener('pending-changed', () => void refreshBadge());
}

export const orderQueueBadge = {
	get count(): number {
		startBadge();
		return pendingCount;
	},
	get failed(): boolean {
		return countFailed;
	},
	refresh(): Promise<void> {
		startBadge();
		return refreshBadge();
	},
	dispose(): void {
		for (const dispose of badgeDisposers) dispose();
		badgeDisposers = [];
		badgeStarted = false;
	}
};

export function createOrderQueueState() {
	let items = $state<UiOrder[]>([]);
	let loading = $state(false);
	let error = $state('');
	let activeTab = $state<PreparationState>('pending');
	let hasMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let syncing = $state<Record<string, boolean>>({});
	let searchKeyword = $state('');
	const filteredItems = $derived(filterQueueOrders(items, searchKeyword));
	let disposers: Array<() => void> = [];
	let started = false;
	let loadGen = 0;

	async function loadFromServer(
		tab: PreparationState,
		cursor: string | null,
		append: boolean,
		gen: number
	): Promise<void> {
		const page = await fetchOrderQueue(tab, { cursor, limit: 50 });
		const branch = currentBranch();
		const userId = currentUserId();
		if (tab === 'pending') {
			await saveQueueSnapshot(branch, userId, page.items, page.pending_count).catch(() => {});
		}
		const pendings = (await getPendingTransactions().catch(() => [])) as Array<
			Record<string, unknown>
		>;
		const intents = await loadStatusIntents(branch).catch(() => [] as StatusIntent[]);
		const merged = mergeQueueWithLocal(page.items, pendings, intents, branch).filter(
			(card) => card.preparation_state === tab
		);
		// Load basi tidak boleh menimpa tab yang sudah berganti.
		if (gen !== loadGen) return;
		if (append) {
			const known = new Set(items.map((i) => i.idempotency_key));
			items = [...items, ...merged.filter((m) => !known.has(m.idempotency_key))];
		} else {
			items = merged;
		}
		hasMore = page.hasMore;
		nextCursor = page.nextCursor;
		await refreshBadge();
	}

	async function loadFromLocal(tab: PreparationState, gen: number): Promise<void> {
		const branch = currentBranch();
		const userId = currentUserId();
		const snapshot = await loadQueueSnapshot(branch, userId);
		const pendings = (await getPendingTransactions().catch(() => [])) as Array<
			Record<string, unknown>
		>;
		const intents = await loadStatusIntents(branch).catch(() => [] as StatusIntent[]);
		const merged = mergeQueueWithLocal(snapshot?.items ?? [], pendings, intents, branch).filter(
			(card) => card.preparation_state === tab
		);
		if (gen !== loadGen) return;
		items = merged;
		hasMore = false;
		nextCursor = null;
		await refreshBadge();
	}

	async function load(tab: PreparationState = activeTab, append = false): Promise<void> {
		const gen = ++loadGen;
		loading = !append;
		error = '';
		try {
			if (!browser || navigator.onLine) {
				await loadFromServer(tab, append ? nextCursor : null, append, gen);
			} else {
				await loadFromLocal(tab, gen);
			}
		} catch (err) {
			if (gen !== loadGen) return;
			error = err instanceof Error ? err.message : 'Gagal memuat Antrean';
			if (browser) await loadFromLocal(tab, gen).catch(() => {});
		} finally {
			if (gen === loadGen) loading = false;
		}
	}

	async function setTab(tab: PreparationState): Promise<void> {
		if (activeTab === tab) {
			await load(tab);
			return;
		}
		activeTab = tab;
		items = [];
		nextCursor = null;
		hasMore = false;
		await load(tab);
	}

	async function setStatus(card: UiOrder, target: PreparationState): Promise<void> {
		if (syncing[card.idempotency_key]) return;
		syncing = { ...syncing, [card.idempotency_key]: true };
		error = '';
		const branch = currentBranch();
		const userId = currentUserId();
		const previous = card.preparation_state;
		card.preparation_state = target;
		card.unsynced = true;
		items = [...items];
		try {
			const intent = await saveStatusIntent({
				branch,
				idempotency_key: card.idempotency_key,
				target,
				expected_revision: card.preparation_revision,
				userId
			});
			if (!navigator.onLine) {
				await refreshBadge();
				return;
			}
			const { failed } = await syncOrderStatusIntents(branch);
			if (failed > 0) {
				error = 'Sebagian status belum tersinkron. Coba lagi.';
			}
			// Hapus kartu dari tab aktif bila target pindah tab dan sudah sinkron.
			const remaining = await loadStatusIntents(branch).catch(() => [] as StatusIntent[]);
			const stillPending = remaining.some((i) => i.idempotency_key === intent.idempotency_key);
			if (!stillPending) {
				items = items.filter(
					(i) => i.idempotency_key !== card.idempotency_key || i.preparation_state === activeTab
				);
			}
			await load(activeTab);
		} catch (err) {
			card.preparation_state = previous;
			items = [...items];
			error = err instanceof Error ? err.message : 'Gagal memperbarui pesanan';
		} finally {
			const next = { ...syncing };
			delete next[card.idempotency_key];
			syncing = next;
			await refreshBadge();
		}
	}

	function start(): void {
		if (!browser || started) return;
		started = true;
		void clearOtherQueueSnapshots(currentBranch(), currentUserId());
		disposers.push(
			realtimeManager.subscribe('buku_kas', () => void load(activeTab)),
			realtimeManager.subscribe('transaksi_kasir', () => void load(activeTab))
		);
		const onSync = () => {
			void syncOrderStatusIntents(currentBranch()).then(() => load(activeTab));
		};
		window.addEventListener('online', onSync);
		window.addEventListener('pending-synced', onSync);
		window.addEventListener('antrean-synced', () => void load(activeTab));
		window.addEventListener('antrean-conflict', () => void load(activeTab));
		disposers.push(() => {
			window.removeEventListener('online', onSync);
			window.removeEventListener('pending-synced', onSync);
		});
		void load(activeTab);
		void refreshBadge();
	}

	function dispose(): void {
		for (const dispose of disposers) dispose();
		disposers = [];
		started = false;
	}

	return {
		get items() {
			return items;
		},
		get filteredItems() {
			return filteredItems;
		},
		get searchKeyword() {
			return searchKeyword;
		},
		set searchKeyword(v) {
			searchKeyword = v;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get activeTab() {
			return activeTab;
		},
		get hasMore() {
			return hasMore;
		},
		get syncing() {
			return syncing;
		},
		get pendingCount() {
			return pendingCount;
		},
		load,
		loadMore(): Promise<void> {
			if (!hasMore || loading) return Promise.resolve();
			return load(activeTab, true);
		},
		setTab,
		setStatus,
		start,
		dispose
	};
}
