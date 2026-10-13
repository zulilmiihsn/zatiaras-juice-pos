import { requireOwnerPageSession } from '$lib/server/pageAuth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireOwnerPageSession(locals);
	return {};
};
