/**
 * Alert operasional: cron Worker realtime memeriksa metrik request tiap cabang dan, bila
 * error server atau latensi melonjak, mengirim Web Push ke perangkat pemilik cabang itu.
 * Satu alert per cabang paling banyak tiap 30 menit. Kegagalan di sini tidak pernah
 * memengaruhi transaksi; ini hanya pengamatan.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from './branchResolver';
import { consumeRateLimit } from './rateLimit';
import { registryDb, type DeviceRow, type NotificationEnv } from './orderNotifications/repository';
import { notificationConfig, sendWebPush } from './orderNotifications/webPush';
import type { OpsAlertPushMessage, OrderPushSubscription } from '../types/orderNotifications';
// Path relatif: modul ini ikut dibundel Worker realtime (wrangler tidak mengenal alias $lib).
import { branchLabel } from '../utils/branches';

export const OPS_ALERT_WINDOW_MS = 5 * 60 * 1000;
export const OPS_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
/** Respons 5xx dalam jendela yang dianggap lonjakan. */
export const OPS_ALERT_SERVER_ERRORS = 5;
/** p95 latensi API yang dianggap lambat, hanya bila sampel cukup. */
export const OPS_ALERT_P95_MS = 3000;
export const OPS_ALERT_MIN_REQUESTS = 20;

export interface BranchHealth {
	requests: number;
	serverErrors: number;
	p95Ms: number;
}

export async function readBranchHealth(
	db: D1Database,
	branch: BranchContext,
	now: number
): Promise<BranchHealth> {
	const since = new Date(now - OPS_ALERT_WINDOW_MS).toISOString();
	const rows = await db
		.prepare(
			`SELECT status, duration_ms FROM request_metrics
			 WHERE cabang_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 2000`
		)
		.bind(branch, since)
		.all<{ status: number; duration_ms: number }>();
	const results = rows.results ?? [];
	const durations = results.map((row) => Number(row.duration_ms) || 0).sort((a, b) => a - b);
	const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
	return {
		requests: results.length,
		serverErrors: results.filter((row) => Number(row.status) >= 500).length,
		p95Ms: durations.length ? Math.round(durations[p95Index]) : 0
	};
}

/** Kalimat alert untuk pemilik, atau null bila cabang sehat. */
export function describeUnhealthy(branch: BranchContext, health: BranchHealth): string | null {
	const problems: string[] = [];
	if (health.serverErrors >= OPS_ALERT_SERVER_ERRORS)
		problems.push(`${health.serverErrors} error server`);
	if (health.requests >= OPS_ALERT_MIN_REQUESTS && health.p95Ms > OPS_ALERT_P95_MS)
		problems.push(`respons lambat (p95 ${(health.p95Ms / 1000).toFixed(1)} detik)`);
	if (!problems.length) return null;
	return `${branchLabel(branch) ?? branch}: ${problems.join(' dan ')} dalam 5 menit terakhir. Periksa aplikasi dan hubungi pengembang bila berlanjut.`;
}

type AlertSender = (
	subscription: OrderPushSubscription,
	message: OpsAlertPushMessage
) => Promise<Response>;

/** Perangkat ber-push milik akun pemilik cabang dengan sesi yang masih berlaku. */
async function ownerDevices(
	env: NotificationEnv,
	db: D1Database,
	branch: BranchContext,
	now: number
): Promise<DeviceRow[]> {
	const devices = await registryDb(env)
		.prepare(
			`SELECT * FROM antrean_notification_devices
			 WHERE cabang_id = ? AND active = 1 AND subscription IS NOT NULL AND expires_at > ?
			 ORDER BY device_id LIMIT 100`
		)
		.bind(branch, now)
		.all<DeviceRow>();
	const owners: DeviceRow[] = [];
	for (const device of devices.results ?? []) {
		const owner = await db
			.prepare(
				`SELECT 1 FROM auth_sessions s
				 INNER JOIN profil p ON p.cabang_id = s.cabang_id AND p.id = s.user_id
				 WHERE s.cabang_id = ? AND s.id = ? AND s.user_id = ? AND s.expires_at > ?
					AND p.role = 'pemilik' LIMIT 1`
			)
			.bind(branch, device.session_id, device.user_id, now)
			.first();
		if (owner) owners.push(device);
	}
	return owners;
}

export async function checkOpsAlerts(
	env: NotificationEnv,
	branch: BranchContext,
	opts: { now?: number; send?: AlertSender } = {}
): Promise<{ alerted: boolean; recipients: number }> {
	const now = opts.now ?? Date.now();
	if (!opts.send && !(await notificationConfig(env)).push_configured)
		return { alerted: false, recipients: 0 };
	const db = getD1Database(env, branch);
	const summary = describeUnhealthy(branch, await readBranchHealth(db, branch, now));
	if (!summary) return { alerted: false, recipients: 0 };

	// Pembatas kirim memakai tabel rate limit yang sama dengan login/checkout.
	const gate = await consumeRateLimit(db, branch, 'ops-alert', 1, OPS_ALERT_COOLDOWN_MS, {
		env
	} as App.Platform);
	if (!gate.allowed) return { alerted: false, recipients: 0 };

	const send = opts.send ?? ((subscription, message) => sendWebPush(env, subscription, message));
	let recipients = 0;
	for (const device of await ownerDevices(env, db, branch, now)) {
		let subscription: OrderPushSubscription;
		try {
			subscription = JSON.parse(String(device.subscription)) as OrderPushSubscription;
		} catch {
			continue;
		}
		try {
			const response = await send(subscription, {
				version: 1,
				type: 'ops_alert',
				branch,
				user_id: device.user_id,
				device_id: device.device_id,
				summary
			});
			if (response.status === 404 || response.status === 410) {
				// Langganan kedaluwarsa dilepas seperti di relay pesanan; aktivasi ulang lewat UI.
				await registryDb(env)
					.prepare(
						'UPDATE antrean_notification_devices SET subscription=NULL WHERE device_id=? AND cabang_id=? AND subscription=?'
					)
					.bind(device.device_id, branch, device.subscription)
					.run();
			} else if (response.ok) recipients++;
		} catch {
			// Provider tidak tersedia: alert berikutnya dicoba setelah jeda, transaksi tidak terdampak.
		}
	}
	return { alerted: true, recipients };
}
