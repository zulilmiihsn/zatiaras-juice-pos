/** Unset is legacy behavior. An unfamiliar configured value must not allow writes. */
export function isLegacyCutoverPaused(state: unknown): boolean {
	return state !== undefined && state !== 'open';
}

export function cutoverMaintenanceResponse(): Response {
	return Response.json(
		{ success: false, message: 'Kasir sedang dalam pemeliharaan' },
		{ status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60' } }
	);
}
