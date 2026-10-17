import type { Handle } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { getAuthSession, SESSION_COOKIE } from '$lib/server/sessionStore';
import { refreshSessionCookie } from '$lib/server/sessionRenewal';
import {
	branchFromObservation,
	recordErrorEvent,
	recordRequestMetric
} from '$lib/server/observability';
import { isCsrfProtectedRequest } from '$lib/server/csrfPolicy';
import { constantTimeEqual } from '$lib/server/secureCompare';

export const handle: Handle = async ({ event, resolve }) => {
	if (building || event.url.pathname === '/offline') {
		const response = await resolve(event);
		return response;
	}

	const startedAt = Date.now();
	const sessionId = event.cookies.get(SESSION_COOKIE);
	event.locals.authSession = await getAuthSession(event.platform, sessionId);
	if (event.locals.authSession) {
		event.locals.authSession = await refreshSessionCookie(
			event.platform,
			event.cookies,
			event.locals.authSession,
			!dev
		);
	}
	const observedBranch = branchFromObservation(
		event.platform,
		event.locals.authSession,
		event.url.searchParams.get('branch')
	);

	const isCsrfProtected = isCsrfProtectedRequest(event.url.pathname, event.request.method);

	if (isCsrfProtected) {
		const csrfCookie = event.cookies.get('zatiaras_csrf');
		const csrfHeader = event.request.headers.get('x-csrf-token');

		if (!csrfCookie || !csrfHeader || !constantTimeEqual(csrfCookie, csrfHeader)) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'CSRF_INVALID',
					message: 'Token keamanan tidak valid'
				}),
				{
					status: 403,
					headers: {
						'Content-Type': 'application/json'
					}
				}
			);
		}
	}

	const protectedApiRoutes = ['/api/aichat', '/api/gantikeamanan'];
	const isProtectedApi = protectedApiRoutes.some((route) => event.url.pathname.startsWith(route));

	if (isProtectedApi && !event.locals.authSession) {
		return new Response(
			JSON.stringify({
				success: false,
				code: 'UNAUTHORIZED',
				message: 'Sesi berakhir. Silakan login kembali'
			}),
			{
				status: 401,
				headers: {
					'Content-Type': 'application/json'
				}
			}
		);
	}

	let response: Response;
	try {
		response = await resolve(event);
	} catch (error) {
		await recordErrorEvent(event.platform, observedBranch, {
			source: `${event.request.method} ${event.url.pathname}`,
			error,
			session: event.locals.authSession,
			context: { path: event.url.pathname }
		});
		throw error;
	}

	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

	if (event.url.pathname.startsWith('/api/')) {
		const metric = recordRequestMetric(event.platform, observedBranch, {
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Date.now() - startedAt,
			dbMeta: response.headers.get('x-d1-meta'),
			session: event.locals.authSession
		});
		// Metrik tak boleh menambah latensi respons; runtime menunggunya sesudah respons terkirim.
		if (event.platform?.context) event.platform.context.waitUntil(metric);
		else await metric;
	}

	return response;
};
