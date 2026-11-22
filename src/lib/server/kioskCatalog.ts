import { MS_PER_HOUR } from '$lib/constants/time';
import { isPosCatalogSnapshot } from '$lib/types/posCatalog';
import type { BranchId } from './branchResolver';

import type { DurableObjectStorage } from '@cloudflare/workers-types';

export const KIOSK_CATALOG_KEY = 'sale:catalog';
export const KIOSK_CATALOG_RETRY_KEY = 'sale:catalog-refresh-retry-at';

export async function publishKioskCatalog(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	branch: BranchId,
	snapshot: unknown,
	now: number
) {
	if (!isPosCatalogSnapshot(snapshot) || !readKioskCatalog(snapshot, branch, now)?.length)
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

/** Reserve an attempt before touching D1 so quota outages do not trigger a rebuild every minute. */
export async function refreshKioskCatalogIfDue(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	branch: BranchId,
	now: number,
	build: () => Promise<unknown>
) {
	const due = await storage.transaction(async (tx) => {
		if (
			(await tx.get('shift:active')) === undefined ||
			(await tx.get('shift:open-policy')) === 'rolled-back'
		)
			return false;
		const current = await tx.get(KIOSK_CATALOG_KEY);
		if (
			isPosCatalogSnapshot(current) &&
			current.branch === branch &&
			Date.parse(current.expires_at) > now + 36 * MS_PER_HOUR
		)
			return false;
		const retryAt = (await tx.get<number>(KIOSK_CATALOG_RETRY_KEY)) ?? 0;
		if (retryAt > now) return false;
		await tx.put(KIOSK_CATALOG_RETRY_KEY, now + MS_PER_HOUR);
		return true;
	});
	if (!due) return;
	const result = await publishKioskCatalog(storage, branch, await build(), Date.now());
	if (!result.ok) throw new Error('Katalog kios baru tidak valid');
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
