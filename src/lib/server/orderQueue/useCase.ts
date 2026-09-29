import type { D1Database } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from '$lib/server/branchResolver';
import { auditDataChange, publish } from '$lib/server/dataApiHelpers';
import {
	countPendingOrders as countPending,
	countPendingOrdersBefore as countPendingBefore,
	decodeCursor,
	encodeCursor,
	getHeaderByIdempotency,
	listDetailsByBukuKasIds,
	listHeaders,
	singleChange,
	type OrderHeaderRow
} from './repository';
import type {
	ListOrderQueueOptions,
	OrderQueueItem,
	OrderQueuePage,
	PreparationState,
	TransitionOrderInput,
	TransitionOrderResult
} from './types';

export class OrderQueueError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'OrderQueueError';
		this.status = status;
	}
}

function parseState(raw: unknown): PreparationState {
	if (raw === undefined || raw === null || raw === '') return 'pending';
	if (raw === 'pending' || raw === 'done') return raw;
	throw new OrderQueueError(400, 'Parameter state harus pending atau done');
}

function parseLimit(raw: unknown): number {
	if (raw === undefined || raw === null || raw === '') return 50;
	const parsed = typeof raw === 'string' ? Number(raw) : Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw new OrderQueueError(400, 'Parameter limit harus 1 sampai 100');
	}
	return parsed;
}

function toItem(header: OrderHeaderRow, details: OrderQueueItem['items']): OrderQueueItem {
	return {
		buku_kas_id: String(header.id),
		transaction_id: String(header.transaction_id),
		idempotency_key: String(header.idempotency_key),
		nama_pelanggan: header.nama_pelanggan ? String(header.nama_pelanggan) : null,
		waktu: String(header.waktu),
		metode_bayar: header.metode_bayar ? String(header.metode_bayar) : null,
		nominal: Number(header.nominal || 0),
		jumlah: Number(header.jumlah || 0),
		nomor_harian:
			header.nomor_harian != null && Number.isInteger(Number(header.nomor_harian))
				? Number(header.nomor_harian)
				: null,
		tanggal_nomor: header.tanggal_nomor ? String(header.tanggal_nomor) : null,
		preparation_state: header.preparation_state as PreparationState,
		preparation_revision: Number(header.preparation_revision ?? 0),
		preparation_completed_at: header.preparation_completed_at
			? String(header.preparation_completed_at)
			: null,
		preparation_completed_by: header.preparation_completed_by
			? String(header.preparation_completed_by)
			: null,
		items: details
	};
}

function resolveDb(
	platform: App.Platform | undefined,
	branch: BranchContext,
	explicitDb?: D1Database
): D1Database {
	if (explicitDb) return explicitDb;
	return getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
}

/** Resolver DB untuk route tipis Antrean (hindari import DB langsung di route). */
export function resolveOrderQueueDb(
	platform: App.Platform | undefined,
	branch: BranchContext
): D1Database {
	return getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
}

export async function listOrderQueue(
	db: D1Database,
	branch: BranchContext,
	options: ListOrderQueueOptions = {}
): Promise<OrderQueuePage> {
	const state = parseState(options.state);
	const limit = parseLimit(options.limit);
	let cursor: { sortValue: string; id: string } | null = null;
	if (options.cursor) {
		try {
			cursor = decodeCursor(String(options.cursor));
		} catch {
			throw new OrderQueueError(400, 'Cursor antrean tidak valid');
		}
	}
	const rows = await listHeaders(db, branch, state, limit + 1, cursor);
	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const details = await listDetailsByBukuKasIds(
		db,
		branch,
		pageRows.map((row) => String(row.id))
	);
	const items = pageRows.map((row) => toItem(row, details.get(String(row.id)) ?? []));
	let nextCursor: string | null = null;
	if (hasMore) {
		const last = pageRows[pageRows.length - 1];
		nextCursor = encodeCursor({
			sortValue:
				state === 'pending'
					? String(last.waktu)
					: String(last.preparation_completed_at || last.waktu),
			id: String(last.id)
		});
	}
	const pending_count = await countPending(db, branch);
	return { items, nextCursor, hasMore, pending_count };
}

export async function countPendingOrders(db: D1Database, branch: BranchContext): Promise<number> {
	return countPending(db, branch);
}

export async function countPendingOrdersBefore(
	db: D1Database,
	branch: BranchContext,
	cutoff: string
): Promise<number> {
	return countPendingBefore(db, branch, cutoff);
}

