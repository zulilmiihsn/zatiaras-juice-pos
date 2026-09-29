/** Nomor tampilan dari kunci permintaan POS, stabil sebelum dan sesudah sinkronisasi. */
export function formatOrderNumber(idempotencyKey: string | null | undefined): string | null {
	if (
		!idempotencyKey ||
		!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(idempotencyKey)
	) {
		return null;
	}
	const suffix = idempotencyKey.slice(-12).toUpperCase();
	return `${suffix.slice(0, 6)}-${suffix.slice(6)}`;
}
