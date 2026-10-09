import type { RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { attemptLogin } from '$lib/server/services/authService';

/**
 * Login username+password.
 * Route hanya parsing body, set cookie sesi, dan Response.
 * Seluruh kebijakan (rate-limit, enumeration, role, audit) di authService.
 * Route tipis (AUD-053): DB di service via BranchContext.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, cookies, platform }) => {
	const clientIp = getClientAddress();
	// Tanpa catch: JSON rusak = 500 SERVER_ERROR seperti semula (kontrak error).
	const body = await request.json();
	const result = await attemptLogin(platform, body, clientIp);

	if (result.sessionId) {
		cookies.set('zatiaras_sid', result.sessionId, {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
			secure: !dev,
			maxAge: 60 * 60 * 24
		});
	}

	return new Response(JSON.stringify(result.body), {
		status: result.status,
		headers: result.headers
	});
};
