import type { BranchContext } from '../branchResolver';
import type { AuthSession } from '../sessionStore';
import type {
	NotificationDeviceIdentity,
	OrderNotificationPage,
	OrderNotificationRegistration
} from '../../types/orderNotifications';
import {
	deviceById,
	eventHead,
	eventPage,
	isOriginDevice,
	notificationDb,
	registryDb,
	type DeviceRow,
	type NotificationEnv
} from './repository';
import { notificationConfig, validateSubscription } from './webPush';
export class NotificationError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'NotificationError';
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseIdentity(raw: unknown): NotificationDeviceIdentity {
	if (!raw || typeof raw !== 'object')
		throw new NotificationError(400, 'Identitas perangkat tidak valid');
	const value = raw as Partial<NotificationDeviceIdentity>;
	if (
		typeof value.device_id !== 'string' ||
		typeof value.device_token !== 'string' ||
		!UUID.test(value.device_id) ||
		!UUID.test(value.device_token) ||
		value.device_id === value.device_token
	)
		throw new NotificationError(400, 'Identitas perangkat tidak valid');
	return { device_id: value.device_id, device_token: value.device_token };
}
export async function tokenHash(token: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
	);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function ownedDevice(
	env: NotificationEnv,
	branch: BranchContext,
	session: AuthSession,
	identity: NotificationDeviceIdentity
): Promise<DeviceRow> {
	const device = await deviceById(env, identity.device_id);
	if (
		!device ||
		device.token_hash !== (await tokenHash(identity.device_token)) ||
		!device.active ||
		device.cabang_id !== branch ||
		device.user_id !== session.userId ||
		device.session_id !== session.id ||
		device.expires_at <= Date.now()
	)
		throw new NotificationError(403, 'Perangkat tidak aktif pada session ini');
	return device;
}
export async function registerNotificationDevice(
	env: NotificationEnv,
	branch: BranchContext,
	session: AuthSession,
	raw: unknown
): Promise<OrderNotificationRegistration> {
	const identity = parseIdentity(raw);
	const body = raw as Record<string, unknown>;
	if (typeof body.sound_enabled !== 'boolean')
		throw new NotificationError(400, 'Pengaturan suara tidak valid');
	if (session.expiresAt <= Date.now()) throw new NotificationError(401, 'Session telah berakhir');
	let subscription: string | null = null;
	let endpoint: string | null = null;
	const supplied = Object.prototype.hasOwnProperty.call(body, 'subscription');
	if (supplied && body.subscription !== null) {
		try {
			const validated = await validateSubscription(body.subscription);
			subscription = JSON.stringify(validated);
			endpoint = validated.endpoint;
		} catch {
			throw new NotificationError(400, 'Langganan push tidak valid');
		}
		if (!(await notificationConfig(env)).push_configured)
			throw new NotificationError(503, 'Push belum dikonfigurasi pada server');
	}
	const head = await eventHead(notificationDb(env, branch), branch);
	const hash = await tokenHash(identity.device_token);
	const same =
		'antrean_notification_devices.active=1 AND antrean_notification_devices.expires_at>excluded.updated_at AND antrean_notification_devices.cabang_id=excluded.cabang_id AND antrean_notification_devices.user_id=excluded.user_id';
	if (endpoint) {
		// Expired ownership cannot reserve a native endpoint after local identity storage is cleared.
		await registryDb(env)
			.prepare(
				`UPDATE antrean_notification_devices SET active=0,subscription=NULL
			 WHERE active=1 AND subscription IS NOT NULL AND json_valid(subscription)
			 AND json_extract(subscription,'$.endpoint')=? AND expires_at<=?`
			)
			.bind(endpoint, Date.now())
			.run();
	}
	let row: DeviceRow | null;
	try {
		row = await registryDb(env)
			.prepare(
				`INSERT INTO antrean_notification_devices
  (device_id,token_hash,cabang_id,user_id,session_id,context_id,active,sound_enabled,subscription,expires_at,baseline_cursor,seen_cursor,delivered_cursor,dispatch_cursor,updated_at)
  VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
  context_id=CASE WHEN ${same} THEN antrean_notification_devices.context_id ELSE excluded.context_id END,
  baseline_cursor=CASE WHEN ${same} THEN antrean_notification_devices.baseline_cursor ELSE excluded.baseline_cursor END,
  seen_cursor=CASE WHEN ${same} THEN antrean_notification_devices.seen_cursor ELSE excluded.seen_cursor END,
  delivered_cursor=CASE WHEN ${same} THEN antrean_notification_devices.delivered_cursor ELSE excluded.delivered_cursor END,
  dispatch_cursor=CASE WHEN ${same} THEN antrean_notification_devices.dispatch_cursor ELSE excluded.dispatch_cursor END,
  subscription=CASE WHEN ?=1 THEN excluded.subscription WHEN ${same} THEN antrean_notification_devices.subscription ELSE NULL END,
  cabang_id=excluded.cabang_id,user_id=excluded.user_id,session_id=excluded.session_id,active=1,
  sound_enabled=excluded.sound_enabled,expires_at=excluded.expires_at,updated_at=excluded.updated_at
  WHERE antrean_notification_devices.token_hash=excluded.token_hash RETURNING *`
			)
			.bind(
				identity.device_id,
				hash,
				branch,
				session.userId,
				session.id,
				crypto.randomUUID(),
				body.sound_enabled ? 1 : 0,
				subscription,
				session.expiresAt,
				head,
				head,
				head,
				head,
				Date.now(),
				supplied ? 1 : 0
			)
			.first<DeviceRow>();
	} catch (cause) {
		if (String(cause).includes('idx_notification_device_endpoint')) {
			throw new NotificationError(409, 'Langganan push sudah aktif pada identitas perangkat lain.');
		}
		throw cause;
	}
	if (!row) throw new NotificationError(403, 'Bukti kepemilikan perangkat tidak valid');
	return {
		baseline_cursor: row.baseline_cursor,
		acknowledged_cursor: row.seen_cursor,
		push_active: !!row.subscription,
		expires_at: row.expires_at
	};
}
export async function listNotifications(
	env: NotificationEnv,
	branch: BranchContext,
	session: AuthSession,
	raw: unknown,
	afterRaw: unknown,
	limitRaw: unknown
): Promise<OrderNotificationPage> {
	const device = await ownedDevice(env, branch, session, parseIdentity(raw));
	const after = Number(afterRaw ?? 0),
		limit = Number(limitRaw ?? 100);
	if (
		!Number.isSafeInteger(after) ||
		after < 0 ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 100
	)
		throw new NotificationError(400, 'Kursor notifikasi tidak valid');
	const rows = await eventPage(
		notificationDb(env, branch),
		branch,
		Math.max(after, device.baseline_cursor),
		limit + 1
	);
	const page = rows.slice(0, limit);
	return {
		items: page
			.filter((row) => !isOriginDevice(row, device))
			.map((row) => ({
				sequence: row.sequence,
				event_id: row.event_id,
				order_id: row.buku_kas_id,
				origin_device_id: row.origin_device_id,
				created_at: row.created_at,
				is_pending: row.is_pending === 1
			})),
		next_cursor: page.at(-1)?.sequence ?? Math.max(after, device.baseline_cursor),
		has_more: rows.length > limit
	};
}
export async function acknowledgeNotifications(
	env: NotificationEnv,
	branch: BranchContext,
	session: AuthSession,
	raw: unknown
): Promise<void> {
	const identity = parseIdentity(raw),
		body = raw as Record<string, unknown>;
	const device = await ownedDevice(env, branch, session, identity);
	if (
		(body.kind !== 'seen' && body.kind !== 'delivered') ||
		!Number.isSafeInteger(body.cursor) ||
		Number(body.cursor) < device.baseline_cursor ||
		Number(body.cursor) > (await eventHead(notificationDb(env, branch), branch))
	)
		throw new NotificationError(400, 'Konfirmasi notifikasi tidak valid');
	const column = body.kind === 'seen' ? 'seen_cursor' : 'delivered_cursor';
	await registryDb(env)
		.prepare(
			`UPDATE antrean_notification_devices SET ${column}=MAX(${column},?),updated_at=?
  WHERE device_id=? AND token_hash=? AND cabang_id=? AND user_id=? AND session_id=? AND context_id=? AND active=1`
		)
		.bind(
			Number(body.cursor),
			Date.now(),
			identity.device_id,
			device.token_hash,
			branch,
			session.userId,
			session.id,
			device.context_id
		)
		.run();
}
export async function revokeNotificationDevice(
	env: NotificationEnv,
	branch: BranchContext,
	session: AuthSession,
	raw: unknown
): Promise<void> {
	const device = await ownedDevice(env, branch, session, parseIdentity(raw));
	await registryDb(env)
		.prepare(
			`UPDATE antrean_notification_devices SET active=0,subscription=NULL,updated_at=?
  WHERE device_id=? AND token_hash=? AND cabang_id=? AND user_id=? AND session_id=? AND context_id=?`
		)
		.bind(
			Date.now(),
			device.device_id,
			device.token_hash,
			branch,
			session.userId,
			session.id,
			device.context_id
		)
		.run();
}
export async function resolveCheckoutNotificationOrigin(
	env: NotificationEnv,
	branch: BranchContext,
	session: { userId: string },
	rawDeviceId: unknown,
	rawDeviceToken: unknown
): Promise<{
	originDeviceId: string | null;
	claimedOriginDeviceId: string | null;
	originDeviceTokenHash: string | null;
}> {
	let identity: NotificationDeviceIdentity, hash: string;
	try {
		identity = parseIdentity({ device_id: rawDeviceId, device_token: rawDeviceToken });
		hash = await tokenHash(identity.device_token);
	} catch {
		return { originDeviceId: null, claimedOriginDeviceId: null, originDeviceTokenHash: null };
	}
	let originDeviceId: string | null = null;
	try {
		const device = await deviceById(env, identity.device_id);
		if (
			device?.active &&
			device.expires_at > Date.now() &&
			device.cabang_id === branch &&
			device.user_id === session.userId &&
			device.token_hash === hash
		)
			originDeviceId = device.device_id;
	} catch {
		// Keep only the private proof, not an authoritative ID. Recipients validate it after registry recovery.
	}
	return { originDeviceId, claimedOriginDeviceId: identity.device_id, originDeviceTokenHash: hash };
}
export async function revokeNotificationSession(
	platform: App.Platform | undefined,
	branch: BranchContext,
	sessionId: string
): Promise<void> {
	try {
		await registryDb(platform?.env as NotificationEnv)
			.prepare(
				'UPDATE antrean_notification_devices SET active=0,subscription=NULL,updated_at=? WHERE cabang_id=? AND session_id=?'
			)
			.bind(Date.now(), branch, sessionId)
			.run();
	} catch {
		/* Auth row deletion remains authoritative; relay rechecks it before every push. */
	}
}
