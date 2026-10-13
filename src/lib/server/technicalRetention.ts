import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import type { AuditBudget } from './auditDrain';
export const TECHNICAL_RETENTION_DAYS = 90;
export const RETENTION_ROWS_PER_TABLE = 100;
/** Every destructive predicate stays in the target statement; advisory reads do not authorize deletion. */
export async function cleanTechnicalRows(
	db: D1Database,
	branch: BranchContext,
	now: number,
	budget: AuditBudget
): Promise<number> {
	const cutoffMs = now - TECHNICAL_RETENTION_DAYS * 86400000,
		cutoff = new Date(cutoffMs).toISOString();
	const plans = [
		...['audit_logs', 'request_metrics', 'error_events'].map((table) => ({
			table,
			predicate: 'julianday(created_at) < julianday(?)',
			cutoff
		})),
		{
			table: 'audit_log_quarantine',
			predicate: 'julianday(quarantined_at) < julianday(?)',
			cutoff
		},
		{
			table: 'antrean_notification_deliveries',
			predicate:
				"state IN ('sent','cancelled','failed') AND next_attempt_at < ? AND lease_until<=? AND lease_id IS NULL",
			cutoff: cutoffMs
		},
		{
			table: 'antrean_notification_events',
			predicate: `julianday(created_at) < julianday(?) AND NOT EXISTS(SELECT 1 FROM antrean_notification_deliveries d WHERE d.cabang_id=antrean_notification_events.cabang_id AND d.event_id=antrean_notification_events.event_id AND d.state IN ('pending','leased')) AND NOT EXISTS(SELECT 1 FROM buku_kas b WHERE b.cabang_id=antrean_notification_events.cabang_id AND b.id=antrean_notification_events.buku_kas_id AND b.sumber='pos' AND b.preparation_state='pending')`,
			cutoff
		}
	];
	let deleted = 0;
	for (const plan of plans) {
		if (budget.remaining <= 0) break;
		budget.remaining--;
		budget.used++;
		try {
			const result = await db
				.prepare(
					`DELETE FROM ${plan.table} WHERE cabang_id=? AND rowid IN (SELECT rowid FROM ${plan.table} WHERE cabang_id=? AND ${plan.predicate} ORDER BY rowid LIMIT ?)`
				)
				.bind(
					branch,
					branch,
					plan.cutoff,
					...(plan.table === 'antrean_notification_deliveries' ? [now] : []),
					RETENTION_ROWS_PER_TABLE
				)
				.run();
			deleted += Number(result.meta?.changes ?? 0);
		} catch {
			/* Best-effort per-table maintenance retains unavailable schemas and never touches business data. */
		}
	}
	return deleted;
}
/** Only co-located delivery references can be guarded atomically with a registry delete. */
export async function cleanLocalRegistryDevices(
	registry: D1Database,
	branch: BranchContext,
	now: number,
	budget: AuditBudget
): Promise<number> {
	if (!['samarinda', 'samarinda2'].includes(branch) || budget.remaining <= 0) return 0;
	budget.remaining--;
	budget.used++;
	try {
		const result = await registry
			.prepare(
				`DELETE FROM antrean_notification_devices WHERE cabang_id=? AND device_id IN
		(SELECT v.device_id FROM antrean_notification_devices v WHERE v.cabang_id=? AND v.active=0 AND v.expires_at<?
		AND NOT EXISTS(SELECT 1 FROM antrean_notification_deliveries d WHERE d.cabang_id=v.cabang_id AND d.device_id=v.device_id AND d.state IN ('pending','leased')) ORDER BY v.device_id LIMIT ?)`
			)
			.bind(branch, branch, now - TECHNICAL_RETENTION_DAYS * 86400000, RETENTION_ROWS_PER_TABLE)
			.run();
		return Number(result.meta?.changes ?? 0);
	} catch {
		return 0; /* Missing registry/schema keeps tombstones; no cross-shard advisory-delete fallback. */
	}
}
