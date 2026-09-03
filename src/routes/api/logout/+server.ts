import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAuthSession } from '$lib/server/sessionStore';

export const POST: RequestHandler = async ({ cookies, platform }) => {
	const sessionId = cookies.get('zatiaras_sid');
	await deleteAuthSession(platform, sessionId);

	cookies.delete('zatiaras_sid', {
		path: '/'
	});

	return json({ success: true });
};
