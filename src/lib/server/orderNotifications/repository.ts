import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from '../branchResolver';

export type NotificationEnv = Record<string, unknown> | undefined;
export interface DeviceRow {
	device_id: string;
	token_hash: string;
	cabang_id: string;
	user_id: string;
	session_id: string;
	context_id: string;
	active: number;
	sound_enabled: number;
	subscription: string | null;
	expires_at: number;
	baseline_cursor: number;
	seen_cursor: number;
	delivered_cursor: number;
	dispatch_cursor: number;
	updated_at: number;
}
export interface EventRow {
	sequence: number;
	event_id: string;
	buku_kas_id: string;
	origin_device_id: string | null;
	claimed_origin_device_id: string | null;
	origin_device_token_hash: string | null;
	created_at: string;
	is_pending: number;
}
export function registryDb(env: NotificationEnv): D1Database {
	const db = env?.DB_SAMARINDA_GROUP || env?.DB;
	if (!db) throw new Error('Penyimpanan notifikasi tidak tersedia');
	return db as D1Database;
}
export function notificationDb(env: NotificationEnv, branch: BranchContext): D1Database {
	return getD1Database(env, branch);
}
export function buildOrderCreatedStatement(
	db: D1Database,
	branch: BranchContext,
	input: {
		bukuKasId: string;
		idempotencyKey: string;
		originDeviceId: string | null;
		createdAt: string;
		claimedOriginDeviceId?: string | null;
		originDeviceTokenHash?: string | null;
	}
): D1PreparedStatement {
	return db
		.prepare(
			`INSERT OR IGNORE INTO antrean_notification_events
  (event_id,cabang_id,buku_kas_id,idempotency_key,origin_device_id,claimed_origin_device_id,origin_device_token_hash,created_at)
  SELECT ?,cabang_id,id,idempotency_key,?,?,?,? FROM buku_kas
  WHERE cabang_id=? AND id=? AND idempotency_key=? AND sumber='pos'
  AND preparation_state='pending' AND restored_from_archive=0`
		)
		.bind(
			crypto.randomUUID(),
			input.originDeviceId,
			input.claimedOriginDeviceId ?? null,
			input.originDeviceTokenHash ?? null,
			input.createdAt,
			branch,
			input.bukuKasId,
			input.idempotencyKey
		);
}
export async function eventHead(db: D1Database, branch: BranchContext): Promise<number> {
	return Number(
		await db
			.prepare(
				'SELECT COALESCE(MAX(sequence),0) AS head FROM antrean_notification_events WHERE cabang_id=?'
			)
			.bind(branch)
			.first<number>('head')
	);
}
export async function eventPage(
	db: D1Database,
	branch: BranchContext,
	after: number,
	limit: number
): Promise<EventRow[]> {
	const rows = await db
		.prepare(
			`SELECT e.sequence,e.event_id,e.buku_kas_id,e.origin_device_id,e.claimed_origin_device_id,e.origin_device_token_hash,e.created_at,
  CASE WHEN b.preparation_state='pending' AND b.sumber='pos' THEN 1 ELSE 0 END AS is_pending
  FROM antrean_notification_events e LEFT JOIN buku_kas b ON b.cabang_id=e.cabang_id AND b.id=e.buku_kas_id
  WHERE e.cabang_id=? AND e.sequence>? ORDER BY e.sequence ASC LIMIT ?`
		)
		.bind(branch, after, limit)
		.all<EventRow>();
	return rows.results;
}
export async function deviceById(env: NotificationEnv, id: string): Promise<DeviceRow | null> {
	return registryDb(env)
		.prepare('SELECT * FROM antrean_notification_devices WHERE device_id=?')
		.bind(id)
		.first<DeviceRow>();
}
export async function validNotificationSession(
	env: NotificationEnv,
	branch: BranchContext,
	device: DeviceRow,
	now: number
): Promise<boolean> {
	const row = await notificationDb(env, branch)
		.prepare(
			`SELECT p.role FROM auth_sessions s
  INNER JOIN profil p ON p.cabang_id=s.cabang_id AND p.id=s.user_id
  WHERE s.cabang_id=? AND s.id=? AND s.user_id=? AND s.expires_at>? LIMIT 1`
		)
		.bind(branch, device.session_id, device.user_id, now)
		.first<{ role: string }>();
	return !!row && (row.role === 'kasir' || row.role === 'pemilik');
}

export function isOriginDevice(
	event: Pick<
		EventRow,
		'origin_device_id' | 'claimed_origin_device_id' | 'origin_device_token_hash'
	>,
	device: Pick<DeviceRow, 'device_id' | 'token_hash'>
): boolean {
	return (
		event.origin_device_id === device.device_id ||
		(event.claimed_origin_device_id === device.device_id &&
			event.origin_device_token_hash === device.token_hash)
	);
}
