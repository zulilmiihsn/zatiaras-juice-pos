import type { DurableObjectStorage } from '@cloudflare/workers-types';

type Storage = Pick<DurableObjectStorage, 'transaction'>;
interface Tx {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
}
type Kind = 'shift-opened' | 'sale-recorded' | 'shift-closed';

/** Outbox references immutable records written in the same transaction. */
export async function enqueueKioskProjection(tx: Tx, kind: Kind, recordKey: string) {
	const sequence = ((await tx.get<number>('projection:tail')) ?? 0) + 1;
	if (!Number.isSafeInteger(sequence)) throw new Error('Antrean sinkronisasi melebihi batas aman');
	await tx.put(`projection:event:${sequence}`, { sequence, kind, recordKey });
	await tx.put('projection:tail', sequence);
}

export interface KioskProjectionEvent {
	sequence: number;
	kind: Kind;
	record: unknown;
}

export async function peekKioskProjection(storage: Storage): Promise<KioskProjectionEvent | null> {
	return storage.transaction(async (tx) => {
		const sequence = ((await tx.get<number>('projection:ack')) ?? 0) + 1;
		if (sequence > ((await tx.get<number>('projection:tail')) ?? 0)) return null;
		const event = await tx.get<{ sequence: number; kind: Kind; recordKey: string }>(
			`projection:event:${sequence}`
		);
		if (!event) throw new Error('Urutan antrean sinkronisasi tidak lengkap');
		const record = await tx.get(event.recordKey);
		if (!record) throw new Error('Data antrean sinkronisasi tidak ditemukan');
		return { sequence, kind: event.kind, record };
	});
}

/** Only the projector may call this, after a confirmed, idempotent central commit. */
export async function acknowledgeKioskProjection(storage: Storage, sequence: number) {
	return storage.transaction(async (tx) => {
		const ack = (await tx.get<number>('projection:ack')) ?? 0;
		if (!Number.isSafeInteger(sequence) || sequence < 1) return false;
		if (sequence <= ack) return true;
		if (sequence !== ack + 1 || !(await tx.get(`projection:event:${sequence}`))) return false;
		await tx.put('projection:ack', sequence);
		await tx.delete(`projection:event:${sequence}`);
		return true;
	});
}
