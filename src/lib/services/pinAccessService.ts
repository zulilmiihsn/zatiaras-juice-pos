import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import type { ProtectedPage } from '$lib/server/pageAccess';

export type PinVerificationResult = {
	ok: boolean;
	message?: string;
};

export async function verifyPagePin(
	pin: string,
	page: ProtectedPage
): Promise<PinVerificationResult> {
	const response = await fetchWithCsrfRetry('/api/pin/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pin, page })
	});
	const payload = (await response.json().catch(() => null)) as PinVerificationResult | null;
	return {
		ok: response.ok && payload?.ok === true,
		message: payload?.message || (response.ok ? undefined : 'Verifikasi PIN gagal')
	};
}
