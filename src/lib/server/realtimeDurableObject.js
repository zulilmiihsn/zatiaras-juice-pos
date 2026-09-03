const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * @typedef {{
 *   send(payload: string): void;
 *   close(code?: number, reason?: string): void;
 *   serializeAttachment?(value: unknown): void;
 * }} RealtimeSocket
 *
 * @typedef {{
 *   acceptWebSocket(socket: RealtimeSocket): void;
 *   getWebSockets(): RealtimeSocket[];
 *   storage: {
 *     get(key: string): Promise<unknown>;
 *     put(key: string, value: unknown, options?: { expirationTtl?: number }): Promise<void>;
 *   };
 * }} RealtimeContext
 */

/**
 * @param {unknown} body
 * @param {ResponseInit & { headers?: HeadersInit }} init
 */
function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { ...JSON_HEADERS, ...(init.headers || {}) }
	});
}

/**
 * @param {RealtimeSocket} socket
 * @param {string} payload
 */
function safeSend(socket, payload) {
	try {
		socket.send(payload);
		return true;
	} catch {
		try {
			socket.close(1011, 'send failed');
		} catch {}
		return false;
	}
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveNumber(value, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) return fallback;
	return number;
}

/**
 * @param {unknown} value
 */
function rateIdentifier(value) {
	return String(value || '')
		.trim()
		.slice(0, 240);
}

export class RealtimeDurableObject {
	/**
	 * @param {RealtimeContext} ctx
	 * @param {Record<string, unknown>} env
	 */
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
	}

	/**
	 * @param {Request} request
	 */
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === 'GET' && url.pathname.endsWith('/connect')) {
			if (request.headers.get('Upgrade') !== 'websocket') {
				return jsonResponse({ error: 'Expected WebSocket upgrade' }, { status: 426 });
			}

			const WebSocketPairConstructor =
				/** @type {new () => { 0: RealtimeSocket; 1: RealtimeSocket }} */ (
					/** @type {Record<string, unknown>} */ (globalThis).WebSocketPair
				);
			const pair = new WebSocketPairConstructor();
			const client = pair[0];
			const server = pair[1];
			this.ctx.acceptWebSocket(server);
			server.serializeAttachment?.({
				connectedAt: new Date().toISOString()
			});

			return new Response(
				null,
				/** @type {ResponseInit & { webSocket: RealtimeSocket }} */ ({
					status: 101,
					webSocket: client
				})
			);
		}

		if (request.method === 'POST' && url.pathname.endsWith('/publish')) {
			const payload = await request.json().catch(() => null);
			if (!payload || typeof payload !== 'object') {
				return jsonResponse({ error: 'Invalid realtime payload' }, { status: 400 });
			}

			const message = JSON.stringify(payload);
			let delivered = 0;
			for (const socket of this.ctx.getWebSockets()) {
				if (safeSend(socket, message)) delivered += 1;
			}

			return jsonResponse({ ok: true, delivered });
		}

		if (request.method === 'POST' && url.pathname.endsWith('/rate-limit')) {
			const payload = await request.json().catch(() => null);
			if (!payload || typeof payload !== 'object') {
				return jsonResponse({ error: 'Invalid rate-limit payload' }, { status: 400 });
			}

			const identifier = rateIdentifier(payload.identifier);
			if (!identifier) return jsonResponse({ error: 'identifier required' }, { status: 400 });

			const limit = Math.min(positiveNumber(payload.limit, 30), 1000);
			const windowMs = Math.min(positiveNumber(payload.windowMs, 60000), 60 * 60 * 1000);
			const now = Date.now();
			const storageKey = `rate:${identifier}`;
			const current =
				/** @type {{ count?: number; resetAt?: number } | null} */ (
					await this.ctx.storage.get(storageKey)
				) || null;

			if (!current || Number(current.resetAt || 0) <= now) {
				const resetAt = now + windowMs;
				await this.ctx.storage.put(
					storageKey,
					{ count: 1, resetAt },
					{ expirationTtl: Math.ceil(windowMs / 1000) + 60 }
				);
				return jsonResponse({ allowed: true, limit, count: 1, retryAfterSeconds: 0, resetAt });
			}

			const count = Number(current.count || 0);
			const resetAt = Number(current.resetAt || now + windowMs);
			if (count >= limit) {
				return jsonResponse({
					allowed: false,
					limit,
					count,
					retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
					resetAt
				});
			}

			const nextCount = count + 1;
			await this.ctx.storage.put(
				storageKey,
				{ count: nextCount, resetAt },
				{ expirationTtl: Math.max(60, Math.ceil((resetAt - now) / 1000) + 60) }
			);
			return jsonResponse({
				allowed: true,
				limit,
				count: nextCount,
				retryAfterSeconds: 0,
				resetAt
			});
		}

		return jsonResponse({ error: 'Not found' }, { status: 404 });
	}

	/**
	 * @param {RealtimeSocket} socket
	 * @param {unknown} message
	 */
	async webSocketMessage(socket, message) {
		if (message === 'ping') {
			safeSend(socket, 'pong');
		}
	}

	/**
	 * @param {RealtimeSocket} socket
	 */
	async webSocketError(socket) {
		try {
			socket.close(1011, 'websocket error');
		} catch {}
	}
}
