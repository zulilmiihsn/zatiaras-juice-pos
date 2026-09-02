import type { BranchId } from '$lib/server/branchResolver';

type AuditSession = {
	userId?: string | null;
	username?: string | null;
	role?: string | null;
};

export type AuditLogInput = {
	action: string;
	entityType: string;
	entityId?: string | number | null;
	transactionId?: string | null;
	amount?: number | null;
	metadata?: Record<string, unknown> | null;
	ipHash?: string | null;
	session?: AuditSession | null;
};

function toJson(value: Record<string, unknown> | null | undefined) {
	if (!value) return null;
	try {
		return JSON.stringify(value).slice(0, 8192);
	} catch {
		return null;
	}
}

export function auditLogStatement(
	db: import('@cloudflare/workers-types').D1Database,
	branch: BranchId,
	input: AuditLogInput,
	id = crypto.randomUUID()
) {
	return db
		.prepare(
			`INSERT INTO audit_logs (
				id,
				cabang_id,
				actor_user_id,
				actor_username,
				actor_role,
				action,
				entity_type,
				entity_id,
				transaction_id,
				amount,
				metadata,
				ip_hash,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			branch,
			input.session?.userId ?? null,
			input.session?.username ?? null,
			input.session?.role ?? null,
			input.action,
			input.entityType,
			input.entityId == null ? null : String(input.entityId),
			input.transactionId ?? null,
			input.amount ?? null,
			toJson(input.metadata),
			input.ipHash ?? null,
			new Date().toISOString()
		);
}

function outboxInsertStatement(
	db: import('@cloudflare/workers-types').D1Database,
	branch: BranchId,
	id: string,
	payload: string,
	now: string
) {
	return db
		.prepare(
			`INSERT OR IGNORE INTO audit_log_outbox (
				id, cabang_id, payload, attempt_count, last_error, created_at, updated_at
			) VALUES (?, ?, ?, 0, NULL, ?, ?)`
		)
		.bind(id, branch, payload, now, now);
}

async function markOutboxFailure(
	db: import('@cloudflare/workers-types').D1Database,
	id: string,
	error: unknown
) {
	try {
		await db
			.prepare(
				`UPDATE audit_log_outbox
				 SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
				 WHERE id = ?`
			)
			.bind(
				String(error instanceof Error ? error.message : error).slice(0, 1000),
				new Date().toISOString(),
				id
			)
			.run();
	} catch {
		// Outbox failure must never mask the primary operation.
	}
}

export async function appendAuditLog(
	db: import('@cloudflare/workers-types').D1Database,
	branch: BranchId,
	input: AuditLogInput
) {
	const id = crypto.randomUUID();
	const payload = toJson(input) || '{}';
	const now = new Date().toISOString();
	try {
		await outboxInsertStatement(db, branch, id, payload, now).run();
	} catch {
		return;
	}

	try {
		await db
			.prepare(
				`INSERT OR IGNORE INTO audit_logs (
					id, cabang_id, actor_user_id, actor_username, actor_role, action,
					entity_type, entity_id, transaction_id, amount, metadata, ip_hash, created_at
				) SELECT ?, ?,
					json_extract(?, '$.session.userId'), json_extract(?, '$.session.username'),
					json_extract(?, '$.session.role'), json_extract(?, '$.action'),
					json_extract(?, '$.entityType'), json_extract(?, '$.entityId'),
					json_extract(?, '$.transactionId'), json_extract(?, '$.amount'),
					json_extract(?, '$.metadata'), json_extract(?, '$.ipHash'), ?`
			)
			.bind(
				id,
				branch,
				payload,
				payload,
				payload,
				payload,
				payload,
				payload,
				payload,
				payload,
				payload,
				payload,
				now
			)
			.run();
		await db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(id).run();
	} catch (error) {
		await markOutboxFailure(db, id, error);
	}
}

export async function flushAuditLogOutbox(
	db: import('@cloudflare/workers-types').D1Database,
	branch: BranchId,
	limit = 100
): Promise<number> {
	const rows = (await db
		.prepare(
			`SELECT id, payload FROM audit_log_outbox
			 WHERE cabang_id = ? ORDER BY created_at ASC LIMIT ?`
		)
		.bind(branch, limit)
		.all()) as { results?: Array<{ id: string; payload: string }> };
	let flushed = 0;
	for (const row of rows.results || []) {
		try {
			const input = JSON.parse(row.payload) as AuditLogInput;
			await db
				.prepare(
					`INSERT OR IGNORE INTO audit_logs (
						id, cabang_id, actor_user_id, actor_username, actor_role, action,
						entity_type, entity_id, transaction_id, amount, metadata, ip_hash, created_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					row.id,
					branch,
					input.session?.userId ?? null,
					input.session?.username ?? null,
					input.session?.role ?? null,
					input.action,
					input.entityType,
					input.entityId == null ? null : String(input.entityId),
					input.transactionId ?? null,
					input.amount ?? null,
					toJson(input.metadata),
					input.ipHash ?? null,
					new Date().toISOString()
				)
				.run();
			await db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id).run();
			flushed += 1;
		} catch (error) {
			await markOutboxFailure(db, row.id, error);
		}
	}
	return flushed;
}
