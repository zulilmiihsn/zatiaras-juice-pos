import { createBranchIngress } from '../src/lib/server/branchIngress';
import { constantTimeEqual } from '../src/lib/server/secureCompare';

const fixtureRoot = /^zpos-pages-drill-\d{1,16}-\d{1,4}\.pages\.dev$/;

/** The disposable hostname can relay a gated smoke test only to the staging gateway. */
export default {
	fetch(request: Request, env?: { PAGES_SMOKE_KEY?: string; STAGING_GATEWAY?: Fetcher }) {
		const url = new URL(request.url);
		if (!fixtureRoot.test(url.hostname)) return new Response(null, { status: 421 });
		const key = request.headers.get('x-zpos-pages-smoke');
		if (key !== null) {
			if (
				!env?.STAGING_GATEWAY ||
				!env.PAGES_SMOKE_KEY ||
				!constantTimeEqual(key, env.PAGES_SMOKE_KEY)
			)
				return new Response(null, { status: 404 });
			const staging = new URL('https://zpos-gateway-staging.zulilmiihsn.workers.dev');
			staging.pathname = url.pathname;
			staging.search = url.search;
			const upstream = new Request(new Request(staging, request), { redirect: 'manual' });
			upstream.headers.delete('x-zpos-pages-smoke');
			if (upstream.headers.get('origin') === url.origin)
				upstream.headers.set('origin', staging.origin);
			return env.STAGING_GATEWAY.fetch(upstream);
		}
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
