/** D1 may wrap the provider message in Error.cause. Never classify a generic 5xx as quota. */
export function isD1DailyLimit(error: unknown): boolean {
	for (let depth = 0; depth < 6 && error; depth++) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			/\bD1\b[^\n]{0,120}(?:exceeded|reached)[^\n]{0,40}daily limit/i.test(message) ||
			/\bD1_ERROR\b[^\n]{0,160}daily (?:(?:read|write|rows read|rows written) )?limit[^\n]{0,40}(?:exceeded|reached)/i.test(
				message
			)
		)
			return true;
		error = error instanceof Error ? error.cause : undefined;
	}
	return false;
}

export function dailyLimitResponse(): Response {
	return Response.json(
		{ message: 'Kuota harian D1 habis. Transaksi menunggu sinkronisasi.' },
		{
			status: 503,
			headers: { 'x-pos-defer': 'd1-daily-limit', 'cache-control': 'no-store' }
		}
	);
}
