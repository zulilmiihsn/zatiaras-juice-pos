const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_ROUTES = new Set(['/api/csrf', '/api/veriflogin', '/api/logout']);

export function reuseOrIssueCsrfToken(cookie: unknown, issue: () => string): string {
	// GET callers share a cookie jar; unconditional rotation invalidates another in-flight mutation.
	// Only reuse the canonical random-token shape, never malformed/empty legacy cookie values.
	return typeof cookie === 'string' && cookie.length === 64 && /^[a-f0-9]{64}$/.test(cookie)
		? cookie
		: issue();
}

export function isCsrfProtectedRequest(pathname: string, method: string): boolean {
	return (
		pathname.startsWith('/api/') &&
		MUTATING_METHODS.has(method) &&
		!CSRF_EXEMPT_ROUTES.has(pathname)
	);
}
