import type { RequestHandler } from '@sveltejs/kit';
import { bodyErrorResponse, readJsonBody, RequestBodyError } from '$lib/server/requestBody';
import { dev } from '$app/environment';
import { parseKioskSession, openKioskSession, readKioskSession } from '$lib/server/kioskSession';
import { enrollVerifiedKioskDevice } from '$lib/server/enrollCashierDevice';
import {
	kioskPilotEnvironment,
	shouldRouteCentralLoginToKiosk
} from '$lib/server/kioskLoginPolicy';
import { attemptLogin } from '$lib/server/services/authService';
import { newCsrfToken, setCsrfCookie } from '$lib/server/csrfPolicy';
import { SESSION_COOKIE, sessionCookieOptions } from '$lib/server/sessionStore';

/**
 * Login username+password.
 * Route hanya parsing body, set cookie sesi, dan Response.
 * Seluruh kebijakan (rate-limit, enumeration, role, audit) di authService.
 * Route tipis: DB di service via BranchContext.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, cookies, platform }) => {
	const clientIp = getClientAddress();
	let body: unknown;
	try {
		body = await readJsonBody(request);
	} catch (cause) {
		if (cause instanceof RequestBodyError) return bodyErrorResponse(cause);
		throw cause;
	}
	const result = await attemptLogin(platform, body, clientIp);
	const verified = result.verifiedKioskProfile;
	if (result.sessionId && verified && kioskPilotEnvironment(platform?.env, verified.branch)) {
		const key = `zatiaras_kiosk_${verified.branch}`;
		try {
			const token = await enrollVerifiedKioskDevice(
				platform,
				verified.branch,
				verified.profile,
				cookies.get(key)
			);
			cookies.set(key, token, {
				path: '/',
				httpOnly: true,
				secure: !dev,
				sameSite: 'strict',
				maxAge: 48 * 60 * 60
			});
		} catch {
			// Coordinator enrollment is best effort; a healthy central login must still succeed.
			console.warn('[kiosk] Persiapan perangkat belum berhasil', verified.branch);
		}
	}

	const stagingRequested =
		platform?.env.KIOSK_STAGING_PILOT === 'balikpapan' &&
		body !== null &&
		typeof body === 'object' &&
		'branch' in body &&
		body.branch === 'balikpapan' &&
		'stagingKiosk' in body &&
		body.stagingKiosk === true;
	const kioskRequested =
		Boolean(result.sessionId) &&
		(stagingRequested || (await shouldRouteCentralLoginToKiosk(platform, result.body.user)));
	if (result.headers?.['x-kiosk-login'] === 'd1-daily-limit' || kioskRequested) {
		const session = await openKioskSession(platform, cookies, body);
		const scope = parseKioskSession(session?.id);
		const kiosk = kioskRequested && scope ? await readKioskSession(platform, cookies, scope) : null;
		if (
			session &&
			(!kioskRequested ||
				kiosk?.shiftStatus.state === 'closed' ||
				kiosk?.shiftStatus.state === 'open')
		) {
			cookies.set(
				SESSION_COOKIE,
				session.id,
				sessionCookieOptions(!dev, session.expiresAt - Date.now())
			);
			setCsrfCookie(cookies, newCsrfToken(), !dev);
			return Response.json(
				{ success: true, scope: 'operasional' },
				{ headers: { 'Cache-Control': 'no-store' } }
			);
		}
	}

	if (kioskRequested)
		return Response.json(
			{
				success: false,
				message: 'Mode cadangan belum siap. Coba masuk lagi saat database tersedia.'
			},
			{ status: 409, headers: { 'Cache-Control': 'no-store' } }
		);

	if (result.sessionId) {
		cookies.set(SESSION_COOKIE, result.sessionId, sessionCookieOptions(!dev));
		// A new session must not inherit a token minted for the previous user on this device.
		// Issue the fresh token here (not delete) so concurrent first /api/csrf calls all reuse it.
		setCsrfCookie(cookies, newCsrfToken(), !dev);
	}

	return new Response(JSON.stringify(result.body), {
		status: result.status,
		headers: result.headers
	});
};
