import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import {
	getOfflineSessionBranch,
	readOfflineSessionSnapshot,
	persistOfflineSessionSnapshot,
	clearOfflineSessionSnapshot,
	getOfflineSessionRevision
} from '$lib/auth/offlineSession';
import {
	bindNotificationContext,
	clearNotificationContext,
	getNotificationDeviceIdentity,
	readNotificationContext,
	readNotificationSound
} from '$lib/utils/orderNotificationLocal';
import type { ActiveOrderNotificationContext } from '$lib/utils/orderNotificationLocal';
import type {
	OrderNotificationConfig,
	OrderNotificationPage,
	OrderNotificationRegistration,
	OrderPushSubscription
} from '$lib/types/orderNotifications';

export interface NotificationScope {
	branch: string;
	user_id: string;
	expires_at: number;
}
export const notificationRegistration = { push_active: false };
export function getNotificationScope(): NotificationScope | null {
	if (
		typeof window === 'undefined' ||
		window.location.pathname === '/login' ||
		window.location.pathname === '/unauthorized'
	)
		return null;
	const snapshot = readOfflineSessionSnapshot();
	const branch = getOfflineSessionBranch(snapshot);
	const userId = snapshot?.user.id;
	const role = snapshot?.user.role;
	return snapshot &&
		branch &&
		typeof userId === 'string' &&
		userId &&
		(role === 'kasir' || role === 'pemilik')
		? { branch, user_id: userId, expires_at: snapshot.expiresAt }
		: null;
}
export function notificationScopeMatches(
	context: NotificationScope,
	scope = getNotificationScope()
): boolean {
	return Boolean(
		scope &&
		scope.branch === context.branch &&
		scope.user_id === context.user_id &&
		scope.expires_at > Date.now() &&
		context.expires_at > Date.now()
	);
}
export async function verifyNotificationSession(): Promise<NotificationScope | null> {
	if (!navigator.onLine) return getNotificationScope();
	const capturedScope = getNotificationScope();
	const revision = getOfflineSessionRevision();
	const capturedContext = await readNotificationContext();
	const response = await fetch('/api/session', {
		credentials: 'include',
		signal: AbortSignal.timeout(8000)
	});
	if (!response.ok) throw new Error('Sesi notifikasi belum dapat diperiksa.');
	const payload = await response.json();
	if (revision !== getOfflineSessionRevision()) return getNotificationScope();
	const latestScope = getNotificationScope();
	if (
		capturedScope?.branch !== latestScope?.branch ||
		capturedScope?.user_id !== latestScope?.user_id
	)
		return latestScope;
	if (
		payload.authenticated !== true ||
		!payload.user ||
		!Number.isFinite(Number(payload.expiresAt)) ||
		Number(payload.expiresAt) <= Date.now()
	) {
		if (capturedContext) await clearNotificationContext(capturedContext.context_id);
		clearOfflineSessionSnapshot();
		if (capturedContext)
			navigator.serviceWorker?.controller?.postMessage({
				type: 'ANTREAN_CONTEXT_CLEAR',
				context_id: capturedContext.context_id
			});
		return null;
	}
	persistOfflineSessionSnapshot(payload.user, Number(payload.expiresAt));
	return getNotificationScope();
}
export async function notificationRequest<T>(
	path: string,
	body?: unknown,
	method = 'POST'
): Promise<T> {
	const capturedContext = await readNotificationContext();
	const response =
		body === undefined
			? await fetch(path, { credentials: 'include', signal: AbortSignal.timeout(8000) })
			: await fetchWithCsrfRetry(path, {
					method,
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(8000)
				});
	if (response.status === 401 || response.status === 403) {
		if (capturedContext) await clearNotificationContext(capturedContext.context_id);
		throw new Error('Masuk kembali untuk menerima notifikasi Antrean.');
	}
	if (!response.ok)
		throw new Error('Notifikasi Antrean belum dapat terhubung. Coba lagi saat online.');
	const payload = await response.json();
	if (
		typeof payload !== 'object' ||
		payload === null ||
		payload.ok !== true ||
		!Object.prototype.hasOwnProperty.call(payload, 'data')
	)
		throw new Error('Respons notifikasi Antrean tidak valid.');
	return payload.data as T;
}
let registrationFlight: Promise<ActiveOrderNotificationContext | null> | null = null;
export async function registerNotificationDevice(
	subscription?: OrderPushSubscription | null
): Promise<ActiveOrderNotificationContext | null> {
	if (registrationFlight) await registrationFlight;
	const register = async () => {
		const scope = getNotificationScope();
		if (!scope || !navigator.onLine) return null;
		const revision = getOfflineSessionRevision();
		const identity = await getNotificationDeviceIdentity();
		const existing = await readNotificationContext();
		if (existing && !notificationScopeMatches(existing, scope))
			await clearNotificationContext(existing.context_id);
		const sound = await readNotificationSound();
		const result = await notificationRequest<OrderNotificationRegistration>(
			'/api/antrean/notifikasi/perangkat',
			{ ...identity, sound_enabled: sound, ...(subscription !== undefined ? { subscription } : {}) }
		);
		const latest = getNotificationScope();
		if (!latest || latest.branch !== scope.branch || latest.user_id !== scope.user_id) return null;
		if (revision !== getOfflineSessionRevision()) return null;
		if (
			!Number.isSafeInteger(result.baseline_cursor) ||
			result.baseline_cursor < 0 ||
			!Number.isSafeInteger(result.acknowledged_cursor) ||
			result.acknowledged_cursor < 0 ||
			!Number.isFinite(result.expires_at) ||
			result.expires_at <= Date.now() ||
			typeof result.push_active !== 'boolean'
		)
			throw new Error('Registrasi notifikasi tidak valid.');
		notificationRegistration.push_active = result.push_active;
		return bindNotificationContext(
			identity,
			{ ...scope, expires_at: Math.min(scope.expires_at, result.expires_at) },
			result.baseline_cursor,
			result.acknowledged_cursor,
			() => revision === getOfflineSessionRevision() && notificationScopeMatches(scope)
		);
	};
	const job = navigator.locks
		? navigator.locks.request('zatiaras-antrean-registration', register)
		: register();
	registrationFlight = job;
	try {
		return await job;
	} finally {
		if (registrationFlight === job) registrationFlight = null;
	}
}
export async function fetchNotificationPage(
	context: ActiveOrderNotificationContext
): Promise<OrderNotificationPage> {
	const response = await fetch(
		`/api/antrean/notifikasi?device_id=${encodeURIComponent(context.device_id)}&after=${context.read_cursor}&limit=100`,
		{
			credentials: 'include',
			headers: { 'X-Antrean-Device-Token': context.device_token },
			signal: AbortSignal.timeout(8000)
		}
	);
	if (response.status === 401 || response.status === 403) {
		await clearNotificationContext(context.context_id);
		throw new Error('Masuk kembali untuk menerima notifikasi Antrean.');
	}
	if (!response.ok) throw new Error('Antrean akan diperiksa kembali saat koneksi pulih.');
	const result = await response.json();
	const data = result.data;
	if (
		result.ok !== true ||
		!data ||
		!Array.isArray(data.items) ||
		data.items.length > 100 ||
		!Number.isSafeInteger(data.next_cursor) ||
		data.next_cursor < context.read_cursor ||
		typeof data.has_more !== 'boolean' ||
		data.items.some(
			(event: Record<string, unknown>) =>
				!Number.isSafeInteger(event.sequence) ||
				typeof event.event_id !== 'string' ||
				typeof event.order_id !== 'string' ||
				typeof event.created_at !== 'string' ||
				typeof event.is_pending !== 'boolean'
		)
	)
		throw new Error('Daftar notifikasi Antrean tidak valid.');
	return data as OrderNotificationPage;
}
export async function sendNotificationAcknowledgement(
	context: ActiveOrderNotificationContext,
	cursor: number,
	kind: 'seen' | 'delivered'
): Promise<void> {
	if (!notificationScopeMatches(context) || !navigator.onLine) return;
	await notificationRequest('/api/antrean/notifikasi/ack', {
		device_id: context.device_id,
		device_token: context.device_token,
		cursor,
		kind
	});
}
export async function clearOrderNotificationRegistration(): Promise<void> {
	const context = await readNotificationContext();
	await clearNotificationContext();
	if (typeof navigator !== 'undefined')
		navigator.serviceWorker?.controller?.postMessage({
			type: 'ANTREAN_CONTEXT_CLEAR',
			context_id: context?.context_id
		});
	if (context && navigator.onLine) {
		try {
			await notificationRequest(
				'/api/antrean/notifikasi/perangkat',
				{ device_id: context.device_id, device_token: context.device_token },
				'DELETE'
			);
		} catch {
			/* Local revocation is authoritative for this profile; expired server sessions fail closed. */
		}
	}
}
export async function prepareCheckoutNotificationOrigin(): Promise<
	{ origin_device_id: string; origin_device_token: string } | Record<string, never>
> {
	try {
		const identity = await getNotificationDeviceIdentity();
		if (navigator.onLine && getNotificationScope()) {
			await Promise.race([
				registerNotificationDevice().catch(() => null),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
			]);
		}
		return { origin_device_id: identity.device_id, origin_device_token: identity.device_token };
	} catch {
		return {}; /* Notifications must never invalidate a monetary checkout. */
	}
}
export async function getOrderNotificationConfig(): Promise<OrderNotificationConfig> {
	return notificationRequest<OrderNotificationConfig>('/api/antrean/notifikasi/config');
}
