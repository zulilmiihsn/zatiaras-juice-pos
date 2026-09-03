import { json } from '@sveltejs/kit';
import { getD1Database } from '$lib/server/branchResolver';
import { appendAuditLog } from '$lib/server/auditLog';
import { branchFromObservation } from '$lib/server/observability';
import type { RequestHandler } from './$types';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_EVENTS_PER_WINDOW = 60;
const MAX_EVENT_DATA_BYTES = 4096;
const MAX_EVENT_HISTORY = 2000;
const textEncoder = new TextEncoder();
const eventRateLimit = new Map<string, { count: number; resetAt: number }>();
const securityEventHistory: Array<{
	eventType: string;
	eventTimestamp: number;
	receivedAt: number;
	data: {
		endpoint?: string;
		code?: string;
		status?: number;
	};
}> = [];
const ALLOWED_EVENT_TYPES = new Set([
	'login_attempt_blocked',
	'login_failed',
	'unauthorized_access',
	'suspicious_payment_activity',
	'payment_completed',
	'suspicious_cart_activity',
	'product_added_to_cart',
	'suspicious_input_blocked',
	'api_request_failed',
	'client_error'
]);

function pushSecurityEvent(entry: {
	eventType: string;
	eventTimestamp: number;
	receivedAt: number;
	data: { endpoint?: string; code?: string; status?: number };
}): void {
	securityEventHistory.push(entry);

	if (securityEventHistory.length > MAX_EVENT_HISTORY) {
		securityEventHistory.splice(0, securityEventHistory.length - MAX_EVENT_HISTORY);
	}
}

function incrementMap(map: Map<string, number>, key: string): void {
	map.set(key, (map.get(key) || 0) + 1);
}

function getFailureKey(endpoint: string, code: string, status: number): string {
	return `${endpoint}::${code}::${status}`;
}

function parseFailureKey(key: string): { endpoint: string; code: string; status: number } {
	const [endpoint, code, statusText] = key.split('::');
	return {
		endpoint,
		code,
		status: Number.parseInt(statusText || '0', 10)
	};
}

