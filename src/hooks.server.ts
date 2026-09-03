import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getAuthSession } from '$lib/server/sessionStore';
import {
	branchFromObservation,
	recordErrorEvent,
	recordRequestMetric
} from '$lib/server/observability';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_ROUTES = new Set(['/api/csrf', '/api/veriflogin', '/api/logout']);

function constantTimeEqual(left: string, right: string): boolean {
	let mismatch = left.length ^ right.length;
	const length = Math.max(left.length, right.length);

	for (let index = 0; index < length; index++) {
		mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}

	return mismatch === 0;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (building || event.url.pathname === '/offline') {
		const response = await resolve(event);
		return response;
	}

	const startedAt = Date.now();
	const sessionId = event.cookies.get('zatiaras_sid');
	event.locals.authSession = await getAuthSession(event.platform, sessionId);
	const observedBranch = branchFromObservation(
		event.platform,
		event.locals.authSession,
		event.url.searchParams.get('branch')
	);

	const isCsrfProtected =
		event.url.pathname.startsWith('/api/') &&
		MUTATING_METHODS.has(event.request.method) &&
		!CSRF_EXEMPT_ROUTES.has(event.url.pathname);

	if (isCsrfProtected) {
		const csrfCookie = event.cookies.get('zatiaras_csrf');
		const csrfHeader = event.request.headers.get('x-csrf-token');

		if (!csrfCookie || !csrfHeader || !constantTimeEqual(csrfCookie, csrfHeader)) {
			return new Response(
				JSON.stringify({ success: false, code: 'CSRF_INVALID', message: 'CSRF token invalid' }),
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
			JSON.stringify({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' }),
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
		await recordRequestMetric(event.platform, observedBranch, {
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Date.now() - startedAt,
			dbMeta: response.headers.get('x-d1-meta'),
			session: event.locals.authSession
		});
	}

	return response;
};
