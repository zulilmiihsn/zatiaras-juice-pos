import { createBranchIngress } from '../src/lib/server/branchIngress';

/** Isolated Pages fixture: a real ingress gate, without app data or a reachable backend. */
export default {
	fetch(request: Request) {
		const url = new URL(request.url);
		if (!/^cutover-check\.zpos-pages-drill-\d{1,16}-\d{1,4}\.pages\.dev$/.test(url.hostname))
			return new Response(null, { status: 421 });
		return createBranchIngress({
			origin: url.origin,
			paused: true,
			routeSecret: 'fixture-only-route-not-used'.repeat(2),
			sessionCookie: 'fixture-session',
			backends: new Map([
				['samarinda', { origin: 'https://sam.invalid', secret: 'fixture-s'.repeat(4) }],
				['balikpapan', { origin: 'https://bal.invalid', secret: 'fixture-b'.repeat(4) }],
				['berau', { origin: 'https://ber.invalid', secret: 'fixture-r'.repeat(4) }]
			]),
			servePublic: async () => new Response(null, { status: 500 }),
			forward: async () => new Response(null, { status: 500 })
		})(request);
	}
};
