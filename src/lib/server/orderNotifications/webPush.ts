import { buildPushPayload } from '@block65/webcrypto-web-push';
import type {
	OrderNotificationConfig,
	OrderPushMessage,
	OrderPushSubscription
} from '../../types/orderNotifications';
import type { NotificationEnv } from './repository';

function decodeKey(raw: unknown, length: number): Uint8Array | null {
	if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw) || raw.length > 128) return null;
	try {
		const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
		return binary.length === length ? Uint8Array.from(binary, (c) => c.charCodeAt(0)) : null;
	} catch {
		return null;
	}
}
export async function validateSubscription(raw: unknown): Promise<OrderPushSubscription> {
	if (!raw || typeof raw !== 'object') throw new Error('Langganan push tidak valid');
	const subscription = raw as Partial<OrderPushSubscription>;
	if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048)
		throw new Error('Langganan push tidak valid');
	const url = new URL(subscription.endpoint);
	const allowed =
		url.hostname === 'fcm.googleapis.com' ||
		url.hostname === 'updates.push.services.mozilla.com' ||
		url.hostname === 'web.push.apple.com' ||
		url.hostname.endsWith('.push.apple.com') ||
		url.hostname === 'notify.windows.com' ||
		url.hostname.endsWith('.notify.windows.com');
	if (
		!allowed ||
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.port ||
		url.hash ||
		url.pathname === '/' ||
		!subscription.keys ||
		decodeKey(subscription.keys.p256dh, 65)?.[0] !== 4 ||
		!decodeKey(subscription.keys.auth, 16)
	)
		throw new Error('Langganan push tidak valid');
	if (
		subscription.expirationTime !== undefined &&
		subscription.expirationTime !== null &&
		(!Number.isSafeInteger(subscription.expirationTime) || subscription.expirationTime <= 0)
	)
		throw new Error('Langganan push tidak valid');
	await crypto.subtle.importKey(
		'raw',
		decodeKey(subscription.keys.p256dh, 65) as Uint8Array<ArrayBuffer>,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	return {
		endpoint: url.href,
		expirationTime: subscription.expirationTime ?? null,
		keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
	};
}
let readinessCache: {
	publicKey: unknown;
	privateKey: unknown;
	subject: unknown;
	result: Promise<OrderNotificationConfig>;
} | null = null;
export async function notificationConfig(env: NotificationEnv): Promise<OrderNotificationConfig> {
	if (
		readinessCache &&
		readinessCache.publicKey === env?.VAPID_PUBLIC_KEY &&
		readinessCache.privateKey === env?.VAPID_PRIVATE_KEY &&
		readinessCache.subject === env?.VAPID_SUBJECT
	)
		return readinessCache.result;
	const result = checkNotificationConfig(env);
	readinessCache = {
		publicKey: env?.VAPID_PUBLIC_KEY,
		privateKey: env?.VAPID_PRIVATE_KEY,
		subject: env?.VAPID_SUBJECT,
		result
	};
	return result;
}
async function checkNotificationConfig(env: NotificationEnv): Promise<OrderNotificationConfig> {
	const publicKey = decodeKey(env?.VAPID_PUBLIC_KEY, 65);
	const privateKey = decodeKey(env?.VAPID_PRIVATE_KEY, 32);
	const subject = env?.VAPID_SUBJECT;
	let validSubject = false;
	if (typeof subject === 'string' && subject.length <= 256) {
		try {
			const url = new URL(subject);
			validSubject =
				(url.protocol === 'mailto:' && /^[^?\s@]+@[^?\s@]+\.[^?\s@]+$/.test(url.pathname)) ||
				(url.protocol === 'https:' && !url.username && !url.password && !!url.hostname);
		} catch {
			validSubject = false;
		}
	}
	let configured = publicKey?.[0] === 4 && !!privateKey && validSubject;
	if (configured && publicKey) {
		try {
			const encode = (bytes: Uint8Array) =>
				btoa(String.fromCharCode(...bytes))
					.replace(/\+/g, '-')
					.replace(/\//g, '_')
					.replace(/=+$/, '');
			const publicCrypto = await crypto.subtle.importKey(
				'raw',
				publicKey as Uint8Array<ArrayBuffer>,
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['verify']
			);
			const privateCrypto = await crypto.subtle.importKey(
				'jwk',
				{
					kty: 'EC',
					crv: 'P-256',
					x: encode(publicKey.slice(1, 33)),
					y: encode(publicKey.slice(33)),
					d: String(env?.VAPID_PRIVATE_KEY)
				},
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['sign']
			);
			const probe = new TextEncoder().encode('antrean-vapid-readiness');
			const signature = await crypto.subtle.sign(
				{ name: 'ECDSA', hash: 'SHA-256' },
				privateCrypto,
				probe
			);
			configured = await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				publicCrypto,
				signature,
				probe
			);
		} catch {
			configured = false;
		}
	}
	return {
		vapid_public_key: configured ? String(env?.VAPID_PUBLIC_KEY) : null,
		push_configured: configured
	};
}
export type PushSender = (
	subscription: OrderPushSubscription,
	message: OrderPushMessage
) => Promise<Response>;
export async function sendWebPush(
	env: NotificationEnv,
	subscription: OrderPushSubscription,
	message: OrderPushMessage
): Promise<Response> {
	if (!(await notificationConfig(env)).push_configured) throw new Error('Push belum dikonfigurasi');
	const checked = await validateSubscription(subscription);
	const request = await buildPushPayload(
		{ data: JSON.stringify(message), options: { ttl: 300 } },
		{
			...checked,
			expirationTime: checked.expirationTime ?? null
		},
		{
			subject: String(env?.VAPID_SUBJECT),
			publicKey: String(env?.VAPID_PUBLIC_KEY),
			privateKey: String(env?.VAPID_PRIVATE_KEY)
		}
	);
	// Workers support manual redirect mode, not "error". Never forward encrypted payload or VAPID.
	const response = await fetch(checked.endpoint, {
		...request,
		redirect: 'manual',
		signal: AbortSignal.timeout(15000)
	});
	if (response.status >= 300 && response.status < 400)
		throw new Error('Pengiriman notifikasi ditolak: pengalihan endpoint tidak diizinkan.');
	return response;
}
