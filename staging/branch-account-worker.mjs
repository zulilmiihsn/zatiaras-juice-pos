import app from '../.svelte-kit/cloudflare/_worker.js';
import pagesRoutes from '../.svelte-kit/cloudflare/_routes.json';
import { acceptBranchRelay } from '../src/lib/server/branchIngress.ts';
import { createBranchGateway, PAUSED_CONNECTION_PATH } from '../src/lib/server/branchGateway.ts';
import { readBranchAccountDeployment } from '../src/lib/server/branchAccountDeployment.ts';
import { withBranchStorage } from '../src/lib/server/branchStorageEnvironment.ts';
import { constantTimeEqual } from '../src/lib/server/secureCompare.ts';
import {
	activatePausedBranch,
	checkPausedBranchConnection,
	PAUSED_ACTIVATION_PATH
} from '../src/lib/server/pausedBranchConnection.ts';
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
					deployment.candidate ||
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
			const path = new URL(accepted.url).pathname;
			if (path === PAUSED_ACTIVATION_PATH)
				return deployment.candidate
					? activatePausedBranch(accepted, env, deployment.branch)
					: new Response(null, { status: 404 });
			if (path === PAUSED_CONNECTION_PATH) {
				if (
					env.BRANCH_CONNECTION_PROBE === 'yes' &&
					accepted.method === 'GET' &&
					(deployment.candidate || env.BRANCH_OPERATIONAL_READY === 'yes')
				)
					return checkPausedBranchConnection(env, deployment.branch);
				return new Response(null, { status: 404 });
			}
			if (deployment.candidate) {
				return new Response(null, {
					status: 503,
					headers: { 'cache-control': 'no-store', 'x-zpos-candidate': 'paused' }
				});
			}
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
			ingress = createBranchGateway(deployment, env, (incoming) =>
				app.fetch(incoming, env, context)
			);
		} catch {
			return new Response('Konfigurasi gateway belum siap', { status: 503 });
		}
		return ingress(request);
	}
};
