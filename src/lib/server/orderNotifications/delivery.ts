import type { BranchContext } from '../branchResolver';
import type { OrderPushMessage } from '../../types/orderNotifications';
import {
	deviceById,
	eventPage,
	isOriginDevice,
	notificationDb,
	registryDb,
	validNotificationSession,
	type DeviceRow,
	type EventRow,
	type NotificationEnv
} from './repository';
import { notificationConfig, sendWebPush, validateSubscription, type PushSender } from './webPush';

interface DeliveryRow {
	event_id: string;
	device_id: string;
	context_id: string;
	attempts: number;
	lease_id: string;
}
const MAX_ATTEMPTS = 8;
const LEASE_MS = 60000;
export async function dispatchOrderNotifications(
	env: NotificationEnv,
	branch: BranchContext,
	opts: { now?: number; send?: PushSender; limit?: number } = {}
): Promise<void> {
	const now = opts.now ?? Date.now();
	const limit = Math.max(1, Math.min(100, opts.limit ?? 100));
	if (!opts.send && !(await notificationConfig(env)).push_configured) return;
	const db = notificationDb(env, branch),
		registry = registryDb(env);
	let afterDevice = '';
	for (;;) {
		const recipients = await registry
			.prepare(
				`SELECT * FROM antrean_notification_devices
   WHERE cabang_id=? AND active=1 AND subscription IS NOT NULL AND expires_at>? AND device_id>?
   ORDER BY device_id LIMIT 100`
			)
			.bind(branch, now, afterDevice)
			.all<DeviceRow>();
		if (!recipients.results.length) break;
		for (const recipient of recipients.results) {
			const events = await eventPage(
				db,
				branch,
				Math.max(recipient.dispatch_cursor, recipient.baseline_cursor),
				100
			);
			if (!events.length) continue;
			const cursor = events.at(-1)!.sequence;
			const eligible = events.filter(
				(event) =>
					event.is_pending === 1 &&
					!isOriginDevice(event, recipient) &&
					event.sequence > Math.max(recipient.seen_cursor, recipient.delivered_cursor)
			);
			if (eligible.length)
				await db.batch(
					eligible.map((event) =>
						db
							.prepare(
								`INSERT OR IGNORE INTO antrean_notification_deliveries
    (event_id,cabang_id,device_id,context_id,next_attempt_at) VALUES (?,?,?,?,?)`
							)
							.bind(event.event_id, branch, recipient.device_id, recipient.context_id, now)
					)
				);
			// Cross-shard cursor advancement follows durable inserts. A crash only repeats idempotent inserts.
			await registry
				.prepare(
					`UPDATE antrean_notification_devices SET dispatch_cursor=MAX(dispatch_cursor,?)
    WHERE device_id=? AND cabang_id=? AND context_id=? AND active=1`
				)
				.bind(cursor, recipient.device_id, branch, recipient.context_id)
				.run();
		}
		afterDevice = recipients.results.at(-1)!.device_id;
		if (recipients.results.length < 100) break;
	}
	const due = await db
		.prepare(
			`SELECT event_id,device_id,context_id,attempts,lease_id FROM antrean_notification_deliveries
  WHERE cabang_id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='leased' AND lease_until<=?))
  ORDER BY next_attempt_at,event_id,device_id LIMIT ?`
		)
		.bind(branch, now, now, limit)
		.all<DeliveryRow>();
	for (const candidate of due.results) {
		const claimNow = opts.now ?? Date.now();
		const lease = crypto.randomUUID();
		const claimed = await db
			.prepare(
				`UPDATE antrean_notification_deliveries SET state='leased',lease_id=?,lease_until=?,attempts=attempts+1
   WHERE cabang_id=? AND event_id=? AND device_id=? AND context_id=? AND attempts<?
   AND ((state='pending' AND next_attempt_at<=?) OR (state='leased' AND lease_until<=?)) RETURNING *`
			)
			.bind(
				lease,
				claimNow + LEASE_MS,
				branch,
				candidate.event_id,
				candidate.device_id,
				candidate.context_id,
				MAX_ATTEMPTS,
				claimNow,
				claimNow
			)
			.first<DeliveryRow>();
		if (!claimed) {
			await db
				.prepare(
					`UPDATE antrean_notification_deliveries SET state='failed',lease_id=NULL
    WHERE cabang_id=? AND event_id=? AND device_id=? AND context_id=? AND attempts>=? AND lease_until<=? AND state='leased'`
				)
				.bind(
					branch,
					candidate.event_id,
					candidate.device_id,
					candidate.context_id,
					MAX_ATTEMPTS,
					claimNow
				)
				.run();
			continue;
		}
		let status: number | null = null;
		let state = 'pending';
		let retryAfter = 0;
		try {
			const event = await db
				.prepare(
					`SELECT e.sequence,e.event_id,e.buku_kas_id,e.origin_device_id,e.claimed_origin_device_id,e.origin_device_token_hash FROM antrean_notification_events e
    INNER JOIN buku_kas b ON b.cabang_id=e.cabang_id AND b.id=e.buku_kas_id
    WHERE e.cabang_id=? AND e.event_id=? AND b.sumber='pos' AND b.preparation_state='pending' LIMIT 1`
				)
				.bind(branch, claimed.event_id)
				.first<
					Pick<
						EventRow,
						| 'sequence'
						| 'event_id'
						| 'buku_kas_id'
						| 'origin_device_id'
						| 'claimed_origin_device_id'
						| 'origin_device_token_hash'
					>
				>();
			const device = await deviceById(env, claimed.device_id);
			if (
				!event ||
				!device ||
				!device.active ||
				device.cabang_id !== branch ||
				device.context_id !== claimed.context_id ||
				!device.subscription ||
				device.expires_at <= claimNow ||
				isOriginDevice(event, device) ||
				event.sequence <=
					Math.max(device.baseline_cursor, device.seen_cursor, device.delivered_cursor) ||
				!(await validNotificationSession(env, branch, device, claimNow))
			) {
				state = 'cancelled';
			} else {
				const subscription = await validateSubscription(JSON.parse(device.subscription) as unknown);
				if (subscription.expirationTime && subscription.expirationTime <= claimNow) {
					state = 'cancelled';
					await registry
						.prepare(
							'UPDATE antrean_notification_devices SET subscription=NULL WHERE device_id=? AND cabang_id=? AND context_id=? AND subscription=?'
						)
						.bind(device.device_id, branch, device.context_id, device.subscription)
						.run();
				} else {
					const message: OrderPushMessage = {
						version: 1,
						type: 'order_created',
						branch,
						user_id: device.user_id,
						device_id: device.device_id,
						sequence: event.sequence,
						event_id: event.event_id,
						order_id: event.buku_kas_id,
						origin_device_id: event.origin_device_id,
						sound_enabled: device.sound_enabled === 1
					};
					// Re-read control-plane context/session immediately before provider I/O, not just at fanout.
					const current = await deviceById(env, device.device_id);
					if (
						!current ||
						!current.active ||
						current.cabang_id !== branch ||
						current.context_id !== device.context_id ||
						current.session_id !== device.session_id ||
						current.subscription !== device.subscription ||
						event.sequence <= Math.max(current.seen_cursor, current.delivered_cursor) ||
						!(await db
							.prepare(
								"SELECT id FROM buku_kas WHERE cabang_id=? AND id=? AND sumber='pos' AND preparation_state='pending'"
							)
							.bind(branch, event.buku_kas_id)
							.first()) ||
						!(await validNotificationSession(env, branch, current, opts.now ?? Date.now()))
					) {
						state = 'cancelled';
					} else {
						message.sound_enabled = current.sound_enabled === 1;
						const response = await (opts.send
							? opts.send(subscription, message)
							: sendWebPush(env, subscription, message));
						status = response.status;
						if (status === 201 || status === 202 || status === 200) state = 'sent';
						else if (status === 404 || status === 410) {
							state = 'cancelled';
							await registry
								.prepare(
									'UPDATE antrean_notification_devices SET subscription=NULL WHERE device_id=? AND cabang_id=? AND context_id=? AND subscription=?'
								)
								.bind(device.device_id, branch, device.context_id, device.subscription)
								.run();
						} else if (status === 429 || status >= 500 || status === 408) {
							const header = response.headers.get('Retry-After');
							const seconds = header === null ? NaN : Number(header);
							retryAfter = Number.isFinite(seconds)
								? Math.min(3600000, Math.max(0, seconds * 1000))
								: 0;
						} else state = 'failed';
					}
				}
			}
		} catch {
			// Unknown outcome is retryable; event_id remains identical for receiver dedup. No secret diagnostics.
			state = 'pending';
		}
		if (state === 'pending' && claimed.attempts >= MAX_ATTEMPTS) state = 'failed';
		const backoff = Math.min(3600000, 30000 * 2 ** (claimed.attempts - 1));
		const completionNow = opts.now ?? Date.now();
		await db
			.prepare(
				`UPDATE antrean_notification_deliveries SET state=?,last_status=?,next_attempt_at=?,lease_id=NULL,lease_until=0
   WHERE cabang_id=? AND event_id=? AND device_id=? AND context_id=? AND state='leased' AND lease_id=?`
			)
			.bind(
				state,
				status,
				completionNow + Math.max(backoff, retryAfter),
				branch,
				claimed.event_id,
				claimed.device_id,
				claimed.context_id,
				lease
			)
			.run();
	}
}
export async function kickOrderNotifications(
	platform: App.Platform | undefined,
	branch: BranchContext
): Promise<void> {
	const task = dispatchOrderNotifications(platform?.env as NotificationEnv, branch).catch(() => {
		// Durable event/delivery state remains available for the next scheduled relay.
	});
	try {
		platform?.context?.waitUntil(task);
	} catch {
		/* An unavailable request context does not invalidate checkout; cron owns recovery. */
	}
}
