import { getD1Database, normalizeBranch, type BranchId } from '$lib/server/branchResolver';

type ObservationSession = {
	userId?: string | null;
	role?: string | null;
	branch?: string | null;
} | null;

export function branchFromObservation(
	platform: App.Platform | undefined,
	session: ObservationSession,
	fallback?: unknown
): BranchId | null {
	try {
		return normalizeBranch(session?.branch || fallback || '');
	} catch {
		const env = platform?.env as Record<string, unknown> | undefined;
		if (env?.DB_SAMARINDA_GROUP || env?.DB) return 'samarinda';
		return null;
	}
}

function getObservationDb(platform: App.Platform | undefined, branch: BranchId) {
	return getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
}

function errorMessage(error: unknown) {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return 'Unknown error';
	}
}

function errorStack(error: unknown) {
	if (error instanceof Error && error.stack) return error.stack.slice(0, 4096);
	return null;
}

export async function recordErrorEvent(
	platform: App.Platform | undefined,
	branch: BranchId | null,
	input: {
		source: string;
		error: unknown;
		status?: number | null;
		context?: Record<string, unknown> | null;
		session?: ObservationSession;
	}
) {
	if (!branch) return;

	try {
		const db = getObservationDb(platform, branch);
		await db
			.prepare(
				`INSERT INTO error_events (
					id,
					cabang_id,
					source,
					message,
					stack,
					status,
					context,
					user_id,
					role,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				branch,
				input.source.slice(0, 160),
				errorMessage(input.error).slice(0, 1000),
				errorStack(input.error),
				input.status ?? null,
				input.context ? JSON.stringify(input.context).slice(0, 4096) : null,
				input.session?.userId ?? null,
				input.session?.role ?? null,
				new Date().toISOString()
			)
			.run();
	} catch {
		// [CATATAN]: Observability must never become outage source.
	}
}

export async function recordRequestMetric(
	platform: App.Platform | undefined,
	branch: BranchId | null,
	input: {
		method: string;
		path: string;
		status: number;
		durationMs: number;
		dbMeta?: string | null;
		session?: ObservationSession;
	}
) {
	if (!branch) return;

	try {
		const db = getObservationDb(platform, branch);
		await db
			.prepare(
				`INSERT INTO request_metrics (
					id,
					cabang_id,
					method,
					path,
					status,
					duration_ms,
					db_meta,
					user_id,
					role,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				branch,
				input.method.slice(0, 12),
				input.path.slice(0, 180),
				input.status,
				Math.round(input.durationMs * 100) / 100,
				input.dbMeta ? input.dbMeta.slice(0, 1000) : null,
				input.session?.userId ?? null,
				input.session?.role ?? null,
				new Date().toISOString()
			)
			.run();
	} catch {
		// [CATATAN]: Ignore until migrations are applied.
	}
}