function parseTransitionInput(input: TransitionOrderInput): {
	idempotencyKey: string;
	target: PreparationState;
	expectedRevision: number;
} {
	const key = typeof input.idempotency_key === 'string' ? input.idempotency_key.trim() : '';
	if (!key || key.length < 8 || key.length > 120) {
		throw new OrderQueueError(400, 'idempotency_key tidak valid');
	}
	if (input.target !== 'pending' && input.target !== 'done') {
		throw new OrderQueueError(400, 'Target status harus pending atau done');
	}
	const expected =
		typeof input.expected_revision === 'string'
			? Number(input.expected_revision)
			: Number(input.expected_revision);
	if (!Number.isInteger(expected) || expected < 0) {
		throw new OrderQueueError(400, 'expected_revision tidak valid');
	}
	return { idempotencyKey: key, target: input.target, expectedRevision: expected };
}

export async function transitionOrderPreparation(
	db: D1Database,
	branch: BranchContext,
	session: { userId: string; role: string },
	input: TransitionOrderInput,
	platform?: App.Platform,
	explicitDb?: D1Database
): Promise<TransitionOrderResult> {
	const resolvedDb = resolveDb(platform, branch, explicitDb ?? db);
	const { idempotencyKey, target, expectedRevision } = parseTransitionInput(input);
	const header = await getHeaderByIdempotency(resolvedDb, branch, idempotencyKey);
	if (!header) throw new OrderQueueError(404, 'Pesanan tidak ditemukan');
	if (!header.preparation_state) {
		throw new OrderQueueError(409, 'Transaksi lama tidak mendukung Antrean');
	}
	if (header.preparation_state === target) {
		return {
			idempotency_key: idempotencyKey,
			transaction_id: String(header.transaction_id),
			preparation_state: header.preparation_state,
			preparation_revision: Number(header.preparation_revision ?? 0),
			preparation_completed_at: header.preparation_completed_at
				? String(header.preparation_completed_at)
				: null,
			preparation_completed_by: header.preparation_completed_by
				? String(header.preparation_completed_by)
				: null,
			idempotent: true
		};
	}
	if (Number(header.preparation_revision ?? 0) !== expectedRevision) {
		throw new OrderQueueError(409, 'Pesanan berubah bersamaan. Muat ulang lalu coba lagi.');
	}
	const now = new Date().toISOString();
	const completedAt = target === 'done' ? now : null;
	const completedBy = target === 'done' ? session.userId : null;
	const updated = (await resolvedDb
		.prepare(
			`UPDATE buku_kas
			 SET preparation_state = ?, preparation_revision = preparation_revision + 1,
				revision = revision + 1,
				preparation_completed_at = ?, preparation_completed_by = ?,
				updated_at = ?
			 WHERE cabang_id = ? AND id = ? AND sumber = 'pos'
				AND preparation_state = ? AND preparation_revision = ?`
		)
		.bind(
			target,
			completedAt,
			completedBy,
			now,
			branch,
			String(header.id),
			String(header.preparation_state),
			expectedRevision
		)
		.run()) as unknown;
	if (singleChange(updated) !== 1) {
		const reread = await getHeaderByIdempotency(resolvedDb, branch, idempotencyKey);
		if (reread?.preparation_state === target) {
			return {
				idempotency_key: idempotencyKey,
				transaction_id: String(reread.transaction_id),
				preparation_state: target,
				preparation_revision: Number(reread.preparation_revision ?? 0),
				preparation_completed_at: reread.preparation_completed_at
					? String(reread.preparation_completed_at)
					: null,
				preparation_completed_by: reread.preparation_completed_by
					? String(reread.preparation_completed_by)
					: null,
				idempotent: true
			};
		}
		throw new OrderQueueError(409, 'Pesanan berubah bersamaan. Muat ulang lalu coba lagi.');
	}
	const finalRevision = expectedRevision + 1;
	try {
		await Promise.all([
			publish(platform, branch, 'buku_kas', 'update', {
				id: String(header.id),
				transaction_id: String(header.transaction_id)
			}),
			publish(platform, branch, 'transaksi_kasir', 'update', {
				transaction_id: String(header.transaction_id)
			}),
			auditDataChange(
				resolvedDb,
				branch,
				session as App.Locals['authSession'],
				'buku_kas',
				target === 'done' ? 'order_done' : 'order_reopened',
				String(header.id),
				{
					transaction_id: String(header.transaction_id),
					from: String(header.preparation_state),
					to: target
				}
			)
		]);
	} catch (error) {
		console.warn('[antrean] publish/audit best-effort gagal', error);
	}
	return {
		idempotency_key: idempotencyKey,
		transaction_id: String(header.transaction_id),
		preparation_state: target,
		preparation_revision: finalRevision,
		preparation_completed_at: completedAt,
		preparation_completed_by: completedBy,
		idempotent: false
	};
}
