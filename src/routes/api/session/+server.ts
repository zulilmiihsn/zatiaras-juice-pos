import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.authSession) {
		return json({
			success: true,
			authenticated: false,
			user: null,
			expiresAt: null
		});
	}

	return json({
		success: true,
		authenticated: true,
		user: {
			id: locals.authSession.userId,
			username: locals.authSession.username,
			role: locals.authSession.role
		},
		expiresAt: locals.authSession.expiresAt
	});
};
