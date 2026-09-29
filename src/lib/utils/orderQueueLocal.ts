import { del, get, keys, set } from 'idb-keyval';
import { orderQueueStore } from '$lib/utils/idbStores';
import type { OrderQueueItem } from '$lib/server/orderQueue/types';

export type OrderTarget = 'pending' | 'done';

export interface UiOrderItem {
	nama: string;
	jumlah: number;
	gula: string | null;
	es: string | null;
	catatan: string | null;
	tambahan: Array<{ nama: string }>;
}

export interface UiOrder {
	idempotency_key: string;
	transaction_id: string;
	nama_pelanggan: string | null;
	waktu: string;
	preparation_state: OrderTarget;
	preparation_revision: number;
	items: UiOrderItem[];
	unsynced: boolean;
}

interface QueueSnapshot {
	branch: string;
	userId: string;
	savedAt: number;
	items: OrderQueueItem[];
	pending_count: number;
}

export interface StatusIntent {
	branch: string;
	idempotency_key: string;
	target: OrderTarget;
	expected_revision: number;
	userId: string;
	updated_at: number;
}

const MAX_SNAPSHOT_ITEMS = 200;
const MAX_INTENTS_PER_BRANCH = 200;
const MAX_NAME_LENGTH = 80;

function snapshotKey(branch: string, userId: string): string {
	return `antrean-snapshot:${branch.toLowerCase()}:${userId}`;
}

