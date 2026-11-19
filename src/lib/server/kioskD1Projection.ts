import { getD1Database, type BranchContext } from './branchResolver';
import { executeCheckout } from './checkout/checkoutUseCase';
import {
	acknowledgeKioskProjection,
	peekKioskProjection,
	type KioskProjectionEvent
} from './kioskProjectionQueue';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import type { CoordinatedSaleRecord } from './checkout/coordinatedSale';
import type { ClosedShift, OpenShift } from './coordinatedShift';

/** Trusted outbox only: never accept a projection payload from a browser. */
export async function projectKioskEvent(
	platform: App.Platform,
	branch: BranchContext,
	event: KioskProjectionEvent
) {
	const db = getD1Database(platform.env, branch);
	const fence = await db
		.prepare('SELECT cabang_id FROM kiosk_shift_cutover WHERE cabang_id=?')
		.bind(branch)
		.first();
	if (!fence) throw new Error('Cabang belum dialihkan untuk sinkronisasi kios');
	if (event.kind === 'shift-opened') {
		const { shift } = event.record as { shift: OpenShift };
		const openedAt = new Date(shift.openedAt).toISOString();
		await db
			.prepare(
				`INSERT INTO sesi_toko(id,cabang_id,kas_awal,waktu_buka,is_active,created_at,updated_at,kiosk_managed)
			SELECT ?,cabang_id,?,?,1,?,?,1 FROM kiosk_shift_cutover WHERE cabang_id=?
			ON CONFLICT(id) DO NOTHING`
			)
			.bind(shift.id, shift.openingCash, openedAt, openedAt, openedAt, branch)
			.run();
		const saved = await db
			.prepare(
				'SELECT id FROM sesi_toko WHERE cabang_id=? AND id=? AND kas_awal=? AND waktu_buka=? AND kiosk_managed=1'
			)
			.bind(branch, shift.id, shift.openingCash, openedAt)
			.first();
		if (!saved) throw new Error('Pembukaan shift pusat tidak cocok');
		return;
	}
	if (event.kind === 'shift-closed') {
		const shift = event.record as ClosedShift;
		const closedAt = new Date(shift.closedAt).toISOString();
		await db
			.prepare(
				`UPDATE sesi_toko SET is_active=0,waktu_tutup=?,updated_at=?
			WHERE cabang_id=? AND id=? AND kiosk_managed=1 AND is_active=1`
			)
			.bind(closedAt, closedAt, branch, shift.id)
			.run();
		const saved = await db
			.prepare(
				'SELECT id FROM sesi_toko WHERE cabang_id=? AND id=? AND is_active=0 AND waktu_tutup=? AND kiosk_managed=1'
			)
			.bind(branch, shift.id, closedAt)
			.first();
		if (!saved) throw new Error('Penutupan shift pusat tidak cocok');
		return;
	}
	const sale = event.record as CoordinatedSaleRecord;
	const shift = await db
		.prepare('SELECT id FROM sesi_toko WHERE cabang_id=? AND id=? AND kiosk_managed=1')
		.bind(branch, sale.request.shiftId)
		.first();
	if (!shift) throw new Error('Shift penjualan belum masuk pusat');
	const result = await executeCheckout({
		db,
		branch,
		platform,
		kioskProjection: { orderNumber: sale.orderNumber, orderDate: sale.orderDate },
		session: { userId: sale.userId, username: sale.userId, role: 'kasir' },
		rawBody: {
			mode: 'offline_replay',
			idempotency_key: `kiosk:${sale.request.id}`,
			store_session_id: sale.request.shiftId,
			queued_at: Date.parse(sale.receipt.committed_at),
			metode_bayar: sale.request.payment,
			cash_received: sale.request.cash,
			items: sale.request.items,
			stock_policy_epoch_token: sale.stockPolicyEpoch
		}
	});
	if (
		result.data.total_amount !== sale.receipt.total_amount ||
		result.data.total_qty !== sale.receipt.total_qty ||
		result.data.nomor_harian !== sale.orderNumber
	)
		throw new Error('Total transaksi pusat tidak cocok');
}

export async function drainKioskProjection(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	platform: App.Platform,
	branch: BranchContext
) {
	// Bound the work per tick on the free tier. Stop at the first unconfirmed commit.
	for (let processed = 0; processed < 3; processed++) {
		const event = await peekKioskProjection(storage);
		if (!event) return;
		await projectKioskEvent(platform, branch, event);
		if (!(await acknowledgeKioskProjection(storage, event.sequence)))
			throw new Error('Konfirmasi sinkronisasi kios tidak berurutan');
	}
}
