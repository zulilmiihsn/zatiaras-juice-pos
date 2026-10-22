/**
 * Server menjawab 403 `PIN_REQUIRED` selagi layar PIN masih menutupi halaman.
 * Itu bukan kegagalan muat: caller diam dan memuat ulang saat `page-unlocked`.
 */
export function isPinRequiredError(error: unknown): boolean {
	return error instanceof Error && error.message.includes('PIN_REQUIRED');
}
