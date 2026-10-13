import { getAuthSession } from './authSessionReader';
import { requireSessionBranch } from './apiAuth';
import type { BranchContext } from './branchResolver';

function realtimeJson(error: string, status: number): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function sessionCookie(request: Request): string | undefined {
	for (const part of (request.headers.get('cookie') || '').split(';')) {
		const cookie = part.trim();
		if (!cookie.startsWith('zatiaras_sid=')) continue;
		try {
			return decodeURIComponent(cookie.slice('zatiaras_sid='.length));
		} catch {
			// Malformed credentials fail closed; never echo cookie bytes to logs or responses.
			return undefined;
		}
	}
	return undefined;
}

export async function connectRealtimeForBranch(
	request: Request,
	env: App.Platform['env'] | undefined,
	branch: BranchContext
): Promise<Response> {
	const hub = env?.REALTIME_HUB;
	if (!hub) return realtimeJson('Realtime Durable Object binding tidak tersedia', 503);
	const target = new URL(request.url);
	target.pathname = '/connect';
	target.search = '';
	return hub.get(hub.idFromName(branch)).fetch(new Request(target, request));
}

// WebSocket responses must bypass SvelteKit's response conversion, not its canonical authority.
export async function handleRealtimeRequest(
	request: Request,
	env: App.Platform['env'] | undefined
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== '/api/realtime') return null;
	if (request.method !== 'GET') return realtimeJson('Method not allowed', 405);
	try {
		const session = await getAuthSession({ env } as App.Platform, sessionCookie(request));
		const branch = requireSessionBranch(
			{ authSession: session } as App.Locals,
			url.searchParams.get('branch')
		);
		return await connectRealtimeForBranch(request, env, branch);
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'status' in error &&
			[400, 401, 403].includes(Number(error.status))
		) {
			const status = Number(error.status);
			return realtimeJson(
				status === 400
					? 'Branch tidak valid'
					: status === 401
						? 'Login diperlukan'
						: 'Branch tidak sesuai session',
				status
			);
		}
		return realtimeJson('Session atau binding realtime gagal', 503);
	}
}