function toTopList(map: Map<string, number>, take: number, keyName: string) {
	return Array.from(map.entries())
		.map(([key, count]) => ({ [keyName]: key, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, take);
}

function summarizeWindow(cutoff: number) {
	const eventTypeCounts = new Map<string, number>();
	const endpointCounts = new Map<string, number>();
	const codeCounts = new Map<string, number>();
	const endpointCodeStatusCounts = new Map<string, number>();

	let totalEvents = 0;
	let totalApiFailures = 0;

	for (let index = securityEventHistory.length - 1; index >= 0; index -= 1) {
		const event = securityEventHistory[index];
		if (event.receivedAt < cutoff) {
			break;
		}

		totalEvents += 1;
		incrementMap(eventTypeCounts, event.eventType);

		if (event.eventType !== 'api_request_failed') {
			continue;
		}

		const endpoint = event.data.endpoint || 'unknown';
		const code = event.data.code || 'UNKNOWN';
		const status = typeof event.data.status === 'number' ? event.data.status : 0;
		const failureKey = getFailureKey(endpoint, code, status);

		totalApiFailures += 1;
		incrementMap(endpointCounts, endpoint);
		incrementMap(codeCounts, code);
		incrementMap(endpointCodeStatusCounts, failureKey);
	}

	const byEndpointCodeStatus = Array.from(endpointCodeStatusCounts.entries())
		.map(([key, count]) => ({ ...parseFailureKey(key), count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 25);

	return {
		totalEvents,
		eventTypeCounts,
		apiFailures: {
			total: totalApiFailures,
			byEndpointCodeStatus,
			topEndpoints: toTopList(endpointCounts, 10, 'endpoint') as Array<{
				endpoint: string;
				count: number;
			}>,
			topCodes: toTopList(codeCounts, 10, 'code') as Array<{ code: string; count: number }>
		}
	};
}

function toWindowHours(value: string | null): number {
	const parsed = Number.parseInt(value || '', 10);
	if (Number.isNaN(parsed)) return 24;
	if (parsed < 1) return 1;
	if (parsed > 168) return 168;
	return parsed;
}

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const current = eventRateLimit.get(ip);

	if (!current || now > current.resetAt) {
		eventRateLimit.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return false;
	}

	if (current.count >= MAX_EVENTS_PER_WINDOW) {
		return true;
	}

	current.count += 1;
	return false;
}

function sanitizeEventType(eventType: unknown): string | null {
	if (typeof eventType !== 'string') return null;
	const normalized = eventType.trim().toLowerCase();
	if (!/^[a-z0-9_-]{3,64}$/.test(normalized)) return null;
	return normalized;
}

async function hashIdentifier(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals, platform }) => {
	const clientIp = getClientAddress();
	if (isRateLimited(clientIp)) {
		return json(
			{
				success: false,
				code: 'RATE_LIMITED',
				message: 'Too many security events',
				retryAfterSeconds: Math.ceil(WINDOW_MS / 1000)
			},
			{ status: 429 }
		);
	}

	let payload: { eventType?: unknown; data?: unknown; timestamp?: unknown };
	try {
		payload = await request.json();
	} catch {
		return json(
			{ success: false, code: 'INVALID_JSON', message: 'Invalid JSON payload' },
			{ status: 400 }
		);
	}

	const eventType = sanitizeEventType(payload.eventType);
	if (!eventType) {
		return json(
			{ success: false, code: 'VALIDATION_ERROR', message: 'Invalid eventType' },
			{ status: 400 }
		);
	}

	if (!ALLOWED_EVENT_TYPES.has(eventType)) {
		return json(
			{ success: false, code: 'UNSUPPORTED_EVENT_TYPE', message: 'Unsupported eventType' },
			{ status: 400 }
		);
	}

	const receivedAt = Date.now();
	const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : receivedAt;
	const eventData = payload.data ?? {};
	const dataBytes = textEncoder.encode(JSON.stringify(eventData)).byteLength;
	if (dataBytes > MAX_EVENT_DATA_BYTES) {
		return json(
			{ success: false, code: 'PAYLOAD_TOO_LARGE', message: 'Event payload too large' },
			{ status: 413 }
		);
	}

	console.info('[SECURITY_EVENT]', {
		eventType,
		timestamp,
		ip: clientIp,
		userId: locals.authSession?.userId ?? null,
		role: locals.authSession?.role ?? null,
		data: eventData
	});

	const branch = branchFromObservation(platform, locals.authSession);
	if (branch) {
		const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
		await appendAuditLog(db, branch, {
			action: `security.${eventType}`,
			entityType: 'security_event',
			ipHash: await hashIdentifier(clientIp),
			session: locals.authSession,
			metadata: {
				eventType,
				data: eventData,
				timestamp
			}
		});
	}

	const normalizedData =
		eventData && typeof eventData === 'object'
			? {
					endpoint:
						typeof (eventData as { endpoint?: unknown }).endpoint === 'string'
							? (eventData as { endpoint: string }).endpoint.slice(0, 128)
							: undefined,
					code:
						typeof (eventData as { code?: unknown }).code === 'string'
							? (eventData as { code: string }).code.slice(0, 64)
							: undefined,
					status:
						typeof (eventData as { status?: unknown }).status === 'number'
							? (eventData as { status: number }).status
							: undefined
				}
			: {};

	pushSecurityEvent({
		eventType,
		eventTimestamp: timestamp,
		receivedAt,
		data: normalizedData
	});

	return json({ success: true });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.authSession) {
		return json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 });
	}

	if (locals.authSession.role !== 'admin' && locals.authSession.role !== 'pemilik') {
		return json({ success: false, code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
	}

	const windowHours = toWindowHours(url.searchParams.get('windowHours'));
	const windowMs = windowHours * 60 * 60 * 1000;
	const cutoff = Date.now() - windowMs;
	const summary = summarizeWindow(cutoff);

	return json({
		success: true,
		windowHours,
		totalEvents: summary.totalEvents,
		eventTypeCounts: Object.fromEntries(summary.eventTypeCounts),
		apiFailures: summary.apiFailures
	});
};
