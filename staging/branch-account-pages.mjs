import app from '../.svelte-kit/cloudflare/_worker.js';
import { readBranchAccountDeployment } from '../src/lib/server/branchAccountDeployment.ts';
import { createBranchGateway } from '../src/lib/server/branchGateway.ts';

// Pages serves the exclusions in the generated _routes.json before reaching this entry.
export default {
	async fetch(request, env, context) {
		let deployment, ingress;
		try {
			deployment = readBranchAccountDeployment(env);
			if (deployment.mode !== 'gateway') throw new Error('Pages hanya boleh menjadi gateway');
			ingress = createBranchGateway(deployment, env, (incoming) =>
				app.fetch(incoming, env, context)
			);
		} catch {
			return new Response('Konfigurasi gateway belum siap', { status: 503 });
		}
		const response = await ingress(request);
		if (!deployment.paused || response.status !== 503) return response;
		const marked = new Response(response.body, response);
		marked.headers.set('x-zpos-gateway', 'branch-paused');
		return marked;
	}
};
