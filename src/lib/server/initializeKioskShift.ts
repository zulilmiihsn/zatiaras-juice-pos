import type { D1Database, DurableObjectStorage } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import { KIOSK_CATALOG_KEY, readKioskCatalog } from './kioskCatalog';
import { KIOSK_SHIFT_PIN } from './kioskShiftPin';
import { readKioskOrderHandoff } from './kioskOrderHandoff';

/** Does not create the D1 fence or turn off an existing PIN policy. */
export async function initializeKioskShift(
	db: D1Database,
	storage: Pick<DurableObjectStorage, 'transaction'>,
	branch: BranchContext,
	now: number
) {
	await readKioskOrderHandoff(db, branch, now);
	const protectedBranch = await db
		.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id=? AND kunci IS NULL LIMIT 1')
		.bind(branch)
		.first<{ pin: string | null; pin_hash: string | null }>();
	const hash = protectedBranch?.pin_hash;
	if (!hash && protectedBranch?.pin && protectedBranch.pin !== '1234')
		throw new Error('PIN aktif perlu dimigrasikan sebelum alih jalur');
	return storage.transaction(async (tx) => {
		if ((await tx.get('shift:active')) !== undefined)
			return { status: 'already-initialized' } as const;
		if (!(await tx.get('sale:handoff')) || !(await tx.get('inventory:mode')))
			throw new Error('Nomor antrean dan stok belum disiapkan');
		if (!readKioskCatalog(await tx.get(KIOSK_CATALOG_KEY), branch, now)?.length)
			throw new Error('Katalog kios valid belum tersedia');
		await tx.put('shift:active', null);
		if (hash) await tx.put(KIOSK_SHIFT_PIN, hash);
		await tx.put('shift:open-policy', hash ? 'pin' : 'unlocked');
		return { status: 'initialized' } as const;
	});
}
