import { redirect } from '@sveltejs/kit';
import { isOwnerRole } from '$lib/utils/roles';
import { requireAuthSession } from './apiAuth';

export function requirePageSession(locals: App.Locals) {
	// Hooks already resolve live authority; optional hydration/offline checks cannot authorize a page.
	if (!locals.authSession) redirect(303, '/login?reason=unauthorized');
	return requireAuthSession(locals);
}

export function requireOwnerPageSession(locals: App.Locals) {
	const session = requirePageSession(locals);
	// Admin setara pemilik, sama seperti UI (isOwnerRole) dan API arsip (requireAnyRole).
	if (!isOwnerRole(session.role)) redirect(303, '/unauthorized');
	return session;
}
