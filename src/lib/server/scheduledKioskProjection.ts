import type { BranchId } from './branchResolver';

export async function drainConfiguredKioskBranch(env: Record<string, unknown>, branch: BranchId) {
	const configured = env.KIOSK_PROJECTION_BRANCHES;
	if (
		typeof configured !== 'string' ||
		!configured
			.split(',')
			.map((item) => item.trim())
			.includes(branch)
	)
		return;
	const hub = env.REALTIME_HUB as App.Platform['env']['REALTIME_HUB'];
	if (!hub) return;
	try {
		const result = await hub.get(hub.idFromName(`cashier:${branch}`)).fetch(
			new Request('https://cashier.internal/projection/drain', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ branch }),
				signal: AbortSignal.timeout(8000)
			})
		);
		if (!result.ok) console.warn('[kiosk-projection] Menunggu sinkronisasi', branch, result.status);
	} catch {
		// The branch outbox retains the head for a future tick; never log credentials or records.
		console.warn('[kiosk-projection] Menunggu sinkronisasi', branch);
	}
}
