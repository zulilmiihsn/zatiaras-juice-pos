import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from './branchResolver';
import { KIOSK_SHIFT_PIN } from './kioskShiftPin';

/** Stop the coordinator before releasing the D1 fence. An interrupted rollback stays paused. */
export async function rollbackKioskPilot(
	env: App.Platform['env'],
	storage: Pick<DurableObjectStorage, 'transaction'>,
	branch: BranchContext
) {
	const db = getD1Database(env, branch);
	await storage.transaction(async (tx) => {
		if ((await tx.get('shift:active')) !== null)
			throw new Error('Mode kios harus diinisialisasi dan shift harus tutup');
		const tail = (await tx.get<number>('projection:tail')) ?? 0;
		const ack = (await tx.get<number>('projection:ack')) ?? 0;
		if (tail !== ack) throw new Error('Sinkronisasi kios belum selesai');
		// This conflicts with concurrent opens that read policy and write the active shift.
		await tx.put('shift:open-policy', 'rolled-back');
		await tx.delete(KIOSK_SHIFT_PIN);
	});
	const { meta } = await db
		.prepare(
			`DELETE FROM kiosk_shift_cutover WHERE cabang_id=?
		AND NOT EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id=? AND is_active=1)`
		)
		.bind(branch, branch)
		.run();
	if (
		meta.changes !== 1 &&
		(await db.prepare('SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=?').bind(branch).first())
	)
		throw new Error('Jalur pusat belum dapat dibuka; koordinator tetap dijeda');
	return { status: 'rolled-back' } as const;
}
