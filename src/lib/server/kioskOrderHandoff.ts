import type { D1Database, DurableObjectStorage } from '@cloudflare/workers-types';
import { formatDateYmdWita } from '$lib/utils/dateTime';
import { seedKioskInventory, type KioskInventorySeed } from './kioskInventory';
import type { BranchContext } from './branchResolver';

/** Read only after legacy allocation is fenced; an open legacy shift aborts preparation. */
export async function readKioskOrderHandoff(db: D1Database, branch: BranchContext, now: number) {
	const date = formatDateYmdWita(new Date(now));
	const row = await db
		.prepare(
			`SELECT MAX(
		COALESCE((SELECT terakhir FROM pos_nomor_harian WHERE cabang_id=? AND tanggal=?),0),
		COALESCE((SELECT MAX(nomor_harian) FROM buku_kas WHERE cabang_id=? AND tanggal_nomor=?),0)
	) AS last_number FROM kiosk_shift_cutover
	WHERE cabang_id=? AND NOT EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id=? AND is_active=1 AND kiosk_managed=0)`
		)
		.bind(branch, date, branch, date, branch, branch)
		.first<{ last_number: number }>();
	if (!row || !Number.isSafeInteger(row.last_number) || row.last_number < 0)
		throw new Error('Penghitung belum dapat dialihkan dari jalur pusat');
	return { date, lastNumber: row.last_number };
}

/** First seed wins; retries neither rewind the date nor replace numbers already issued. */
export async function seedKioskOrderHandoff(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	seed: Awaited<ReturnType<typeof readKioskOrderHandoff>>,
	inventory: KioskInventorySeed
) {
	return storage.transaction(async (tx) => {
		const initial = await tx.get<typeof seed>('sale:handoff');
		if (initial) return initial;
		const key = 'sale:counter:' + seed.date;
		const counter = await tx.get<number>(key);
		if (counter !== undefined) throw new Error('Penghitung kios sudah dipakai sebelum alih jalur');
		await tx.put(key, seed.lastNumber);
		await seedKioskInventory(tx, inventory);
		await tx.put('sale:handoff', seed);
		return seed;
	});
}
