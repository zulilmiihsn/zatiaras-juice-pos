import type { BranchId } from './branchResolver';
import { bodyErrorResponse, readJsonBody, RequestBodyError } from './requestBody';
import { constantTimeEqual } from './secureCompare';
import { extractBranchFromProductImageKey, isPublicProductImageKey } from './r2ObjectPolicy';

const ROUTE_COOKIE = '__Host-zatiaras_branch';
const RELAY_KEY = 'x-zatiaras-relay-key';
const RELAY_BRANCH = 'x-zatiaras-relay-branch';
const RELAY_CLIENT_IP = 'x-zatiaras-relay-client-ip';
const EDGE_CLIENT_IP = 'cf-connecting-ip';
const LOGIN_PATH = '/api/veriflogin';
const LOGIN_BODY_LIMIT = 8 * 1024;
const encoder = new TextEncoder();

type Backend = { origin: string; secret: string };
interface IngressOptions {
	origin: string;
	backends: ReadonlyMap<BranchId, Backend>;
	routeSecret: string;
	paused?: boolean;
	sessionCookie: string;
	servePublic: (request: Request) => Promise<Response>;
	forward?: (request: Request) => Promise<Response>;
}

function requireHttpsOrigin(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'https:' || value !== url.origin)
		throw new Error('Alamat layanan harus berupa origin HTTPS');
	return url.origin;
}

function withOrigin(url: URL, origin: string) {
	const destination = new URL(origin);
	// Assign the path instead of resolving it as a URL: //host is still just a path.
	destination.pathname = url.pathname;
	destination.search = url.search;
	return destination;
}

function cookie(headers: Headers, name: string) {
	return headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}

function sessionFromResponse(response: Response, sessionCookie: string) {
	return response.headers
		.getSetCookie()
		.map((value) => value.split(';', 1)[0])
		.find((value) => value.startsWith(`${sessionCookie}=`))
		?.slice(sessionCookie.length + 1);
}

function noSession() {
	return Response.json(
		{ success: false, message: 'Silakan masuk kembali' },
		{ status: 401, headers: { 'cache-control': 'no-store' } }
	);
}

function unavailable() {
	return Response.json(
		{ success: false, message: 'Layanan cabang sementara tidak tersedia' },
		{ status: 503, headers: { 'cache-control': 'no-store' } }
	);
}

