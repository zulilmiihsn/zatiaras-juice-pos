import { redirect } from '@sveltejs/kit';
import { requireAuthSession } from './apiAuth';

export function requirePageSession(locals: App.Locals) {
	// Hooks already resolve live authority; optional hydration/offline checks cannot authorize a page.
	if (!locals.authSession) redirect(303, '/login?reason=unauthorized');
	return requireAuthSession(locals);
}

export function requireOwnerPageSession(locals: App.Locals) {
	const session = requirePageSession(locals);
	// Preserve the existing owner-only UI policy, without the API's deliberate admin bypass.
	if (session.role !== 'pemilik') redirect(303, '/unauthorized');
	return session;
}
