/// <reference lib="webworker" />

import {
	precacheAndRoute,
	cleanupOutdatedCaches,
	PrecacheFallbackPlugin
} from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import type { PrecacheEntry } from 'workbox-precaching';
import type { OrderPushMessage } from './lib/types/orderNotifications';
import {
	readNotificationContext,
	consumeOrderNotificationPush,
	acknowledgeNotificationSeen,
	acknowledgeNotificationDelivered,
	clearNotificationContext
} from './lib/utils/orderNotificationLocal';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

// Private API responses never enter runtime caches, even when the URL looks like an image.
registerRoute(({ url }) => /^\/api(?:\/|$)/.test(url.pathname), new NetworkOnly());
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

for (const [path, cacheName] of [
	[/^\/pos(?:\/|$)/, 'pos-navigation-v1'],
	[/^\/antrean(?:\/|$)/, 'antrean-navigation-v1']
] as const) {
	registerRoute(
		({ request, url }) => request.mode === 'navigate' && path.test(url.pathname),
		new NetworkFirst({
			cacheName,
			networkTimeoutSeconds: 3,
			plugins: [
				new CacheableResponsePlugin({ statuses: [0, 200] }),
				new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 }),
				new PrecacheFallbackPlugin({ fallbackURL: '/offline' })
			]
		})
	);
}
registerRoute(
	/\.(?:png|jpg|jpeg|svg|webp|avif)$/,
	new StaleWhileRevalidate({
		cacheName: 'images-cache',
		plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 14 })]
	})
);
registerRoute(
	/\.(?:woff2?|ttf|otf)$/,
	new StaleWhileRevalidate({
		cacheName: 'fonts-cache',
		plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 })]
	})
);

const notificationTag = 'antrean-order-created';
const queueURL = new URL('/antrean', self.location.origin).href;

type VisibilityReply = { visible: boolean; queue_visible: boolean };
type VisibilityMessage = VisibilityReply & { context_id: string };
type NotificationReceipt = { context_id: string; event_id: string; sequence: number };
type WorkerCommand = { type: string; context_id?: string; cursor?: number };

function boundedId(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) < 32) return false;
	}
	return true;
}

function parsePush(value: unknown): OrderPushMessage | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const payload = value as Partial<OrderPushMessage>;
	if (
		payload.version !== 1 ||
		payload.type !== 'order_created' ||
		!boundedId(payload.branch) ||
		!boundedId(payload.user_id) ||
		!boundedId(payload.device_id) ||
		!boundedId(payload.event_id) ||
		!boundedId(payload.order_id) ||
		(payload.origin_device_id !== null && !boundedId(payload.origin_device_id)) ||
		typeof payload.sequence !== 'number' ||
		!Number.isSafeInteger(payload.sequence) ||
		payload.sequence <= 0 ||
		typeof payload.sound_enabled !== 'boolean'
	)
		return null;
	return payload as OrderPushMessage;
}

async function appWindows(): Promise<WindowClient[]> {
	const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	return windows.filter((client) => new URL(client.url).origin === self.location.origin);
}

function queryVisibility(
	client: WindowClient,
	contextId: string,
	payload: OrderPushMessage
): Promise<VisibilityReply> {
	let resolve!: (reply: VisibilityReply) => void;
	const promise = new Promise<VisibilityReply>((settle) => {
		resolve = settle;
	});
	const channel = new MessageChannel();
	let settled = false;
	const finish = (reply: VisibilityReply) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		channel.port1.close();
		channel.port2.close();
		resolve(reply);
	};
	const timer = setTimeout(() => finish({ visible: false, queue_visible: false }), 500);
	channel.port1.onmessage = (event: MessageEvent<unknown>) => {
		if (typeof event.data !== 'object' || event.data === null) {
			finish({ visible: false, queue_visible: false });
			return;
		}
		const reply = event.data as Partial<VisibilityMessage>;
		const visible =
			reply.context_id === contextId &&
			reply.visible === true &&
			client.visibilityState === 'visible';
		finish({
			visible,
			queue_visible:
				visible &&
				reply.queue_visible === true &&
				/^\/antrean(?:\/|$)/.test(new URL(client.url).pathname)
		});
	};
	try {
		client.postMessage(
			{
				type: 'ANTREAN_QUERY_VISIBILITY',
				context_id: contextId,
				event_id: payload.event_id,
				sequence: payload.sequence
			},
			[channel.port2]
		);
	} catch {
		// A window may close while its reply is pending; it cannot own foreground delivery.
		finish({ visible: false, queue_visible: false });
	}
	return promise;
}

async function closeNotifications(
	contextId: string,
	cursor = Number.MAX_SAFE_INTEGER
): Promise<void> {
	for (const notification of await self.registration.getNotifications({ tag: notificationTag })) {
		const value: unknown = notification.data;
		if (typeof value !== 'object' || value === null) continue;
		const receipt = value as Partial<NotificationReceipt>;
		if (
			receipt.context_id === contextId &&
			(cursor === Number.MAX_SAFE_INTEGER ||
				(typeof receipt.sequence === 'number' && receipt.sequence <= cursor))
		)
			notification.close();
	}
}

