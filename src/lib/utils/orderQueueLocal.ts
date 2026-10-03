import { del, get, keys, update } from 'idb-keyval';
import { orderQueueStore } from '$lib/utils/idbStores';
import type { OrderQueueItem, TransitionOrderResult } from '$lib/server/orderQueue/types';

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
	buku_kas_id: string | null;
	transaction_id: string;
	nominal: number | null;
	/** Nomor antrean harian resmi. Null = antrean lokal belum sinkron. */
	nomor_harian: number | null;
	nama_pelanggan: string | null;
	waktu: string;
	preparation_state: OrderTarget;
	preparation_revision: number;
	preparation_completed_at: string | null;
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

export interface StatusIntentOperation {
	idempotency_key: string;
	intent_id: string;
	target: OrderTarget;
	expected_revision: number;
	updated_at: number;
}

export interface StatusIntent {
	branch: string;
	idempotency_key: string;
	target: OrderTarget;
	expected_revision: number;
	userId: string;
	updated_at: number;
	intent_id?: string;
	card?: UiOrder;
	in_flight?: StatusIntentOperation;
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
	const rawAmount = receipt.total_amount ?? summary?.total_amount;
	const amount = rawAmount == null ? NaN : Number(rawAmount);
	const createdAt =
		typeof summary?.created_at === 'string' && summary.created_at
			? String(summary.created_at)
			: typeof pending.created_at === 'string'
				? String(pending.created_at)
				: new Date().toISOString();
	return {
		idempotency_key: key,
		buku_kas_id: null,
		transaction_id: key,
		nominal: Number.isFinite(amount) && amount >= 0 ? amount : null,
		// Nomor resmi hanya ada sesudah server commit (saat replay sinkron).
		nomor_harian: null,
		nama_pelanggan:
			request && typeof request.nama_pelanggan === 'string' && request.nama_pelanggan
				? String(request.nama_pelanggan).slice(0, 60)
				: null,
		waktu: createdAt,
		preparation_state: 'pending',
		preparation_revision: 0,
		preparation_completed_at: null,
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
	branch: string,
	userId: string
): UiOrder[] {
	const byKey = new Map<string, UiOrder>();
	for (const item of serverItems) {
		const key = String(item.idempotency_key || '');
		if (!key || byKey.has(key)) continue;
		byKey.set(key, {
			idempotency_key: key,
			buku_kas_id: item.buku_kas_id ?? null,
			transaction_id: String(item.transaction_id || key),
			nominal:
				item.nominal != null && Number.isFinite(Number(item.nominal)) ? Number(item.nominal) : null,
			nomor_harian:
				item.nomor_harian != null && Number.isInteger(Number(item.nomor_harian))
					? Number(item.nomor_harian)
					: null,
			nama_pelanggan: item.nama_pelanggan ? String(item.nama_pelanggan).slice(0, 60) : null,
			waktu: String(item.waktu),
			preparation_state: item.preparation_state === 'done' ? 'done' : 'pending',
			preparation_revision: Number(item.preparation_revision ?? 0),
			preparation_completed_at: item.preparation_completed_at ?? null,
			items: Array.isArray(item.items)
				? item.items
						.slice(0, 100)
						.map((raw) => toUiItem(raw))
						.filter((v): v is UiOrderItem => v !== null)
				: [],
			unsynced: false
		});
	}
	for (const intent of intents) {
		if (
			intent.branch.toLowerCase() !== branch.toLowerCase() ||
			intent.userId !== userId ||
			byKey.has(intent.idempotency_key)
		)
			continue;
		const card = normalizeCard(intent.card, intent.idempotency_key);
		if (card) byKey.set(intent.idempotency_key, card);
	}
	for (const pending of pendings) {
		const card = buildLocalCardFromPending(pending, branch);
		if (!card || byKey.has(card.idempotency_key)) continue;
		byKey.set(card.idempotency_key, card);
	}
	for (const intent of intents) {
		if (intent.branch.toLowerCase() !== branch.toLowerCase() || intent.userId !== userId) continue;
		const card = byKey.get(intent.idempotency_key);
		if (!card) continue;
		card.preparation_state = intent.target;
		card.unsynced = true;
		card.preparation_completed_at =
			intent.target === 'done' ? new Date(intent.updated_at).toISOString() : null;
	}
	const compare = (left: string, right: string): number =>
		left < right ? -1 : left > right ? 1 : 0;
	return [...byKey.values()].sort((a, b) => {
		if (a.preparation_state !== b.preparation_state) {
			return a.preparation_state === 'pending' ? -1 : 1;
		}
		if (a.preparation_state === 'pending') {
			return (
				compare(a.waktu, b.waktu) ||
				compare(a.buku_kas_id ?? a.idempotency_key, b.buku_kas_id ?? b.idempotency_key)
			);
		}
		return (
			compare(b.preparation_completed_at ?? b.waktu, a.preparation_completed_at ?? a.waktu) ||
			compare(b.buku_kas_id ?? b.idempotency_key, a.buku_kas_id ?? a.idempotency_key)
		);
	});
}

/**
 * Saring kartu antrean berdasarkan nama pelanggan atau nomor harian.
 * Murni, tanpa IO: dipakai daftar online, snapshot offline, dan kartu lokal
 * yang belum sinkron. Kata kunci angka mencocokkan sebagian nomor
 * ("42" cocok 42/142; "042" dinormalisasi dulu); nama dicocokkan sebagian
 * tanpa peduli kapital. Beberapa kata digabung AND ("142 haura" wajib cocok
 * nomor sekaligus nama, urutan bebas). Hanya mencari pada kartu yang sudah
 * dimuat.
 */
export function filterQueueOrders(items: UiOrder[], keyword: string): UiOrder[] {
	const tokens = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!tokens.length) return items;
	return items.filter((card) => {
		const nama = card.nama_pelanggan ? card.nama_pelanggan.toLowerCase() : '';
		const nomor = card.nomor_harian != null ? String(card.nomor_harian) : null;
		return tokens.every((token) => {
			if (nama && nama.includes(token)) return true;
			const nomorQuery = token.replace(/^0+/, '') || '0';
			if (nomor != null && nomor.includes(nomorQuery)) return true;
			return false;
		});
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
	pending_count: number,
	options: { isCurrent?: () => boolean } = {}
): Promise<void> {
	const snapshot: QueueSnapshot = {
		branch: branch.toLowerCase(),
		userId,
		savedAt: Date.now(),
		items: items.slice(0, MAX_SNAPSHOT_ITEMS),
		pending_count
	};
	await update<unknown>(
		snapshotKey(branch, userId),
		(previous) => {
			if (options.isCurrent && !options.isCurrent()) return previous;
			return snapshot;
		},
		orderQueueStore
	);
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

export const STATUS_STORAGE_MESSAGE =
	'Penyimpanan perubahan status tidak dapat dibaca. Coba lagi tanpa menghapus data perangkat.';

function normalizeCard(raw: unknown, key: string): UiOrder | undefined {
	if (
		!isRecord(raw) ||
		raw.idempotency_key !== key ||
		typeof raw.transaction_id !== 'string' ||
		!raw.transaction_id ||
		typeof raw.waktu !== 'string' ||
		!Number.isFinite(Date.parse(raw.waktu)) ||
		(raw.preparation_state !== 'pending' && raw.preparation_state !== 'done') ||
		!Number.isInteger(raw.preparation_revision) ||
		Number(raw.preparation_revision) < 0 ||
		!Array.isArray(raw.items)
	)
		return undefined;
	const items = raw.items
		.slice(0, 100)
		.map(toUiItem)
		.filter((item): item is UiOrderItem => item !== null);
	if (!items.length) return undefined;
	return {
		idempotency_key: key,
		buku_kas_id: typeof raw.buku_kas_id === 'string' ? raw.buku_kas_id.slice(0, 120) : null,
		transaction_id: raw.transaction_id.slice(0, 120),
		nominal:
			typeof raw.nominal === 'number' && Number.isFinite(raw.nominal) && raw.nominal >= 0
				? raw.nominal
				: null,
		nomor_harian:
			typeof raw.nomor_harian === 'number' &&
			Number.isSafeInteger(raw.nomor_harian) &&
			raw.nomor_harian > 0
				? raw.nomor_harian
				: null,
		nama_pelanggan: typeof raw.nama_pelanggan === 'string' ? raw.nama_pelanggan.slice(0, 60) : null,
		waktu: raw.waktu,
		preparation_state: raw.preparation_state,
		preparation_revision: Number(raw.preparation_revision),
		preparation_completed_at:
			typeof raw.preparation_completed_at === 'string' &&
			Number.isFinite(Date.parse(raw.preparation_completed_at))
				? raw.preparation_completed_at
				: null,
		items,
		unsynced: raw.unsynced === true
	};
}

function normalizeOperation(raw: unknown, key: string): StatusIntentOperation | null {
	if (
		!isRecord(raw) ||
		raw.idempotency_key !== key ||
		typeof raw.intent_id !== 'string' ||
		!raw.intent_id ||
		(raw.target !== 'pending' && raw.target !== 'done') ||
		typeof raw.expected_revision !== 'number' ||
		!Number.isSafeInteger(raw.expected_revision) ||
		raw.expected_revision < 0 ||
		typeof raw.updated_at !== 'number' ||
		!Number.isFinite(raw.updated_at) ||
		raw.updated_at <= 0
	)
		return null;
	return {
		idempotency_key: key,
		intent_id: raw.intent_id,
		target: raw.target,
		expected_revision: raw.expected_revision,
		updated_at: raw.updated_at
	};
}

function normalizeIntents(raw: unknown, branch: string): StatusIntent[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new Error(STATUS_STORAGE_MESSAGE);
	return raw.map((value: unknown) => {
		if (!isRecord(value)) throw new Error(STATUS_STORAGE_MESSAGE);
		const key = value.idempotency_key;
		if (
			typeof key !== 'string' ||
			key.length < 8 ||
			key.length > 120 ||
			typeof value.branch !== 'string' ||
			value.branch.toLowerCase() !== branch.toLowerCase() ||
			typeof value.userId !== 'string' ||
			(value.target !== 'pending' && value.target !== 'done') ||
			typeof value.expected_revision !== 'number' ||
			!Number.isSafeInteger(value.expected_revision) ||
			value.expected_revision < 0 ||
			typeof value.updated_at !== 'number' ||
			!Number.isFinite(value.updated_at) ||
			value.updated_at <= 0 ||
			(value.intent_id !== undefined && (typeof value.intent_id !== 'string' || !value.intent_id))
		) {
			throw new Error(STATUS_STORAGE_MESSAGE);
		}
		const flight =
			value.in_flight === undefined ? undefined : normalizeOperation(value.in_flight, key);
		if (flight === null) throw new Error(STATUS_STORAGE_MESSAGE);
		return {
			branch: branch.toLowerCase(),
			idempotency_key: key,
			target: value.target,
			expected_revision: value.expected_revision,
			userId: value.userId,
			updated_at: value.updated_at,
			intent_id: value.intent_id as string | undefined,
			card: normalizeCard(value.card, key),
			in_flight: flight
		};
	});
}

function matchesOperation(
	current: StatusIntentOperation | undefined,
	sent: StatusIntentOperation
): boolean {
	return (
		!!current &&
		current.idempotency_key === sent.idempotency_key &&
		current.intent_id === sent.intent_id &&
		current.target === sent.target &&
		current.expected_revision === sent.expected_revision &&
		current.updated_at === sent.updated_at
	);
}

function desiredIsSent(current: StatusIntent, sent: StatusIntentOperation): boolean {
	return (
		current.intent_id === sent.intent_id &&
		current.target === sent.target &&
		current.expected_revision === sent.expected_revision &&
		current.updated_at === sent.updated_at
	);
}

export async function saveStatusIntent(intent: {
	branch: string;
	idempotency_key: string;
	target: OrderTarget;
	expected_revision: number;
	userId: string;
	card?: UiOrder;
}): Promise<StatusIntent> {
	const record = normalizeIntents(
		[{ ...intent, intent_id: crypto.randomUUID(), updated_at: Date.now() }],
		intent.branch
	)[0];
	await update<unknown>(
		intentsKey(intent.branch),
		(raw) => {
			const list = normalizeIntents(raw, intent.branch);
			const index = list.findIndex((item) => item.idempotency_key === record.idempotency_key);
			if (index < 0) {
				if (list.length >= MAX_INTENTS_PER_BRANCH)
					throw new Error(
						'Terlalu banyak perubahan status belum tersinkron. Sinkronkan dulu lalu coba lagi.'
					);
				list.push(record);
			} else {
				record.in_flight = list[index].in_flight;
				list[index] = record;
			}
			return list;
		},
		orderQueueStore
	);
	return record;
}

export async function loadStatusIntents(branch: string): Promise<StatusIntent[]> {
	return normalizeIntents(await get<unknown>(intentsKey(branch), orderQueueStore), branch);
}

export async function stageStatusIntent(
	branch: string,
	idempotencyKey: string
): Promise<StatusIntentOperation | null> {
	let staged: StatusIntentOperation | null = null;
	await update<unknown>(
		intentsKey(branch),
		(raw) => {
			const list = normalizeIntents(raw, branch);
			const current = list.find((item) => item.idempotency_key === idempotencyKey);
			if (!current) return list;
			if (!current.in_flight) {
				current.intent_id ??= crypto.randomUUID();
				current.in_flight = {
					idempotency_key: current.idempotency_key,
					intent_id: current.intent_id,
					target: current.target,
					expected_revision: current.expected_revision,
					updated_at: current.updated_at
				};
			}
			staged = current.in_flight;
			return list;
		},
		orderQueueStore
	);
	return staged;
}

export async function acknowledgeStatusIntent(
	branch: string,
	sent: StatusIntentOperation,
	result: TransitionOrderResult
): Promise<void> {
	await update<unknown>(
		intentsKey(branch),
		(raw) => {
			const list = normalizeIntents(raw, branch);
			return list.filter((current) => {
				if (
					current.idempotency_key !== sent.idempotency_key ||
					!matchesOperation(current.in_flight, sent)
				)
					return true;
				if (desiredIsSent(current, sent)) return false;
				delete current.in_flight;
				const revision = result.preparation_revision;
				if (
					current.expected_revision === sent.expected_revision &&
					(revision === sent.expected_revision + 1 ||
						(result.idempotent && revision === sent.expected_revision))
				) {
					current.expected_revision = revision;
					if (current.card) {
						current.card.preparation_state = result.preparation_state;
						current.card.preparation_revision = revision;
						current.card.preparation_completed_at = result.preparation_completed_at;
					}
				}
				return true;
			});
		},
		orderQueueStore
	);
}

export async function rejectStagedStatusIntent(
	branch: string,
	sent: StatusIntentOperation
): Promise<boolean> {
	let resolved = false;
	await update<unknown>(
		intentsKey(branch),
		(raw) =>
			normalizeIntents(raw, branch).filter((current) => {
				if (
					current.idempotency_key !== sent.idempotency_key ||
					!matchesOperation(current.in_flight, sent)
				)
					return true;
				resolved = true;
				if (desiredIsSent(current, sent)) return false;
				delete current.in_flight;
				return true;
			}),
		orderQueueStore
	);
	return resolved;
}

export async function removeStatusIntent(
	branch: string,
	idempotency_key: string,
	onlyIf?: {
		target?: OrderTarget;
		updated_at?: number;
		intent_id?: string;
		expected_revision?: number;
	}
): Promise<boolean> {
	let removed = false;
	await update<unknown>(
		intentsKey(branch),
		(raw) =>
			normalizeIntents(raw, branch).filter((current) => {
				if (current.idempotency_key !== idempotency_key || current.in_flight) return true;
				if (onlyIf) {
					if (
						(onlyIf.intent_id && current.intent_id !== onlyIf.intent_id) ||
						(!onlyIf.intent_id && current.intent_id !== undefined) ||
						(onlyIf.target !== undefined && current.target !== onlyIf.target) ||
						(onlyIf.updated_at !== undefined && current.updated_at !== onlyIf.updated_at) ||
						(onlyIf.expected_revision !== undefined &&
							current.expected_revision !== onlyIf.expected_revision)
					)
						return true;
					if (
						!onlyIf.intent_id &&
						(onlyIf.target === undefined ||
							onlyIf.updated_at === undefined ||
							onlyIf.expected_revision === undefined)
					)
						return true;
				}
				removed = true;
				return false;
			}),
		orderQueueStore
	);
	return removed;
}
