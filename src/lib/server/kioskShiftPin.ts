import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { verifyPinHash } from './pinHash';

export const KIOSK_SHIFT_PIN = 'shift:pin-hash';

/** One persistent budget per branch, shared by all devices and login sessions. */
export async function authorizeKioskShift(
	storage: Pick<DurableObjectStorage, 'transaction'>,
	pin: unknown,
	now: number
) {
	const result = await storage.transaction(async (tx) => {
		const policy = await tx.get('shift:open-policy');
		if (policy === 'unlocked') return { unlocked: true } as const;
		if (policy !== 'pin') return null;
		const hash = await tx.get<string>(KIOSK_SHIFT_PIN);
		if (!hash || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return null;
		const key = 'shift:pin-budget';
		const current = await tx.get<{ until: number; attempts: number }>(key);
		const budget =
			current && current.until > now ? current : { until: now + 60 * 60_000, attempts: 0 };
		if (budget.attempts >= 20) return null;
		await tx.put(key, { ...budget, attempts: budget.attempts + 1 });
		return { hash } as const;
	});
	if (result?.unlocked) return 'unlocked';
	if (result?.hash && typeof pin === 'string' && (await verifyPinHash(pin, result.hash)))
		return result.hash;
	return null;
}
