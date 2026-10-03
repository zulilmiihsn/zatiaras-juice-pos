import { browser } from '$app/environment';
import { getOfflineSessionBranch, readOfflineSessionSnapshot } from '$lib/auth/offlineSession';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { fetchOrderQueue } from '$lib/services/orderQueueService';
import { syncOrderStatusIntents } from '$lib/services/orderQueueSync';
import { syncPendingTransactions } from '$lib/services/offlineSync';
import { userProfile } from '$lib/stores/userRole.svelte';
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
	STATUS_STORAGE_MESSAGE,
	type StatusIntent,
	type UiOrder
} from '$lib/utils/orderQueueLocal';
import type { OrderQueueItem, PreparationState } from '$lib/server/orderQueue/types';

function currentBranch(): string | null {
	if (!browser) return null;
	return getOfflineSessionBranch(readOfflineSessionSnapshot());
}

function currentUserId(): string | null {
	try {
		const profile = userProfile.value as { id?: unknown; username?: unknown } | null;
		if (profile && typeof profile.id === 'string' && profile.id) return profile.id;
		if (profile && typeof profile.username === 'string' && profile.username)
			return profile.username;
		const snapshot = readOfflineSessionSnapshot();
		const user = snapshot?.user;
		if (user && typeof user.id === 'string' && user.id) return user.id;
		if (user && typeof user.username === 'string' && user.username) return user.username;
	} catch {
		return null;
	}
	return null;
}

const OFFLINE_STATUS_MESSAGE =
	'Status tersimpan di perangkat ini. Sinkronkan saat koneksi kembali.';
const FAILED_STATUS_MESSAGE =
	'Sebagian status belum tersinkron. Tekan Sinkronkan status untuk mencoba lagi.';
const CONFLICT_STATUS_MESSAGE =
	'Pesanan berubah di perangkat lain atau sudah tidak tersedia. Daftar telah dimuat ulang; periksa statusnya.';
const SESSION_STATUS_MESSAGE = 'Masuk kembali saat online untuk menyinkronkan status pesanan.';

type CountSource = 'server' | 'cached' | 'unknown';
let pendingCount = $state(0);
let countSource = $state<CountSource>('unknown');
let countFailed = $state(false);
let badgeStarted = false;
let badgeDisposers: Array<() => void> = [];
let badgeRequested = 0;
let badgePromise: Promise<void> | null = null;

function setUnknownCount(): void {
	pendingCount = 0;
	countSource = 'unknown';
	countFailed = true;
}

async function recomputeBadge(): Promise<void> {
	const branch = currentBranch();
	const userId = currentUserId();
	if (!branch || !userId) {
		setUnknownCount();
		return;
	}
	const [snapshot, intents, pendingTransactions] = await Promise.all([
		loadQueueSnapshot(branch, userId),
		loadStatusIntents(branch),
		getPendingTransactions()
	]);
	if (currentBranch() !== branch || currentUserId() !== userId) {
		setUnknownCount();
		void refreshOrderQueueBadge();
		return;
	}
	const pendings = pendingTransactions as Array<Record<string, unknown>>;
	const localCards = pendings
		.map((item) => buildLocalCardFromPending(item, branch))
		.filter((card): card is UiOrder => card !== null);
	const activeIntents = intents.filter((intent) => intent.userId === userId);
	const hasOverlay = localCards.length > 0 || activeIntents.length > 0;
	if (!navigator.onLine) {
		const cachedCards = mergeQueueWithLocal(
			snapshot?.items ?? [],
			pendings,
			activeIntents,
			branch,
			userId
		);
		const hasData =
			snapshot !== null ||
			localCards.length > 0 ||
			activeIntents.some((intent) => intent.card !== undefined);
		if (!hasData) {
			setUnknownCount();
			return;
		}
		pendingCount = cachedCards.filter((card) => card.preparation_state === 'pending').length;
		countSource = 'cached';
		countFailed = false;
		return;
	}
	if (!hasOverlay) {
		const response = await fetchOrderQueue('pending', { limit: 1 });
		if (currentBranch() !== branch || currentUserId() !== userId) {
			setUnknownCount();
			void refreshOrderQueueBadge();
			return;
		}
		pendingCount = response.pending_count;
		countSource = 'server';
		countFailed = false;
		return;
	}
	const cachedCards = mergeQueueWithLocal(
		snapshot?.items ?? [],
		pendings,
		activeIntents,
		branch,
		userId
	);
	const hasData =
		snapshot !== null ||
		localCards.length > 0 ||
		activeIntents.some((intent) => intent.card !== undefined);
	if (!hasData) {
		setUnknownCount();
		return;
	}
	pendingCount = cachedCards.filter((card) => card.preparation_state === 'pending').length;
	countSource = 'cached';
	countFailed = false;
}

