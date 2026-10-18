import type {
	AddOnRow,
	NormalizedItemInput,
	PosQuoteTokenData,
	PosTransactionItemInput,
	ProductRow
} from './types';
import { CheckoutUseCaseError, normalizeMoney, uniqueStrings } from './utils';

const MAX_ITEM_QTY = 99;

/** Item transaksi dengan jumlah tervalidasi dan snapshot harga dari quote bertanda tangan. */
export function normalizeCheckoutItems(
	rawItems: PosTransactionItemInput[],
	quote: PosQuoteTokenData
): NormalizedItemInput[] {
	return rawItems.map((item, index) => {
		const jumlah = Number(item.jumlah);
		if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > MAX_ITEM_QTY) {
			throw new CheckoutUseCaseError(400, 'Qty item tidak valid');
		}
		const quoteItem = quote.items[index];
		return {
			source: item,
			productId: item.product_id ? String(item.product_id) : null,
			addOnIds: uniqueStrings((item.add_on_ids ?? []).map((id) => String(id))),
			jumlah,
			pricingSnapshot: quoteItem
				? {
						product_name: quoteItem.product_name,
						product_price: quoteItem.product_price,
						addOns: quoteItem.add_ons
					}
				: undefined
		};
	});
}

/**
 * Produk/tambahan yang sudah dihapus sejak transaksi offline diantrekan tetap harus bisa
 * dicatat dengan harga dan nama dari snapshot quote (yang hanya nonaktif ditangani
 * `allowInactive` di loader). Hanya untuk replay offline.
 */
export function catalogFallbacks(
	inputs: NormalizedItemInput[],
	mode: 'online' | 'offline_replay'
): { fallbackProducts: Map<string, ProductRow>; fallbackAddOns: Map<string, AddOnRow> } {
	const fallbackProducts = new Map<string, ProductRow>();
	const fallbackAddOns = new Map<string, AddOnRow>();
	if (mode !== 'offline_replay') return { fallbackProducts, fallbackAddOns };

	for (const item of inputs) {
		if (item.productId && item.pricingSnapshot) {
			fallbackProducts.set(item.productId, {
				id: item.productId,
				nama: item.pricingSnapshot.product_name,
				harga: item.pricingSnapshot.product_price,
				stok: null,
				lacak_stok: false,
				lacak_bahan: false,
				is_active: false
			});
		}
		for (const addOn of item.pricingSnapshot?.addOns ?? []) {
			fallbackAddOns.set(addOn.id, {
				id: addOn.id,
				nama: addOn.nama,
				harga: addOn.harga,
				is_active: false
			});
		}
	}
	return { fallbackProducts, fallbackAddOns };
}

/** Total jika semua item dijual dengan harga katalog sekarang; pembanding selisih harga untuk audit. */
export function currentCatalogTotal(
	inputs: NormalizedItemInput[],
	productsById: Map<string, ProductRow>,
	addOnsById: Map<string, AddOnRow>
): number {
	return inputs.reduce((sum, item) => {
		const productPrice = item.productId
			? normalizeMoney(productsById.get(item.productId)?.harga)
			: normalizeMoney(item.source.custom_price);
		const addOnTotal = item.addOnIds.reduce(
			(addOnSum, id) => addOnSum + normalizeMoney(addOnsById.get(id)?.harga),
			0
		);
		return sum + (productPrice + addOnTotal) * item.jumlah;
	}, 0);
}
