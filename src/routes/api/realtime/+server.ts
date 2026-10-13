import { requireSessionBranch } from '$lib/server/apiAuth';
import { connectRealtimeForBranch } from '$lib/server/realtimeRequestHandler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	return connectRealtimeForBranch(request, platform?.env, branch);
};
