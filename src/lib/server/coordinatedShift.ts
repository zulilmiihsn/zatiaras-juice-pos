import { enqueueKioskProjection } from './kioskProjectionQueue';
import { normalizeMoney } from '$lib/utils/money';

export interface OpenShift {
	id: string;
	userId: string;
	openingCash: number;
	openedAt: number;
}

interface ShiftTransaction {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
}

interface SaleTotals {
	cashSales: number;
	nonCashSales: number;
	saleCount: number;
}

async function readSaleTotals(tx: Pick<ShiftTransaction, 'get'>, id: string): Promise<SaleTotals> {
	return (
		(await tx.get<SaleTotals>('shift:totals:' + id)) ?? {
			cashSales: 0,
			nonCashSales: 0,
			saleCount: 0
		}
	);
}

async function summarizeSales(tx: Pick<ShiftTransaction, 'get'>, shift: OpenShift) {
	const totals = await readSaleTotals(tx, shift.id);
	return { ...totals, expectedCash: shift.openingCash + totals.cashSales };
}

/** Called in the same storage transaction as the idempotent sale write. */
export async function addCoordinatedSaleTotals(
	tx: ShiftTransaction,
	shift: OpenShift,
	amount: number,
	method: 'tunai' | 'non-tunai'
) {
	const totals = await readSaleTotals(tx, shift.id);
	totals.saleCount++;
	if (method === 'tunai') totals.cashSales += amount;
	else totals.nonCashSales += amount;
	if (
		![
			totals.saleCount,
			totals.cashSales + totals.nonCashSales,
			shift.openingCash + totals.cashSales
		].every(Number.isSafeInteger)
	)
		return false;
	await tx.put('shift:totals:' + shift.id, totals);
	return true;
}

export async function readCoordinatedShift(tx: Pick<ShiftTransaction, 'get'>) {
	const active = await tx.get<OpenShift | null>('shift:active');
	if (active === undefined) return { state: 'uninitialized' } as const;
	if (active)
		return {
			state: 'open',
			id: active.id,
			openingCash: active.openingCash,
			salesSummary: await summarizeSales(tx, active)
		} as const;
	const policy = await tx.get('shift:open-policy');
	return policy === 'unlocked' || policy === 'pin'
		? ({ state: 'closed' } as const)
		: ({ state: 'policy-blocked' } as const);
}

/** Run inside the branch object's storage.transaction. Only a reconciled branch may open. */
export async function openCoordinatedShift(tx: ShiftTransaction, input: OpenShift) {
	if (
		!/^[a-zA-Z0-9_-]{1,128}$/.test(input.id) ||
		!input.userId ||
		!Number.isSafeInteger(input.openingCash) ||
		input.openingCash < 0 ||
		!Number.isSafeInteger(input.openedAt) ||
		input.openedAt <= 0
	) {
		throw new Error('Data buka toko tidak valid');
	}
	const key = `shift:request:${input.id}`;
	const prior = await tx.get<{ userId: string; shift: OpenShift }>(key);
	if (prior) {
		if (prior.userId !== input.userId || prior.shift.openingCash !== input.openingCash)
			return { status: 'conflict' } as const;
		return { status: 'replayed', shift: prior.shift } as const;
	}
	const active = await tx.get<OpenShift | null>('shift:active');
	if (active === undefined) return { status: 'uninitialized' } as const;
	if (active && active.openingCash !== input.openingCash) return { status: 'conflict' } as const;
	const shift = active ?? { ...input, openingCash: normalizeMoney(input.openingCash) };
	if (!active) {
		await tx.put('shift:active', shift);
		await enqueueKioskProjection(tx, 'shift-opened', key);
	}
	// Keep even the second HP's receipt: a delayed retry after close must not reopen the shop.
	await tx.put(key, { userId: input.userId, shift });
	return { status: active ? 'already-open' : 'opened', shift } as const;
}

export interface ClosedShift extends OpenShift {
	closedAt: number;
	closedBy: string;
	salesSummary: Awaited<ReturnType<typeof summarizeSales>>;
}

/** Record the original close before clearing the active pointer in the same transaction. */
export async function closeCoordinatedShift(
	tx: ShiftTransaction,
	id: string,
	userId: string,
	now: number
) {
	const key = 'shift:closed:' + id;
	const prior = await tx.get<ClosedShift>(key);
	if (prior) return { status: 'replayed', shift: prior } as const;
	const active = await tx.get<OpenShift | null>('shift:active');
	if (!active || active.id !== id) return { status: 'conflict' } as const;
	const shift = {
		...active,
		closedAt: Math.max(active.openedAt, now),
		closedBy: userId,
		salesSummary: await summarizeSales(tx, active)
	};
	await tx.put(key, shift);
	await tx.put('shift:active', null);
	await enqueueKioskProjection(tx, 'shift-closed', key);
	return { status: 'closed', shift } as const;
}