export function refreshOrderQueueBadge(): Promise<void> {
	if (!browser) return Promise.resolve();
	badgeRequested++;
	if (badgePromise) return badgePromise;
	const refresh = async (): Promise<void> => {
		for (;;) {
			const generation = badgeRequested;
			try {
				await recomputeBadge();
			} catch {
				setUnknownCount();
			}
			await Promise.resolve();
			if (generation === badgeRequested) {
				badgePromise = null;
				return;
			}
		}
	};
	badgePromise = Promise.resolve().then(refresh);
	return badgePromise;
}

function startBadge(): void {
	if (!browser || badgeStarted) return;
	badgeStarted = true;
	const refresh = () => void refreshOrderQueueBadge();
	badgeDisposers.push(
		realtimeManager.subscribe('buku_kas', refresh),
		realtimeManager.subscribe('transaksi_kasir', refresh)
	);
	window.addEventListener('online', refresh);
	window.addEventListener('offline', refresh);
	window.addEventListener('pending-synced', refresh);
	window.addEventListener('antrean-synced', refresh);
	window.addEventListener('antrean-conflict', refresh);
	window.addEventListener('pending-changed', refresh);
	window.addEventListener('auth-session-refreshed', refresh);
	badgeDisposers.push(() => {
		window.removeEventListener('offline', refresh);
		window.removeEventListener('online', refresh);
		window.removeEventListener('pending-synced', refresh);
		window.removeEventListener('antrean-synced', refresh);
		window.removeEventListener('antrean-conflict', refresh);
		window.removeEventListener('auth-session-refreshed', refresh);
		window.removeEventListener('pending-changed', refresh);
	});
	void refreshOrderQueueBadge();
}

export const orderQueueBadge = {
	get count(): number {
		startBadge();
		return pendingCount;
	},
	get countSource(): CountSource {
		return countSource;
	},
	get failed(): boolean {
		return countFailed;
	},
	refresh: refreshOrderQueueBadge,
	dispose(): void {
		for (const dispose of badgeDisposers) dispose();
		badgeDisposers = [];
		badgeStarted = false;
	}
};

function sortPending(items: OrderQueueItem[]): OrderQueueItem[] {
	return [...items].sort((a, b) => {
		if (a.waktu !== b.waktu) return a.waktu < b.waktu ? -1 : 1;
		const aId = a.buku_kas_id || a.idempotency_key;
		const bId = b.buku_kas_id || b.idempotency_key;
		return aId < bId ? -1 : aId > bId ? 1 : 0;
	});
}

function mergePages(existing: OrderQueueItem[], next: OrderQueueItem[]): OrderQueueItem[] {
	const byKey = new Map(existing.map((item) => [item.idempotency_key, item]));
	for (const item of next) byKey.set(item.idempotency_key, item);
	return [...byKey.values()];
}