function intentsKey(branch: string): string {
	return `antrean-intents:${branch.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toUiItem(raw: unknown): UiOrderItem | null {
	if (!isRecord(raw)) return null;
	const jumlah = Number(raw.jumlah);
	if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > 99) return null;
	const tambahanRaw = Array.isArray(raw.tambahan) ? raw.tambahan : [];
	return {
		nama: String(raw.nama ?? 'Item').slice(0, MAX_NAME_LENGTH) || 'Item',
		jumlah,
		gula: typeof raw.gula === 'string' && raw.gula ? raw.gula.slice(0, 24) : null,
		es: typeof raw.es === 'string' && raw.es ? raw.es.slice(0, 24) : null,
		catatan: typeof raw.catatan === 'string' && raw.catatan ? raw.catatan.slice(0, 160) : null,
		tambahan: tambahanRaw
			.filter(isRecord)
			.slice(0, 20)
			.map((a) => ({ nama: String(a.nama ?? '').slice(0, MAX_NAME_LENGTH) }))
			.filter((a) => a.nama)
	};
}

/** Kartu lokal dari transaksi POS offline: gabung receipt + request (porsi jumbo). Murni. */
export function buildLocalCardFromPending(
	pending: Record<string, unknown>,
	branch: string
): UiOrder | null {
	if (pending.type !== 'pos_transaction') return null;
	if (typeof pending.branch === 'string' && pending.branch.toLowerCase() !== branch.toLowerCase()) {
		return null;
	}
	const request = isRecord(pending.request) ? pending.request : null;
	const receipt = isRecord(pending.receipt) ? pending.receipt : null;
	const key = request && typeof request.idempotency_key === 'string' ? request.idempotency_key : '';
	if (!key || key.length < 8 || key.length > 120) return null;
	if (!receipt || !Array.isArray(receipt.items)) return null;
	const requestItems = request && Array.isArray(request.items) ? request.items : [];
	const items: UiOrderItem[] = [];
	const count = Math.min(receipt.items.length, 100);
	for (let i = 0; i < count; i++) {
		const parsed = toUiItem(receipt.items[i]);
		if (!parsed) continue;
		const reqItem = isRecord(requestItems[i]) ? (requestItems[i] as Record<string, unknown>) : null;
		const porsi = reqItem && typeof reqItem.porsi === 'string' ? reqItem.porsi.toLowerCase() : '';
		if (porsi === 'jumbo' && !/\(jumbo\)/i.test(parsed.nama)) {
			parsed.nama = `${parsed.nama} (Jumbo)`.slice(0, MAX_NAME_LENGTH);
		}
		items.push(parsed);
	}
	if (!items.length) return null;
	const summary = isRecord(pending.summary) ? pending.summary : null;
	const createdAt =
		typeof summary?.created_at === 'string' && summary.created_at
			? String(summary.created_at)
			: typeof pending.created_at === 'string'
				? String(pending.created_at)
				: new Date().toISOString();
	return {
		idempotency_key: key,
		transaction_id: key,
		nama_pelanggan:
			request && typeof request.nama_pelanggan === 'string' && request.nama_pelanggan
				? String(request.nama_pelanggan).slice(0, 60)
				: null,
		waktu: createdAt,
		preparation_state: 'pending',
		preparation_revision: 0,
		items,
		unsynced: true
	};
}

/**
 * Gabung server + antrean offline lokal + intent status. Murni, tanpa IO.
 * Kunci dedup: idempotency_key. Intent = target terakhir menang.
 */
export function mergeQueueWithLocal(
	serverItems: OrderQueueItem[],
	pendings: Array<Record<string, unknown>>,
	intents: StatusIntent[],
	branch: string
): UiOrder[] {
	const byKey = new Map<string, UiOrder>();
	for (const item of serverItems.slice(0, MAX_SNAPSHOT_ITEMS)) {
		const key = String(item.idempotency_key || '');
		if (!key || byKey.has(key)) continue;
		byKey.set(key, {
			idempotency_key: key,
			transaction_id: String(item.transaction_id || key),
			nama_pelanggan: item.nama_pelanggan ? String(item.nama_pelanggan).slice(0, 60) : null,
			waktu: String(item.waktu),
			preparation_state: item.preparation_state === 'done' ? 'done' : 'pending',
			preparation_revision: Number(item.preparation_revision ?? 0),
			items: Array.isArray(item.items)
				? item.items
						.slice(0, 100)
						.map((raw) => toUiItem(raw))
						.filter((v): v is UiOrderItem => v !== null)
				: [],
			unsynced: false
		});
	}
	for (const pending of pendings) {
		const card = buildLocalCardFromPending(pending, branch);
		if (!card || byKey.has(card.idempotency_key)) continue;
		byKey.set(card.idempotency_key, card);
	}
	for (const intent of intents.slice(0, MAX_INTENTS_PER_BRANCH)) {
		if (intent.branch.toLowerCase() !== branch.toLowerCase()) continue;
		const card = byKey.get(intent.idempotency_key);
		if (!card) continue;
		if (card.preparation_state !== intent.target) {
			card.preparation_state = intent.target;
			card.unsynced = true;
		} else if (card.unsynced) {
			card.unsynced = true;
		}
	}
	return [...byKey.values()].sort((a, b) => {
		if (a.preparation_state !== b.preparation_state) {
			return a.preparation_state === 'pending' ? -1 : 1;
		}
		return a.waktu < b.waktu ? -1 : a.waktu > b.waktu ? 1 : 0;
	});
}

function normalizeSnapshot(raw: unknown, branch: string, userId: string): QueueSnapshot | null {
	if (!isRecord(raw)) return null;
	if (!Array.isArray(raw.items)) return null;
	const pending_count = Number(raw.pending_count);
	return {
		branch: typeof raw.branch === 'string' ? raw.branch : branch,
		userId: typeof raw.userId === 'string' ? raw.userId : userId,
		savedAt: Number(raw.savedAt) || 0,
		items: raw.items.slice(0, MAX_SNAPSHOT_ITEMS) as OrderQueueItem[],
		pending_count: Number.isFinite(pending_count) && pending_count >= 0 ? pending_count : 0
	};
}

export async function saveQueueSnapshot(
	branch: string,
	userId: string,
	items: OrderQueueItem[],
	pending_count: number
): Promise<void> {
	const snapshot: QueueSnapshot = {
		branch: branch.toLowerCase(),
		userId,
		savedAt: Date.now(),
		items: items.slice(0, MAX_SNAPSHOT_ITEMS),
		pending_count
	};
	await set(snapshotKey(branch, userId), snapshot, orderQueueStore);
}

export async function loadQueueSnapshot(
	branch: string,
	userId: string
): Promise<QueueSnapshot | null> {
	try {
		const raw = await get<unknown>(snapshotKey(branch, userId), orderQueueStore);
		if (!raw) return null;
		const snapshot = normalizeSnapshot(raw, branch, userId);
		if (!snapshot) {
			await del(snapshotKey(branch, userId), orderQueueStore);
			return null;
		}
		if (snapshot.branch.toLowerCase() !== branch.toLowerCase() || snapshot.userId !== userId) {
			return null;
		}
		return snapshot;
	} catch {
		return null;
	}
}

export async function clearQueueSnapshot(branch: string, userId: string): Promise<void> {
	try {
		await del(snapshotKey(branch, userId), orderQueueStore);
	} catch {
		// best-effort: cache lokal tidak boleh menggagalkan logout
	}
}

export async function clearOtherQueueSnapshots(
	currentBranch: string,
	currentUserId: string
): Promise<void> {
	try {
		const allKeys = await keys(orderQueueStore);
		await Promise.all(
			allKeys
				.filter((k): k is string => typeof k === 'string' && k.startsWith('antrean-snapshot:'))
				.filter((k) => k !== snapshotKey(currentBranch, currentUserId))
				.map((k) => del(k, orderQueueStore).catch(() => {}))
		);
	} catch {
		// best-effort
	}
}

function normalizeIntent(raw: unknown, branch: string): StatusIntent | null {
	if (!isRecord(raw)) return null;
	const key = typeof raw.idempotency_key === 'string' ? raw.idempotency_key : '';
	const target = raw.target === 'done' || raw.target === 'pending' ? raw.target : null;
	const expected = Number(raw.expected_revision);
	const updated = Number(raw.updated_at);
	if (!key || key.length < 8 || key.length > 120 || !target) return null;
	if (!Number.isInteger(expected) || expected < 0) return null;
	if (!Number.isFinite(updated) || updated <= 0) return null;
	return {
		branch: typeof raw.branch === 'string' ? raw.branch.toLowerCase() : branch.toLowerCase(),
		idempotency_key: key,
		target,
		expected_revision: expected,
		userId: typeof raw.userId === 'string' ? raw.userId : '',
		updated_at: updated
	};
}

export async function saveStatusIntent(intent: {
	branch: string;
	idempotency_key: string;
	target: OrderTarget;
	expected_revision: number;
	userId: string;
}): Promise<StatusIntent> {
	const record: StatusIntent = {
		branch: intent.branch.toLowerCase(),
		idempotency_key: intent.idempotency_key,
		target: intent.target,
		expected_revision: intent.expected_revision,
		userId: intent.userId,
		updated_at: Date.now()
	};
	const key = intentsKey(intent.branch);
	const existing = await get<unknown>(key, orderQueueStore).catch(() => null);
	const list: StatusIntent[] = Array.isArray(existing)
		? (existing as unknown[])
				.map((raw) => normalizeIntent(raw, intent.branch))
				.filter((v): v is StatusIntent => v !== null)
		: [];
	const next = [
		...list.filter((item) => item.idempotency_key !== record.idempotency_key),
		record
	].slice(-MAX_INTENTS_PER_BRANCH);
	await set(key, next, orderQueueStore);
	return record;
}

export async function loadStatusIntents(branch: string): Promise<StatusIntent[]> {
	try {
		const raw = await get<unknown>(intentsKey(branch), orderQueueStore);
		if (!Array.isArray(raw)) return [];
		return (raw as unknown[])
			.map((item) => normalizeIntent(item, branch))
			.filter((v): v is StatusIntent => v !== null)
			.filter((item) => item.branch === branch.toLowerCase());
	} catch {
		return [];
	}
}

export async function removeStatusIntent(
	branch: string,
	idempotency_key: string,
	onlyIf?: { target?: OrderTarget; updated_at?: number }
): Promise<void> {
	try {
		const key = intentsKey(branch);
		const raw = await get<unknown>(key, orderQueueStore);
		if (!Array.isArray(raw)) return;
		const next = (raw as unknown[])
			.map((item) => normalizeIntent(item, branch))
			.filter((v): v is StatusIntent => v !== null)
			.filter((item) => {
				if (item.idempotency_key !== idempotency_key) return true;
				if (onlyIf?.target && item.target !== onlyIf.target) return true;
				if (onlyIf?.updated_at && item.updated_at !== onlyIf.updated_at) return true;
				return false;
			});
		await set(key, next, orderQueueStore);
	} catch {
		// best-effort
	}
}
