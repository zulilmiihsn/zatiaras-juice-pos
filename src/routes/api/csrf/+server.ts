import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
	CSRF_COOKIE,
	newCsrfToken,
	reuseOrIssueCsrfToken,
	setCsrfCookie
} from '$lib/server/csrfPolicy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const token = reuseOrIssueCsrfToken(cookies.get(CSRF_COOKIE), newCsrfToken);

	setCsrfCookie(cookies, token, !dev);

	return json(
		{ success: true, token },
		{ headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } }
	);
};