export function createOrderQueueState() {
	let items = $state<UiOrder[]>([]);
	let loading = $state(false);
	let loadError = $state('');
	let statusSyncMessage = $state('');
	let statusSyncing = $state(false);
	let pendingStatusCount = $state(0);
	let activeTab = $state<PreparationState>('pending');
	let hasMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let syncing = $state<Record<string, boolean>>({});
	let searchKeyword = $state('');
	const filteredItems = $derived(filterQueueOrders(items, searchKeyword));
	let disposers: Array<() => void> = [];
	let started = false;
	let loadGen = 0;
	let loadedScope = '';
	let serverViewReady = false;
	let statusRetryRequested = false;
	let statusRetryInFlight: Promise<void> | null = null;
	const loadedDtos = new Map<PreparationState, OrderQueueItem[]>();

	function scopeKey(branch: string, userId: string): string {
		return `${branch}\u0000${userId}`;
	}

	function viewIsCurrent(
		gen: number,
		tab: PreparationState,
		branch: string,
		userId: string
	): boolean {
		return (
			gen === loadGen &&
			activeTab === tab &&
			currentBranch() === branch &&
			currentUserId() === userId
		);
	}

	function loadedServerItems(): OrderQueueItem[] {
		return loadedDtos.get(activeTab) ?? [];
	}
	async function includeLegacyIntentCards(
		serverItems: OrderQueueItem[],
		intents: StatusIntent[],
		branch: string,
		userId: string
	): Promise<OrderQueueItem[]> {
		const legacyKeys = new Set(
			intents
				.filter((intent) => intent.userId === userId && !intent.card)
				.map((intent) => intent.idempotency_key)
		);
		if (!legacyKeys.size) return serverItems;
		const existingKeys = new Set(serverItems.map((item) => item.idempotency_key));
		const snapshot = await loadQueueSnapshot(branch, userId);
		const fallbackItems = (snapshot?.items ?? []).filter(
			(item) => legacyKeys.has(item.idempotency_key) && !existingKeys.has(item.idempotency_key)
		);
		return [...serverItems, ...fallbackItems];
	}
	async function rebuildVisible(): Promise<void> {
		const branch = currentBranch();
		const userId = currentUserId();
		if (!branch || !userId) {
			items = [];
			return;
		}
		const [intents, pendingTransactions] = await Promise.all([
			loadStatusIntents(branch),
			getPendingTransactions()
		]);
		const projection = await includeLegacyIntentCards(loadedServerItems(), intents, branch, userId);
		const merged = mergeQueueWithLocal(
			projection,
			pendingTransactions as Array<Record<string, unknown>>,
			intents,
			branch,
			userId
		);
		if (currentBranch() === branch && currentUserId() === userId) {
			items = merged.filter((card) => card.preparation_state === activeTab);
			pendingStatusCount = intents.length;
		}
	}

	async function loadFromServer(
		tab: PreparationState,
		cursor: string | null,
		append: boolean,
		gen: number,
		branch: string,
		userId: string
	): Promise<void> {
		const page = await fetchOrderQueue(tab, { cursor, limit: 50 });
		if (!viewIsCurrent(gen, tab, branch, userId)) return;
		const previous = append ? (loadedDtos.get(tab) ?? []) : [];
		const loaded = append ? mergePages(previous, page.items) : page.items;
		const pendings = (await getPendingTransactions()) as Array<Record<string, unknown>>;
		const intents = await loadStatusIntents(branch);
		if (!viewIsCurrent(gen, tab, branch, userId)) return;
		if (tab === 'pending') {
			const snapshotItems = sortPending(
				loaded.filter((item) => item.preparation_state === 'pending')
			);
			// Keep the authoritative online response visible if this offline-only cache write fails.
			await saveQueueSnapshot(branch, userId, snapshotItems, page.pending_count, {
				isCurrent: () => viewIsCurrent(gen, tab, branch, userId)
			}).catch(() => {});
			if (!viewIsCurrent(gen, tab, branch, userId)) return;
		}
		const projection = await includeLegacyIntentCards(loaded, intents, branch, userId);
		if (!viewIsCurrent(gen, tab, branch, userId)) return;
		const merged = mergeQueueWithLocal(projection, pendings, intents, branch, userId).filter(
			(card) => card.preparation_state === tab
		);
		if (!viewIsCurrent(gen, tab, branch, userId)) return;
		loadedDtos.set(tab, loaded);
		serverViewReady = true;
		items = merged;
		pendingStatusCount = intents.length;
		hasMore = page.hasMore;
		nextCursor = page.nextCursor;
		void refreshOrderQueueBadge();
	}
	async function loadFromLocal(
		tab: PreparationState,
		gen: number,
		branch: string,
		userId: string
	): Promise<void> {
		const snapshot = await loadQueueSnapshot(branch, userId);
		const pendingTransactions = await getPendingTransactions();
		const intents = await loadStatusIntents(branch);
		if (!viewIsCurrent(gen, tab, branch, userId)) return;
		const merged = mergeQueueWithLocal(
			snapshot?.items ?? [],
			pendingTransactions as Array<Record<string, unknown>>,
			intents,
			branch,
			userId
		).filter((card) => card.preparation_state === tab);
		items = merged;
		serverViewReady = false;
		pendingStatusCount = intents.length;
		hasMore = false;
		nextCursor = null;
		void refreshOrderQueueBadge();
	}

	async function load(tab: PreparationState = activeTab, append = false): Promise<void> {
		const gen = ++loadGen;
		loading = true;
		loadError = '';
		const branch = currentBranch();
		const userId = currentUserId();
		if (!branch || !userId) {
			items = [];
			serverViewReady = false;
			loadError = SESSION_STATUS_MESSAGE;
			loading = false;
			return;
		}
		const key = scopeKey(branch, userId);
		if (loadedScope && loadedScope !== key) {
			loadedDtos.clear();
			serverViewReady = false;
			items = [];
			nextCursor = null;
			hasMore = false;
		}
		loadedScope = key;
		const previousPagination = { hasMore, nextCursor };
		try {
			if (!browser || navigator.onLine) {
				await loadFromServer(tab, append ? nextCursor : null, append, gen, branch, userId);
			} else {
				await loadFromLocal(tab, gen, branch, userId);
			}
		} catch (err) {
			if (gen !== loadGen) return;
			loadError = err instanceof Error ? err.message : 'Gagal memuat Antrean';
			if (browser) {
				try {
					await loadFromLocal(tab, gen, branch, userId);
					if (viewIsCurrent(gen, tab, branch, userId)) {
						hasMore = previousPagination.hasMore;
						nextCursor = previousPagination.nextCursor;
					}
				} catch (localError) {
					loadError = localError instanceof Error ? localError.message : STATUS_STORAGE_MESSAGE;
					statusSyncMessage = STATUS_STORAGE_MESSAGE;
					pendingStatusCount = -1;
				}
			}
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
		serverViewReady = false;
		items = [];
		nextCursor = null;
		hasMore = false;
		await load(tab);
	}

	async function runStatusRetry(): Promise<void> {
		statusSyncing = true;
		statusSyncMessage = '';
		try {
			const branch = currentBranch();
			if (!branch || !navigator.onLine) {
				statusSyncMessage = branch ? OFFLINE_STATUS_MESSAGE : SESSION_STATUS_MESSAGE;
				return;
			}
			await syncPendingTransactions({ activeBranch: branch });
			if (currentBranch() !== branch) {
				statusSyncMessage = SESSION_STATUS_MESSAGE;
				return;
			}
			const result = await syncOrderStatusIntents(branch);
			const intents = await loadStatusIntents(branch);
			pendingStatusCount = intents.length;
			if (!statusSyncMessage) {
				if (result.conflicts > 0) statusSyncMessage = CONFLICT_STATUS_MESSAGE;
				else if (result.failed > 0 || intents.length > 0) statusSyncMessage = FAILED_STATUS_MESSAGE;
			}
			// Skip empty recovery only after this scope has a server view; cold/cache recovery still loads.
			if (
				!serverViewReady ||
				loadedScope !== scopeKey(branch, currentUserId() ?? '') ||
				loadError !== '' ||
				result.synced > 0 ||
				result.conflicts > 0 ||
				result.failed > 0 ||
				intents.length > 0
			) {
				await load(activeTab);
			}
			await refreshOrderQueueBadge();
		} catch (error) {
			statusSyncMessage =
				error instanceof Error && error.message === SESSION_STATUS_MESSAGE
					? SESSION_STATUS_MESSAGE
					: STATUS_STORAGE_MESSAGE;
			pendingStatusCount = -1;
			await refreshOrderQueueBadge();
		} finally {
			statusSyncing = false;
		}
	}

	function retryStatusSync(): Promise<void> {
		if (!browser) return Promise.resolve();
		statusRetryRequested = true;
		if (statusRetryInFlight) return statusRetryInFlight;
		statusRetryInFlight = Promise.resolve()
			.then(async () => {
				while (statusRetryRequested) {
					statusRetryRequested = false;
					await runStatusRetry();
				}
			})
			.finally(() => {
				statusRetryInFlight = null;
			});
		return statusRetryInFlight;
	}

	async function setStatus(card: UiOrder, target: PreparationState): Promise<void> {
		if (syncing[card.idempotency_key]) return;
		const branch = currentBranch();
		const userId = currentUserId();
		if (!branch || !userId) {
			statusSyncMessage = SESSION_STATUS_MESSAGE;
			return;
		}
		syncing = { ...syncing, [card.idempotency_key]: true };
		try {
			await saveStatusIntent({
				branch,
				idempotency_key: card.idempotency_key,
				target,
				expected_revision: card.preparation_revision,
				userId,
				card: {
					...card,
					items: card.items.map((item) => ({
						...item,
						tambahan: item.tambahan.map((extra) => ({ ...extra }))
					}))
				}
			});
			await rebuildVisible();
			await refreshOrderQueueBadge();
			if (!navigator.onLine) {
				statusSyncMessage = OFFLINE_STATUS_MESSAGE;
				return;
			}
			await retryStatusSync();
		} catch (error) {
			statusSyncMessage = error instanceof Error ? error.message : STATUS_STORAGE_MESSAGE;
			if (
				statusSyncMessage !==
				'Terlalu banyak perubahan status belum tersinkron. Sinkronkan dulu lalu coba lagi.'
			) {
				statusSyncMessage = STATUS_STORAGE_MESSAGE;
			}
		} finally {
			const next = { ...syncing };
			delete next[card.idempotency_key];
			syncing = next;
		}
	}

	function handleRecovery(): void {
		void retryStatusSync();
	}

	function handleReload(): void {
		void load(activeTab);
		void refreshOrderQueueBadge();
	}

	function start(): void {
		if (!browser || started) return;
		started = true;
		const branch = currentBranch();
		const userId = currentUserId();
		if (branch && userId) void clearOtherQueueSnapshots(branch, userId);
		const reload = () => handleReload();
		const recover = () => handleRecovery();
		const checkoutRecovered = () => {
			reload();
			recover();
		};
		const onSyncMessage = (event: Event) => {
			const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
			if (kind === 'session') statusSyncMessage = SESSION_STATUS_MESSAGE;
			else if (kind === 'storage') statusSyncMessage = STATUS_STORAGE_MESSAGE;
			else if (kind === 'conflict') statusSyncMessage = CONFLICT_STATUS_MESSAGE;
			else if (kind === 'failed') statusSyncMessage = FAILED_STATUS_MESSAGE;
		};
		disposers.push(
			realtimeManager.subscribe('buku_kas', reload),
			realtimeManager.subscribe('transaksi_kasir', reload)
		);
		window.addEventListener('online', recover);
		window.addEventListener('pending-synced', checkoutRecovered);
		window.addEventListener('auth-session-refreshed', recover);
		window.addEventListener('antrean-synced', reload);
		window.addEventListener('antrean-conflict', reload);
		window.addEventListener('antrean-sync-message', onSyncMessage);
		disposers.push(() => {
			window.removeEventListener('online', recover);
			window.removeEventListener('pending-synced', checkoutRecovered);
			window.removeEventListener('auth-session-refreshed', recover);
			window.removeEventListener('antrean-synced', reload);
			window.removeEventListener('antrean-conflict', reload);
			window.removeEventListener('antrean-sync-message', onSyncMessage);
		});
		const onFocus = () => {
			if (navigator.onLine) recover();
		};
		window.addEventListener('focus', onFocus);
		disposers.push(() => window.removeEventListener('focus', onFocus));
		if (navigator.onLine) void retryStatusSync();
		else void load(activeTab);
		void refreshOrderQueueBadge();
	}

	function dispose(): void {
		loadGen++;
		serverViewReady = false;
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
		set searchKeyword(value: string) {
			searchKeyword = value;
		},
		get loading() {
			return loading;
		},
		get error() {
			return loadError;
		},
		get statusSyncMessage() {
			return statusSyncMessage;
		},
		get statusSyncing() {
			return statusSyncing;
		},
		get pendingStatusCount() {
			return pendingStatusCount;
		},
		get countSource() {
			return countSource;
		},
		get countFailed() {
			return countFailed;
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
		get isOnline() {
			return browser && navigator.onLine;
		},
		load,
		loadMore(): Promise<void> {
			if (!hasMore || loading) return Promise.resolve();
			return load(activeTab, true);
		},
		setTab,
		setStatus,
		retryStatusSync,
		start,
		dispose
	};
}
