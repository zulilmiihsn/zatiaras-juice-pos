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

const AUDIT_METADATA_BYTES = 8192;

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).length;
}

/**
 * Metadata dibatasi SEBELUM stringify sehingga JSON tetap valid.
 * Envelope audit (action/entity/actor/branch/transaction) selalu utuh.
 */

function safeStringify(value: unknown): string | null {
	try {
		const seen = new Set();
		return JSON.stringify(value, (_key, val) => {
			if (val && typeof val === 'object') {
				if (seen.has(val)) return '[cyclic]';
				seen.add(val);
			}
			return val;
		});
	} catch {
		return null;
	}
}

function boundedMetadataObject(
	value: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
	if (!value) return null;
	const direct = safeStringify(value);
	if (direct !== null && utf8Length(direct) <= AUDIT_METADATA_BYTES) return value;
	const summary: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
			summary[k] = `${k}:${String(v)}`.slice(0, 120);
			if ((safeStringify(summary)?.length ?? 0) > 1024) {
				delete summary[k];
				break;
			}
		}
	}
	return {
		truncated: true,
		byte_size: direct !== null ? utf8Length(direct) : null,
		summary
	};
}

/** Payload outbox valid JSON; envelope wajib utuh, metadata dibatasi dulu. */
export function buildAuditPayload(input: AuditLogInput): string {
	const payload = safeStringify({ ...input, metadata: boundedMetadataObject(input.metadata) });
	return payload ?? '{}';
}

function boundedMetadataJson(value: Record<string, unknown> | null | undefined): string | null {
	const obj = boundedMetadataObject(value);
	if (!obj) return null;
	return safeStringify(obj);
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
			boundedMetadataJson(input.metadata),
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

async function quarantineOutboxRow(
	db: import('@cloudflare/workers-types').D1Database,
	row: { id: string; cabang_id?: string; payload: string; attempt_count?: number },
	branch: BranchId,
	reason: unknown
): Promise<void> {
	try {
		const now = new Date().toISOString();
		await db.batch([
			db
				.prepare(
					`INSERT OR IGNORE INTO audit_log_quarantine (id, cabang_id, payload, reason, attempt_count, created_at, quarantined_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					row.id,
					row.cabang_id ?? branch,
					row.payload,
					String(reason instanceof Error ? reason.message : reason).slice(0, 1000),
					Number(row.attempt_count || 0),
					now,
					now
				),
			db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id)
		]);
	} catch {
		// Karantina best-effort; jangan tutupi operasi utama.
	}
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
	const payload = buildAuditPayload(input);
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
			`SELECT id, cabang_id, payload, attempt_count FROM audit_log_outbox
			 WHERE cabang_id = ? ORDER BY created_at ASC LIMIT ?`
		)
		.bind(branch, limit)
		.all()) as {
		results?: Array<{ id: string; cabang_id?: string; payload: string; attempt_count?: number }>;
	};
	let flushed = 0;
	for (const row of rows.results || []) {
		let input: AuditLogInput;
		try {
			input = JSON.parse(row.payload) as AuditLogInput;
			if (!input || typeof input !== 'object' || typeof input.action !== 'string')
				throw new Error('payload outbox invalid');
		} catch (error) {
			// Invalid selamanya: karantina dengan alasan (bukan hapus diam-diam).
			await quarantineOutboxRow(db, row, branch, error);
			continue;
		}
		try {
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
					boundedMetadataJson(input.metadata),
					input.ipHash ?? null,
					new Date().toISOString()
				)
				.run();
			await db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id).run();
			flushed += 1;
		} catch (error) {
			// Gagal berulang (mis. constraint) -> karantina agar antrean jalan terus.
			if (Number(row.attempt_count || 0) >= 5) {
				await quarantineOutboxRow(db, row, branch, error);
			} else {
				await markOutboxFailure(db, row.id, error);
			}
		}
	}
	return flushed;
}
