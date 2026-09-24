const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_ROUTES = new Set(['/api/csrf', '/api/veriflogin', '/api/logout']);

export function isCsrfProtectedRequest(pathname: string, method: string): boolean {
	return (
		pathname.startsWith('/api/') &&
		MUTATING_METHODS.has(method) &&
		!CSRF_EXEMPT_ROUTES.has(pathname)
	);
}
