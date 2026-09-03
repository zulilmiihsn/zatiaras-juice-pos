import { error as kitError } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import type { RequestHandler } from './$types';

function getRealtimeHub(platform: App.Platform | undefined) {
	const hub = platform?.env?.REALTIME_HUB;
	if (!hub) {
		throw kitError(503, 'Realtime Durable Object binding tidak tersedia');
	}
	return hub;
}

export const GET: RequestHandler = async ({ request, url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const hub = getRealtimeHub(platform);
	const id = hub.idFromName(branch);
	const stub = hub.get(id);
	const targetUrl = new URL(request.url);
	targetUrl.pathname = '/connect';
	targetUrl.search = '';

	return stub.fetch(new Request(targetUrl, request));
};
