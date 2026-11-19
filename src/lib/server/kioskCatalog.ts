import { isPosCatalogSnapshot } from '$lib/types/posCatalog';
import type { BranchId } from './branchResolver';

import type { DurableObjectStorage } from '@cloudflare/workers-types';

export const KIOSK_CATALOG_KEY = 'sale:catalog';

export async function publishKioskCatalog(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	branch: BranchId,
	snapshot: unknown,
	now: number
) {
	if (!isPosCatalogSnapshot(snapshot) || !readKioskCatalog(snapshot, branch, now))
		return { ok: false } as const;
	const fetchedAt = Date.parse(snapshot.fetched_at);
	if (
		!Number.isFinite(fetchedAt) ||
		fetchedAt > now + 30000 ||
		fetchedAt >= Date.parse(snapshot.expires_at)
	)
		return { ok: false } as const;
	return storage.transaction(async (tx) => {
		const current = await tx.get(KIOSK_CATALOG_KEY);
		if (
			isPosCatalogSnapshot(current) &&
			current.branch === branch &&
			Date.parse(current.fetched_at) >= fetchedAt
		)
			return { ok: true, status: 'unchanged' } as const;
		await tx.put(KIOSK_CATALOG_KEY, snapshot);
		return { ok: true, status: 'updated' } as const;
	});
}

/** A server-prepared snapshot only. Missing/expired catalog never enables checkout. */
export function readKioskCatalog(value: unknown, branch: BranchId, now: number) {
	if (
		!isPosCatalogSnapshot(value) ||
		value.branch !== branch ||
		!(Date.parse(value.expires_at) > now)
	)
		return null;
	const addOns = value.addOns.flatMap((item) =>
		item &&
		item.is_active &&
		typeof item.id === 'string' &&
		typeof item.nama === 'string' &&
		'price_token' in item &&
		typeof item.price_token === 'string' &&
		item.price_token &&
		Number.isSafeInteger(item.harga) &&
		item.harga >= 0
			? [{ id: item.id, nama: item.nama, harga: item.harga, price_token: item.price_token }]
			: []
	);
	return value.products.flatMap((item) =>
		item &&
		item.is_active &&
		typeof item.id === 'string' &&
		typeof item.nama === 'string' &&
		'price_token' in item &&
		typeof item.price_token === 'string' &&
		item.price_token.length > 0 &&
		Number.isSafeInteger(item.harga) &&
		item.harga > 0
			? [
					{
						id: item.id,
						nama: item.nama,
						harga: item.harga,
						price_token: item.price_token,
						hargaJumbo:
							typeof item.harga_jumbo === 'number' &&
							Number.isSafeInteger(item.harga_jumbo) &&
							item.harga_jumbo > 0
								? item.harga_jumbo
								: null,
						addOns: addOns.filter(
							(addOn) =>
								Array.isArray(item.ekstra_ids) &&
								item.ekstra_ids.some((id) => String(id) === addOn.id)
						)
					}
				]
			: []
	);
}
