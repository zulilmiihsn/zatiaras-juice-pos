import { randomBytes } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { reuseOrIssueCsrfToken } from '$lib/server/csrfPolicy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const token = reuseOrIssueCsrfToken(cookies.get('zatiaras_csrf'), () =>
		randomBytes(32).toString('hex')
	);

	cookies.set('zatiaras_csrf', token, {
		httpOnly: false,
		path: '/',
		sameSite: 'strict',
		secure: !dev,
		maxAge: 60 * 60 * 2
	});

	return json(
		{ success: true, token },
		{ headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } }
	);
};
