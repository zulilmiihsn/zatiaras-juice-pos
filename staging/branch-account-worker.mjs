import app from '../.svelte-kit/cloudflare/_worker.js';
import pagesRoutes from '../.svelte-kit/cloudflare/_routes.json';
import { createBranchIngress, acceptBranchRelay } from '../src/lib/server/branchIngress.ts';
import { readBranchAccountDeployment } from '../src/lib/server/branchAccountDeployment.ts';
import { SESSION_COOKIE } from '../src/lib/server/sessionStore.ts';
import { withBranchStorage } from '../src/lib/server/branchStorageEnvironment.ts';
export { RealtimeDurableObject } from '../src/lib/server/cashierRealtimeHub.ts';

const isPublicAsset = (path) =>
	pagesRoutes.exclude.some((rule) =>
		rule.endsWith('*') ? path.startsWith(rule.slice(0, -1)) : path === rule
	);

export default {
	async fetch(request, env, context) {
		let deployment;
		try {
			deployment = readBranchAccountDeployment(env);
		} catch {
			// Do not disclose binding inventories or upstream configuration to browsers.
			return new Response('Konfigurasi aplikasi cabang belum siap', { status: 503 });
		}
		if (deployment.mode === 'backend') {
			const accepted = acceptBranchRelay(request, deployment);
			if (!accepted) return new Response(null, { status: 401 });
			let backendEnv;
			try {
				backendEnv = withBranchStorage(env, deployment.branch);
			} catch {
				return new Response('Penyimpanan cabang belum siap', { status: 503 });
			}
			return app.fetch(accepted, backendEnv, context);
		}

		const url = new URL(request.url);
		if (url.origin !== deployment.publicOrigin) return new Response(null, { status: 421 });
		// Pages normally serves these exclusions itself. Workers must select assets explicitly.
		if (['GET', 'HEAD'].includes(request.method) && isPublicAsset(url.pathname))
			return env.ASSETS.fetch(request);
		let ingress;
		try {
			ingress = createBranchIngress({
				origin: deployment.publicOrigin,
				backends: deployment.backends,
				routeSecret: deployment.routeSecret,
				sessionCookie: SESSION_COOKIE,
				servePublic: (incoming) => app.fetch(incoming, env, context),
				// Same-account workers.dev requests use the private service binding.
				forward: (outgoing) =>
					new URL(outgoing.url).origin === env.BRANCH_LOCAL_ORIGIN
						? env.BRANCH_LOCAL_BACKEND.fetch(outgoing)
						: fetch(outgoing)
			});
		} catch {
			return new Response('Konfigurasi gateway belum siap', { status: 503 });
		}
		return ingress(request);
	}
};