async function receivePush(payload: OrderPushMessage): Promise<void> {
	// Persist receipt before display. A retry after a crash may refresh the same tag silently.
	const receipt = await consumeOrderNotificationPush(payload);
	const captured = receipt.context ?? (await readNotificationContext());
	if (
		!captured ||
		captured.device_id !== payload.device_id ||
		captured.branch !== payload.branch ||
		captured.user_id !== payload.user_id ||
		captured.seen_cursor >= payload.sequence ||
		payload.origin_device_id === captured.device_id
	)
		return;
	const windows = await appWindows();
	const visibility = await Promise.all(
		windows.map((client) => queryVisibility(client, captured.context_id, payload))
	);
	for (const client of windows) client.postMessage({ type: 'ANTREAN_PUSH', payload });
	const current = await readNotificationContext();
	if (
		!current ||
		current.context_id !== captured.context_id ||
		current.seen_cursor >= payload.sequence
	)
		return;
	const foreground = visibility.some((reply) => reply.visible);
	const newest = current.events[current.events.length - 1];
	const sequence = Math.max(payload.sequence, newest?.sequence ?? 0);
	const options: NotificationOptions & { renotify: boolean } = {
		body: 'Ada pesanan baru untuk disiapkan. Buka Antrean untuk melihatnya.',
		icon: '/img/192x192.png',
		badge: '/img/144x144.png',
		tag: notificationTag,
		renotify: receipt.accepted && !foreground,
		silent: !current.sound_enabled || foreground || !receipt.accepted,
		data: {
			context_id: captured.context_id,
			event_id: newest && newest.sequence > payload.sequence ? newest.event_id : payload.event_id,
			sequence
		}
	};
	// userVisibleOnly also applies in foreground. Suppress unnecessary delivery at the server,
	// not by swallowing a genuine push; foreground/duplicate notices do not add another sound.
	await self.registration.showNotification('Pesanan baru', options);
	await acknowledgeNotificationDelivered(captured.context_id, payload.sequence);
	if (visibility.some((reply) => reply.queue_visible)) {
		await acknowledgeNotificationSeen(captured.context_id, payload.sequence);
		await closeNotifications(captured.context_id, payload.sequence);
	}
	try {
		const afterDisplay = await readNotificationContext();
		if (
			!afterDisplay ||
			afterDisplay.context_id !== captured.context_id ||
			afterDisplay.seen_cursor >= sequence
		) {
			await closeNotifications(captured.context_id, sequence);
		}
	} catch {
		// Storage cannot stay locked over display; remove a notice that raced with revocation.
		await closeNotifications(captured.context_id, sequence);
	}
}

self.addEventListener('push', (event) => {
	event.waitUntil(
		(async () => {
			try {
				const payload = parsePush(event.data?.json());
				if (payload) await receivePush(payload);
			} catch {
				// Missing/corrupt storage, malformed payload, or denied OS permission must never leak a generic popup.
				// Durable server feed and persisted receipts reconcile on the next authenticated foreground session.
			}
		})()
	);
});

self.addEventListener('notificationclick', (event) => {
	if (event.notification.tag !== notificationTag) return;
	event.notification.close();
	event.waitUntil(
		(async () => {
			const windows = await appWindows();
			const existing =
				windows.find((client) => /^\/antrean(?:\/|$)/.test(new URL(client.url).pathname)) ??
				windows[0];
			if (existing) {
				await existing.navigate(queueURL);
				await existing.focus();
			} else {
				await self.clients.openWindow(queueURL);
			}
			// Clicking is not a seen acknowledgment; only the visible authenticated page can do that.
		})()
	);
});

self.addEventListener('message', (event) => {
	const value: unknown = event.data;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
	const message = value as Partial<WorkerCommand>;
	if (message.type === 'SKIP_WAITING') {
		// Keep prompt semantics: an update activates only after the existing updater asks for it.
		event.waitUntil(self.skipWaiting());
		return;
	}
	if (
		!event.source ||
		!('url' in event.source) ||
		new URL(event.source.url).origin !== self.location.origin
	)
		return;
	if (message.type === 'ANTREAN_CAPABILITIES') {
		event.ports[0]?.postMessage({ type: 'ANTREAN_CAPABILITIES', version: 1 });
		return;
	}
	if (!boundedId(message.context_id)) return;
	const contextId = message.context_id;
	if (message.type === 'ANTREAN_CONTEXT_CLEAR') {
		event.waitUntil(
			(async () => {
				try {
					await clearNotificationContext(contextId);
				} finally {
					// OS cleanup still runs if IndexedDB has become unavailable.
					await closeNotifications(contextId);
				}
			})()
		);
	} else if (
		message.type === 'ANTREAN_CLOSE_NOTIFICATIONS' &&
		typeof message.cursor === 'number' &&
		Number.isSafeInteger(message.cursor) &&
		message.cursor >= 0
	) {
		event.waitUntil(closeNotifications(contextId, message.cursor));
	}
});
