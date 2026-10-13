import { requirePageSession } from '$lib/server/pageAuth';
import type { PageServerLoad } from './$types';

// Financial navigation must fail closed before optional client hydration/PWA readiness.
export const load: PageServerLoad = ({ locals }) => {
	requirePageSession(locals);
	return {};
};
