import type { RequestHandler } from '@sveltejs/kit';
import { bodyErrorResponse, readJsonBody, RequestBodyError } from '$lib/server/requestBody';
import { dev } from '$app/environment';
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
