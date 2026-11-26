import app from '../.svelte-kit/cloudflare/_worker.js';
import pagesRoutes from '../.svelte-kit/cloudflare/_routes.json';
import { createBranchIngress, acceptBranchRelay } from '../src/lib/server/branchIngress.ts';
import { readBranchAccountDeployment } from '../src/lib/server/branchAccountDeployment.ts';
import { SESSION_COOKIE } from '../src/lib/server/sessionStore.ts';
import { withBranchStorage } from '../src/lib/server/branchStorageEnvironment.ts';
import { constantTimeEqual } from '../src/lib/server/secureCompare.ts';
export { BranchMaintenanceAlarm } from '../src/lib/server/branchMaintenanceAlarm.ts';
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
			if (new URL(request.url).pathname === '/internal/maintenance/start') {
				const secret = env.BRANCH_MAINTENANCE_SECRET;
				if (
					request.method !== 'POST' ||
					typeof secret !== 'string' ||
					secret.length < 32 ||
					!constantTimeEqual(request.headers.get('x-maintenance-secret') ?? '', secret)
				)
					return new Response(null, { status: 404 });
				if (!env.BRANCH_MAINTENANCE) return new Response(null, { status: 503 });
				return env.BRANCH_MAINTENANCE.get(
					env.BRANCH_MAINTENANCE.idFromName(deployment.branch)
				).fetch(new Request('https://maintenance.internal/start', { method: 'POST' }));
			}
			const accepted = acceptBranchRelay(request, deployment);
			if (!accepted) return new Response(null, { status: 401 });
			if (deployment.candidate)
				return new Response(null, {
					status: 503,
					headers: { 'cache-control': 'no-store', 'x-zpos-candidate': 'paused' }
				});
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
				paused: deployment.paused,
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
