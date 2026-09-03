export const MONITORING_SOURCE_NAMES = [
	'requestMetrics',
	'errorEvents',
	'auditLogs',
	'backupRuns'
] as const;

export type MonitoringSourceName = (typeof MONITORING_SOURCE_NAMES)[number];

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
