import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { deleteAuthSession } from '$lib/server/sessionStore';
import { newCsrfToken, setCsrfCookie } from '$lib/server/csrfPolicy';

export const POST: RequestHandler = async ({ cookies, platform }) => {
	const sessionId = cookies.get('zatiaras_sid');
	await deleteAuthSession(platform, sessionId);

	cookies.delete('zatiaras_sid', {
		path: '/'
	});
	// Session boundary rotates the double-submit token in place (no cookie-less issuance race).
	setCsrfCookie(cookies, newCsrfToken(), !dev);

	return json({ success: true });
};
