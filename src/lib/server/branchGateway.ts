import { readBranchAccountDeployment } from './branchAccountDeployment';
import { createBranchIngress } from './branchIngress';
import { SESSION_COOKIE } from './sessionStore';

type Gateway = Extract<ReturnType<typeof readBranchAccountDeployment>, { mode: 'gateway' }>;
type Transport = (request: Request) => Promise<Response>;

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
		forward(outgoing) {
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
		}
	});
}
