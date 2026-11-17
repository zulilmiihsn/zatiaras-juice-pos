import type { BranchId } from '../branchResolver';
import type { PosTransactionItemInput } from '../checkout/types';
import type { WebOrder } from './types';

/**
 * Cabang POS ke outlet situs pesan.
 */
const BRANCH_OUTLET: Partial<Record<BranchId, string>> = {
	samarinda: 'juanda',
	berau: 'merah-delima',
	balikpapan: 'mt-haryono'
};

export function outletForBranch(branch: BranchId): string | null {
	return BRANCH_OUTLET[branch] ?? null;
}

/** Kebalikan pemetaan: outlet situs pesan ke cabang POS. */
export function branchForOutlet(outletId: string): BranchId | null {
	for (const [branch, outlet] of Object.entries(BRANCH_OUTLET)) {
		if (outlet === outletId) return branch as BranchId;
	}
	return null;
}

/** Kunci idempotency POS untuk satu pesanan web. Satu kode web = paling banyak satu penjualan. */
export function webKey(orderId: string): string {
	return `web-${orderId}`;
}

export function webOrderIdFromKey(key: string): string | null {
	return /^web-(ZT-[A-Z2-9]{6})$/.exec(key)?.[1] ?? null;
}

/** Nama menu dibandingkan tanpa beda huruf besar/kecil dan spasi ganda. */
export function productKey(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

const LEVEL = { NORMAL: 'normal', LESS: 'less', NONE: 'no' } as const;
const NAMA_PELANGGAN_MAX = 60;
const CATATAN_MAX = 160;

/** Nama di kartu antrean memuat kode web supaya kasir bisa mencocokkan dengan yang disebut pelanggan. */
export function customerLabel(order: WebOrder): string {
	const suffix = ` (${order.id})`;
	return `${order.name.trim().slice(0, NAMA_PELANGGAN_MAX - suffix.length)}${suffix}`;
}

/**
 * Item checkout POS dari pesanan web. Menu yang tidak ditemukan (atau namanya ganda di POS)
 * dikembalikan di `missing`; pemanggil wajib menolak, bukan menebak produk.
 */
export function buildCheckoutItems(
	order: WebOrder,
	productIdByName: Map<string, string | null>
): { items: PosTransactionItemInput[]; missing: string[] } {
	const missing: string[] = [];
	const items: PosTransactionItemInput[] = [];
	order.items.forEach((item, index) => {
		const label = item.name ?? item.menuItemId;
		const productId = productIdByName.get(productKey(label));
		if (!productId) {
			missing.push(label);
			return;
		}
		const catatan =
			index === 0
				? [order.pickupNote ? `Ambil: ${order.pickupNote}` : null, order.note?.trim() || null]
						.filter(Boolean)
						.join(' · ')
						.slice(0, CATATAN_MAX) || undefined
				: undefined;
		items.push({
			product_id: productId,
			jumlah: item.qty,
			porsi: item.size === 'JUMBO' ? 'jumbo' : 'reguler',
			gula: LEVEL[item.sweet ?? 'NORMAL'],
			es: LEVEL[item.ice ?? 'NORMAL'],
			catatan
		});
	});
	return { items, missing };
}