/** Ingress only selects a backend; that backend still authenticates and scopes every data request. */
export function createBranchIngress(options: IngressOptions) {
	const origin = requireHttpsOrigin(options.origin);
	if (options.routeSecret.length < 32) throw new Error('Kunci rute belum memenuhi syarat');
	const routes = new Map(options.backends);
	const targets = new Set<string>();
	const secrets = new Set([options.routeSecret]);
	for (const backend of routes.values()) {
		requireHttpsOrigin(backend.origin);
		if (
			backend.origin === origin ||
			targets.has(backend.origin) ||
			backend.secret.length < 32 ||
			secrets.has(backend.secret)
		)
			throw new Error('Tujuan atau kunci backend tidak terisolasi');
		targets.add(backend.origin);
		secrets.add(backend.secret);
	}
	const routeKey = () =>
		crypto.subtle.importKey(
			'raw',
			encoder.encode(options.routeSecret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
	async function tag(branch: BranchId, session: string) {
		const signature = await crypto.subtle.sign(
			'HMAC',
			await routeKey(),
			encoder.encode(`${branch}\0${session}`)
		);
		return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
			''
		);
	}
	const forward = options.forward ?? fetch;

	return async (request: Request) => {
		const url = new URL(request.url);
		if (url.origin !== origin) return new Response(null, { status: 421 });
		if (options.paused)
			return Response.json(
				{ success: false, message: 'Kasir sedang dalam pemeliharaan' },
				{
					status: 503,
					headers: { 'cache-control': 'no-store', 'retry-after': '60' }
				}
			);
		const headers = new Headers(request.headers);
		headers.delete(RELAY_KEY);
		headers.delete(RELAY_BRANCH);
		headers.delete(RELAY_CLIENT_IP);
		headers.delete('x-maintenance-secret');
		headers.delete('host');
		const incoming = new Request(request, { headers });
		const login = request.method === 'POST' && url.pathname === LOGIN_PATH;
		if (request.method === 'GET' && (url.pathname === '/login' || url.pathname === '/api/csrf'))
			return options.servePublic(incoming);

		let branch: BranchId;
		let proxied: Request;
		if (request.method === 'GET' && url.pathname === '/api/upload') {
			const key = url.searchParams.get('key');
			if (!isPublicProductImageKey(key)) return new Response(null, { status: 404 });
			const target = extractBranchFromProductImageKey(key);
			if (!target || !routes.has(target as BranchId)) return new Response(null, { status: 404 });
			branch = target as BranchId;
			// Public images do not need cookies, origin credentials, or alternate query fields.
			url.search = new URLSearchParams({ key }).toString();
			proxied = new Request(url, { method: 'GET', signal: request.signal });
		} else if (login) {
			let body: unknown;
			try {
				body = await readJsonBody(incoming, LOGIN_BODY_LIMIT);
			} catch (error) {
				if (error instanceof RequestBodyError) return bodyErrorResponse(error);
				throw error;
			}
			const target =
				body && typeof body === 'object' && 'branch' in body && typeof body.branch === 'string'
					? (body.branch.trim().toLowerCase() as BranchId)
					: null;
			if (!target || !routes.has(target))
				return Response.json({ success: false, message: 'Cabang tidak tersedia' }, { status: 400 });
			branch = target;
			headers.delete('content-length');
			proxied = new Request(request.url, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: request.signal
			});
		} else {
			const hint = cookie(headers, ROUTE_COOKIE);
			const session = cookie(headers, options.sessionCookie);
			const parts = hint?.split('.');
			const target = parts?.[0] as BranchId | undefined;
			if (
				!target ||
				!routes.has(target) ||
				!session ||
				parts?.length !== 2 ||
				!/^[a-f0-9]{64}$/.test(parts[1]) ||
				!constantTimeEqual(parts[1], await tag(target, session))
			) {
				if (request.method === 'GET' && url.pathname === '/')
					return Response.redirect(new URL('/login', origin), 303);
				return noSession();
			}
			branch = target;
			proxied = incoming;
		}

		const backend = routes.get(branch);
		if (!backend) return unavailable();
		const relay = new Request(withOrigin(url, backend.origin), proxied);
		relay.headers.set(RELAY_KEY, backend.secret);
		relay.headers.set(RELAY_BRANCH, branch);
		// Cloudflare may replace the IP header on cross-account subrequests.
		const clientIp = request.headers.get(EDGE_CLIENT_IP);
		if (clientIp && /^[a-f0-9:.]{3,45}$/i.test(clientIp))
			relay.headers.set(RELAY_CLIENT_IP, clientIp);
		let response: Response;
		try {
			// Redirects must go back to the browser, never resend service credentials upstream.
			response = await forward(new Request(relay, { redirect: 'manual' }));
		} catch {
			return unavailable();
		}
		const session =
			login && response.ok ? sessionFromResponse(response, options.sessionCookie) : null;
		if (!session) return response;
		const next = new Response(response.body, response);
		next.headers.append(
			'set-cookie',
			`${ROUTE_COOKIE}=${branch}.${await tag(branch, session)}; Path=/; HttpOnly; Secure; SameSite=Strict`
		);
		return next;
	};
}

/** Validate at the backend boundary before running SvelteKit or resolving a session. */
export function acceptBranchRelay(
	request: Request,
	options: { branch: BranchId; secret: string; publicOrigin: string }
) {
	const expected = options.secret;
	if (
		expected.length < 32 ||
		request.headers.get(RELAY_BRANCH) !== options.branch ||
		!constantTimeEqual(request.headers.get(RELAY_KEY) ?? '', expected)
	)
		return null;
	const internal = new Request(
		withOrigin(new URL(request.url), requireHttpsOrigin(options.publicOrigin)),
		request
	);
	internal.headers.delete(RELAY_KEY);
	internal.headers.delete(RELAY_BRANCH);
	internal.headers.delete(RELAY_CLIENT_IP);
	internal.headers.set(EDGE_CLIENT_IP, request.headers.get(RELAY_CLIENT_IP) ?? '0.0.0.0');
	return internal;
}
