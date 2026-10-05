import { get, update } from 'idb-keyval';
import { notificationStore } from './idbStores';
import type {
	NotificationDeviceIdentity,
	OrderNotificationEvent,
	OrderPushMessage
} from '../types/orderNotifications';

export interface LocalNotificationEvent {
	sequence: number;
	event_id: string;
	order_id: string;
	created_at: string;
}
export interface ActiveOrderNotificationContext extends NotificationDeviceIdentity {
	version: 1;
	context_id: string;
	branch: string;
	user_id: string;
	expires_at: number;
	sound_enabled: boolean;
	sound_revision: number;
	read_cursor: number;
	seen_cursor: number;
	delivered_cursor: number;
	push_received_cursor: number;
	events: LocalNotificationEvent[];
	unacked_until: number;
	visible_queue: Array<{ client_id: string; until: number }>;
	alarm_lease: { owner: string; until: number } | null;
}
interface NotificationSoundPreference {
	enabled: boolean;
	revision: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isNotificationDeviceIdentity(value: unknown): value is NotificationDeviceIdentity {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as NotificationDeviceIdentity;
	return (
		typeof candidate.device_id === 'string' &&
		typeof candidate.device_token === 'string' &&
		UUID.test(candidate.device_id) &&
		UUID.test(candidate.device_token)
	);
}
export async function getNotificationDeviceIdentity(): Promise<NotificationDeviceIdentity> {
	let result: NotificationDeviceIdentity | undefined;
	await update<unknown>(
		'identity',
		(value) => {
			if (value !== undefined && !isNotificationDeviceIdentity(value))
				throw new Error(
					'Identitas notifikasi perangkat tidak dapat dibaca. Jangan hapus data perangkat.'
				);
			result =
				value === undefined
					? { device_id: crypto.randomUUID(), device_token: crypto.randomUUID() }
					: (value as NotificationDeviceIdentity);
			return result;
		},
		notificationStore
	);
	return result!;
}
export function isNotificationContextCurrent(
	context: ActiveOrderNotificationContext | null | undefined,
	now = Date.now()
): context is ActiveOrderNotificationContext {
	if (
		!context ||
		context.version !== 1 ||
		!isNotificationDeviceIdentity(context) ||
		typeof context.context_id !== 'string' ||
		!UUID.test(context.context_id) ||
		typeof context.branch !== 'string' ||
		!context.branch ||
		typeof context.user_id !== 'string' ||
		!context.user_id ||
		!Number.isFinite(context.expires_at) ||
		context.expires_at <= now ||
		typeof context.sound_enabled !== 'boolean'
	)
		return false;
	if (
		![
			context.read_cursor,
			context.seen_cursor,
			context.delivered_cursor,
			context.push_received_cursor,
			context.sound_revision
		].every((cursor) => Number.isSafeInteger(cursor) && cursor >= 0) ||
		!Number.isFinite(context.unacked_until) ||
		context.unacked_until < 0 ||
		context.unacked_until > context.expires_at
	)
		return false;
	if (
		!Array.isArray(context.events) ||
		context.events.length > 100 ||
		context.events.some(
			(event) =>
				!event ||
				!Number.isSafeInteger(event.sequence) ||
				event.sequence <= context.seen_cursor ||
				typeof event.event_id !== 'string' ||
				!event.event_id ||
				typeof event.order_id !== 'string' ||
				!event.order_id ||
				typeof event.created_at !== 'string'
		)
	)
		return false;
	if (
		!Array.isArray(context.visible_queue) ||
		context.visible_queue.length > 16 ||
		context.visible_queue.some(
			(client) => !client || typeof client.client_id !== 'string' || !Number.isFinite(client.until)
		)
	)
		return false;
	return (
		context.alarm_lease === null ||
		Boolean(
			context.alarm_lease &&
			typeof context.alarm_lease.owner === 'string' &&
			Number.isFinite(context.alarm_lease.until)
		)
	);
}
export async function readNotificationContext(
	now = Date.now()
): Promise<ActiveOrderNotificationContext | null> {
	const value = await get<ActiveOrderNotificationContext>('active-context', notificationStore);
	const identity = await get<NotificationDeviceIdentity>('identity', notificationStore);
	if (
		value === undefined ||
		value === null ||
		(Number.isFinite(value.expires_at) && value.expires_at <= now)
	)
		return null;
	if (
		!isNotificationContextCurrent(value, now) ||
		!isNotificationDeviceIdentity(identity) ||
		value.device_id !== identity.device_id ||
		value.device_token !== identity.device_token
	)
		throw new Error(
			'Penyimpanan notifikasi perangkat tidak dapat dibaca. Jangan hapus data perangkat.'
		);
	return value;
}
export async function mutateNotificationContext(
	contextId: string,
	mutate: (context: ActiveOrderNotificationContext) => ActiveOrderNotificationContext
): Promise<ActiveOrderNotificationContext | null> {
	let result: ActiveOrderNotificationContext | null = null;
	await update<ActiveOrderNotificationContext | null>(
		'active-context',
		(context) => {
			if (!isNotificationContextCurrent(context) || context.context_id !== contextId)
				return context ?? null;
			result = mutate(context);
			return result;
		},
		notificationStore
	);
	return result;
}
export async function bindNotificationContext(
	identity: NotificationDeviceIdentity,
	scope: { branch: string; user_id: string; expires_at: number },
	baseline: number,
	acknowledged: number,
	isCurrent: () => boolean
): Promise<ActiveOrderNotificationContext | null> {
	let result: ActiveOrderNotificationContext | null = null;
	const preference = (await get<NotificationSoundPreference>(
		'sound-preference',
		notificationStore
	)) ?? { enabled: true, revision: 0 };
	await update<ActiveOrderNotificationContext | null>(
		'active-context',
		(current) => {
			if (!isCurrent()) return current ?? null;
			const same =
				current?.device_id === identity.device_id &&
				current.branch === scope.branch &&
				current.user_id === scope.user_id;
			const sound =
				current && current.sound_revision > preference.revision
					? { enabled: current.sound_enabled, revision: current.sound_revision }
					: preference;
			result =
				same && isNotificationContextCurrent(current)
					? {
							...current,
							expires_at: scope.expires_at,
							unacked_until: Math.min(current.unacked_until, scope.expires_at),
							sound_enabled: sound.enabled,
							sound_revision: sound.revision
						}
					: {
							version: 1,
							...identity,
							...scope,
							context_id: crypto.randomUUID(),
							sound_enabled: sound.enabled,
							sound_revision: sound.revision,
							read_cursor: baseline,
							seen_cursor: Math.max(baseline, acknowledged),
							delivered_cursor: acknowledged,
							push_received_cursor: baseline,
							events: [],
							unacked_until: 0,
							visible_queue: [],
							alarm_lease: null
						};
			return result;
		},
		notificationStore
	);
	return result;
}
export async function clearNotificationContext(contextId?: string): Promise<void> {
	await update<ActiveOrderNotificationContext | null>(
		'active-context',
		(current) => (!contextId || current?.context_id === contextId ? null : (current ?? null)),
		notificationStore
	);
}
function receive(
	context: ActiveOrderNotificationContext,
	event: LocalNotificationEvent,
	origin: string | null
): { context: ActiveOrderNotificationContext; accepted: boolean } {
	if (
		!Number.isSafeInteger(event.sequence) ||
		event.sequence <= context.seen_cursor ||
		!event.event_id ||
		!event.order_id ||
		origin === context.device_id ||
		context.events.some((item) => item.event_id === event.event_id)
	)
		return { context, accepted: false };
	const events = [...context.events, event].sort((a, b) => a.sequence - b.sequence).slice(-100);
	return {
		context: {
			...context,
			events,
			unacked_until: Math.min(context.expires_at, Date.now() + 86_400_000)
		},
		accepted: true
	};
}
export async function consumeOrderNotificationPush(
	payload: OrderPushMessage
): Promise<{ context: ActiveOrderNotificationContext | null; accepted: boolean }> {
	let result: { context: ActiveOrderNotificationContext | null; accepted: boolean } = {
		context: null,
		accepted: false
	};
	const identity = await get<NotificationDeviceIdentity>('identity', notificationStore);
	await update<ActiveOrderNotificationContext | null>(
		'active-context',
		(current) => {
			if (
				!isNotificationContextCurrent(current) ||
				!isNotificationDeviceIdentity(identity) ||
				identity.device_id !== current.device_id ||
				identity.device_token !== current.device_token ||
				payload.version !== 1 ||
				payload.type !== 'order_created' ||
				current.device_id !== payload.device_id ||
				current.branch !== payload.branch ||
				current.user_id !== payload.user_id ||
				!Number.isSafeInteger(payload.sequence) ||
				payload.sequence <= current.push_received_cursor ||
				payload.sequence <= current.read_cursor ||
				typeof payload.event_id !== 'string' ||
				typeof payload.order_id !== 'string' ||
				(payload.origin_device_id !== null && typeof payload.origin_device_id !== 'string')
			)
				return current ?? null;
			result = receive(
				{ ...current, push_received_cursor: payload.sequence },
				{
					sequence: payload.sequence,
					event_id: payload.event_id,
					order_id: payload.order_id,
					created_at: new Date().toISOString()
				},
				payload.origin_device_id
			);
			return result.context;
		},
		notificationStore
	);
	return result;
}
export async function consumeOrderNotificationPage(
	contextId: string,
	items: OrderNotificationEvent[],
	cursor: number
): Promise<ActiveOrderNotificationContext | null> {
	return mutateNotificationContext(contextId, (context) => {
		for (const event of items) {
			if (event.sequence > context.read_cursor && event.is_pending)
				context = receive(context, event, event.origin_device_id).context;
		}
		return { ...context, read_cursor: Math.max(context.read_cursor, cursor) };
	});
}
export async function acknowledgeNotificationSeen(
	contextId: string,
	cursor: number
): Promise<ActiveOrderNotificationContext | null> {
	return mutateNotificationContext(contextId, (context) => {
		const seen = Math.max(context.seen_cursor, cursor);
		const events = context.events.filter((event) => event.sequence > seen);
		return {
			...context,
			seen_cursor: seen,
			events,
			unacked_until: events.length ? context.unacked_until : 0,
			alarm_lease: events.length ? context.alarm_lease : null
		};
	});
}
export async function acknowledgeNotificationDelivered(
	contextId: string,
	cursor: number
): Promise<ActiveOrderNotificationContext | null> {
	return mutateNotificationContext(contextId, (context) => ({
		...context,
		delivered_cursor: Math.max(context.delivered_cursor, cursor)
	}));
}
export function hasVisibleNotificationQueue(
	context: ActiveOrderNotificationContext,
	now = Date.now()
): boolean {
	return context.visible_queue.some((client) => client.until > now);
}
export async function updateNotificationQueueVisibility(
	contextId: string,
	clientId: string,
	visible: boolean
): Promise<ActiveOrderNotificationContext | null> {
	return mutateNotificationContext(contextId, (context) => ({
		...context,
		visible_queue: [
			...context.visible_queue.filter(
				(item) => item.client_id !== clientId && item.until > Date.now()
			),
			...(visible ? [{ client_id: clientId, until: Date.now() + 15_000 }] : [])
		].slice(-16)
	}));
}
export async function claimNotificationAlarm(contextId: string, owner: string): Promise<boolean> {
	let claimed = false;
	await mutateNotificationContext(contextId, (context) => {
		if (
			!context.events.length ||
			!context.sound_enabled ||
			context.unacked_until <= Date.now() ||
			hasVisibleNotificationQueue(context)
		)
			return context;
		if (
			!context.alarm_lease ||
			context.alarm_lease.owner === owner ||
			context.alarm_lease.until <= Date.now()
		) {
			claimed = true;
			return { ...context, alarm_lease: { owner, until: Date.now() + 6500 } };
		}
		return context;
	});
	return claimed;
}
export async function readNotificationSound(): Promise<boolean> {
	const preference = await get<NotificationSoundPreference>('sound-preference', notificationStore);
	if (
		preference !== undefined &&
		(!preference ||
			typeof preference.enabled !== 'boolean' ||
			!Number.isSafeInteger(preference.revision) ||
			preference.revision < 0)
	)
		throw new Error('Pilihan suara perangkat tidak dapat dibaca.');
	return preference?.enabled ?? true;
}
export async function saveNotificationSound(enabled: boolean): Promise<void> {
	let revision = 0;
	await update<NotificationSoundPreference>(
		'sound-preference',
		(current) => {
			revision = (current?.revision ?? 0) + 1;
			return { enabled, revision };
		},
		notificationStore
	);
	await update<ActiveOrderNotificationContext | null>(
		'active-context',
		(context) =>
			context && context.sound_revision <= revision
				? { ...context, sound_enabled: enabled, sound_revision: revision }
				: (context ?? null),
		notificationStore
	);
}
