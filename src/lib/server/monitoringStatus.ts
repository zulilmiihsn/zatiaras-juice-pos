import type { D1Database } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from './branchResolver';

export const MONITORING_SOURCE_NAMES = [
	'requestMetrics',
	'errorEvents',
	'auditLogs',
	'backupRuns'
] as const;

export type MonitoringSourceName = (typeof MONITORING_SOURCE_NAMES)[number];

export function clampWindowMinutes(value: string | null): number {
	const parsed = Number.parseInt(value || '', 10);
	if (Number.isNaN(parsed)) return 60;
	if (parsed < 5) return 5;
	if (parsed > 1440) return 1440;
	return parsed;
}

function percentile(values: number[], p: number): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
	return Math.round(sorted[index] * 100) / 100;
}

function average(values: number[]): number {
	if (!values.length) return 0;
	return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function buildMonitoringSourceStatus(
	results: PromiseSettledResult<unknown>[]
): Record<MonitoringSourceName, { available: boolean }> {
	if (results.length !== MONITORING_SOURCE_NAMES.length) {
		throw new Error('Jumlah hasil monitoring tidak valid');
	}
	return Object.fromEntries(
		MONITORING_SOURCE_NAMES.map((name, index) => [
			name,
			{ available: results[index]?.status === 'fulfilled' }
		])
	) as Record<MonitoringSourceName, { available: boolean }>;
}

export async function buildMonitoringSnapshot(
	db: D1Database,
	branch: string,
	windowMinutes: number
) {
	const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

	const [metricsSettled, errorsSettled, auditSettled, backupSettled] = await Promise.allSettled([
		db
			.prepare(
				`SELECT path, method, status, duration_ms, created_at
				 FROM request_metrics
				 WHERE cabang_id = ? AND created_at >= ?
				 ORDER BY created_at DESC
				 LIMIT 1000`
			)
			.bind(branch, cutoff)
			.all(),
		db
			.prepare(
				`SELECT source, message, status, created_at
				 FROM error_events
				 WHERE cabang_id = ? AND created_at >= ?
				 ORDER BY created_at DESC
				 LIMIT 100`
			)
			.bind(branch, cutoff)
			.all(),
		db
			.prepare(
				`SELECT action, entity_type, transaction_id, amount, created_at
				 FROM audit_logs
				 WHERE cabang_id = ? AND created_at >= ?
				 ORDER BY created_at DESC
				 LIMIT 50`
			)
			.bind(branch, cutoff)
			.all(),
		db
			.prepare(
				`SELECT database_name, operation, status, file_path, file_size_bytes, message, started_at, finished_at
				 FROM d1_backup_runs
				 WHERE cabang_id = ?
				 ORDER BY started_at DESC
				 LIMIT 10`
			)
			.bind(branch)
			.all()
	]);

	const sourceStatus = buildMonitoringSourceStatus([
		metricsSettled,
		errorsSettled,
		auditSettled,
		backupSettled
	]);
	const degraded = Object.values(sourceStatus).some((source) => !source.available);
	const metricsResult =
		metricsSettled.status === 'fulfilled' ? metricsSettled.value : { results: [] };
	const errorsResult = errorsSettled.status === 'fulfilled' ? errorsSettled.value : { results: [] };
	const auditResult = auditSettled.status === 'fulfilled' ? auditSettled.value : { results: [] };
	const backupResult = backupSettled.status === 'fulfilled' ? backupSettled.value : { results: [] };

	const metrics = (metricsResult.results || []) as Array<{
		path: string;
		method: string;
		status: number;
		duration_ms: number;
		created_at: string;
	}>;
	const durations = metrics.map((item) => Number(item.duration_ms || 0)).filter(Number.isFinite);
	const slowest = [...metrics]
		.sort((a, b) => Number(b.duration_ms || 0) - Number(a.duration_ms || 0))
		.slice(0, 10);

	const statusCounts = metrics.reduce<Record<string, number>>((acc, item) => {
		const bucket = `${Math.floor(Number(item.status || 0) / 100)}xx`;
		acc[bucket] = (acc[bucket] || 0) + 1;
		return acc;
	}, {});

	return {
		success: true,
		degraded,
		sources: sourceStatus,
		branch,
		windowMinutes,
		requests: {
			total: metrics.length,
			avgLatencyMs: average(durations),
			p95LatencyMs: percentile(durations, 95),
			maxLatencyMs: durations.length ? Math.max(...durations) : 0,
			statusCounts,
			slowest
		},
		errors: {
			total: (errorsResult.results || []).length,
			recent: errorsResult.results || []
		},
		audit: {
			totalRecent: (auditResult.results || []).length,
			recent: auditResult.results || []
		},
		backups: {
			recent: backupResult.results || []
		}
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function buildMonitoringSnapshotForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	windowMinutes: number
) {
	return buildMonitoringSnapshot(
		getD1Database(platform?.env as Record<string, unknown> | undefined, branch),
		branch,
		windowMinutes
	);
}
