import { readBranchAccountDeployment } from './branchAccountDeployment';
import { createBranchIngress, relayBranchRequest } from './branchIngress';
import { normalizeBranch } from './branchResolver';
import { constantTimeEqual } from './secureCompare';
import { SESSION_COOKIE } from './sessionStore';

type Gateway = Extract<ReturnType<typeof readBranchAccountDeployment>, { mode: 'gateway' }>;
type Transport = (request: Request) => Promise<Response>;
export const PAUSED_CONNECTION_PATH = '/internal/cutover/connection';

function gatewayTransport(env: Record<string, unknown>, fetchRemote: Transport): Transport {
	return async (outgoing) => {
		if (new URL(outgoing.url).origin !== env.BRANCH_LOCAL_ORIGIN) return fetchRemote(outgoing);
		const local = env.BRANCH_LOCAL_BACKEND;
		if (
			!local ||
			typeof local !== 'object' ||
			!('fetch' in local) ||
			typeof local.fetch !== 'function'
		)
			throw new Error('Binding privat backend satu akun tidak tersedia');
		return (local as { fetch: Transport }).fetch(outgoing);
	};
}

/** Both Workers and Pages forward dynamic traffic using the same relay and session policy. */
export function createBranchGateway(
	deployment: Gateway,
	env: Record<string, unknown>,
	servePublic: Transport,
	fetchRemote: Transport = fetch
) {
	return createBranchIngress({
		origin: deployment.publicOrigin,
		paused: deployment.paused,
		backends: deployment.backends,
		routeSecret: deployment.routeSecret,
		sessionCookie: SESSION_COOKIE,
		servePublic,
		forward: gatewayTransport(env, fetchRemote)
	});
}

/** Paused Pages may probe exactly one backend status path, never dispatch ordinary app traffic. */
export async function probePausedGateway(
	request: Request,
	deployment: Gateway,
	env: Record<string, unknown>,
	fetchRemote: Transport = fetch
): Promise<Response | null> {
	const url = new URL(request.url);
	if (url.pathname !== PAUSED_CONNECTION_PATH) return null;
	const key = env.BRANCH_GATEWAY_PROBE_SECRET;
	if (
		!deployment.paused ||
		env.BRANCH_PRODUCTION_CANDIDATE !== 'yes' ||
		url.origin !== deployment.publicOrigin ||
		request.method !== 'GET' ||
		typeof key !== 'string' ||
		key.length < 32 ||
		!constantTimeEqual(request.headers.get('x-zpos-cutover-probe') ?? '', key)
	)
		return new Response(null, { status: 404 });
	const branch = normalizeBranch(url.searchParams.get('branch'));
	const backend = branch && deployment.backends.get(branch);
	if (!branch || !backend || url.searchParams.getAll('branch').length !== 1)
		return new Response(null, { status: 404 });
	try {
		const probe = new Request(new URL(PAUSED_CONNECTION_PATH, deployment.publicOrigin), {
			signal: request.signal
		});
		const response = await gatewayTransport(
			env,
			fetchRemote
		)(relayBranchRequest(probe, branch, backend));
		await response.body?.cancel();
		if (response.status !== 204) throw new Error('Backend belum siap');
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	} catch {
		// The authenticated probe exposes readiness only, not upstream errors or data.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}
