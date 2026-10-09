import { getD1Database, normalizeBranch, type BranchId } from '$lib/server/branchResolver';
import { appendAuditLog } from '$lib/server/auditLog';

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
	// AUD-017: telemetri anonim tak boleh pilih tenant via ?branch=.
	// Sesi ada = cabang sesi otoritas (fallback diabaikan).
	// Tanpa sesi = null (drop, tak tulis ke tabel tenant mana pun).
	// Tanpa default samarinda: trafik anonim bukan data cabang.
	if (session?.branch) {
		try {
			return normalizeBranch(session.branch);
		} catch {
			return null;
		}
	}
	void platform;
	void fallback;
	return null;
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

async function hashIdentifier(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; tulis audit milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export async function recordSecurityEvent(
	platform: App.Platform | undefined,
	branch: BranchId | null,
	input: {
		eventType: string;
		timestamp: number;
		eventData: unknown;
		clientIp: string;
		session: App.Locals['authSession'];
	}
): Promise<void> {
	if (!branch) return;
	const db = getObservationDb(platform, branch);
	await appendAuditLog(db, branch, {
		action: `security.${input.eventType}`,
		entityType: 'security_event',
		ipHash: await hashIdentifier(input.clientIp),
		session: input.session,
		metadata: {
			eventType: input.eventType,
			data: input.eventData,
			timestamp: input.timestamp
		}
	});
}
