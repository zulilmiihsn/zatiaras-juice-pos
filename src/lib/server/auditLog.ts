import type { BranchId, BranchContext } from '$lib/server/branchResolver';
import type { D1Database } from '@cloudflare/workers-types';
import {
	auditValues,
	buildAuditPayload,
	parseAuditPayload,
	type AuditLogInput
} from './auditEnvelope';
import { drainAuditOutbox } from './auditDrain';
export { buildAuditPayload } from './auditEnvelope';
export type { AuditLogInput } from './auditEnvelope';

export function auditLogStatement(
	db: D1Database,
	branch: BranchId,
	input: AuditLogInput,
	id = crypto.randomUUID()
) {
	return db
		.prepare(
			`INSERT INTO audit_logs(id,cabang_id,actor_user_id,actor_username,actor_role,action,entity_type,entity_id,transaction_id,amount,metadata,ip_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
		)
		.bind(
			id,
			branch,
			...auditValues(parseAuditPayload(buildAuditPayload(input), branch)),
			new Date().toISOString()
		);
}
/** Durability belongs to the business batch; delivery/retention must not require another sale. */
export function auditIntentStatement(
	db: D1Database,
	branch: BranchContext,
	input: AuditLogInput,
	identity: string,
	committedAt: string
) {
	return db
		.prepare(
			`INSERT INTO audit_log_outbox(id,cabang_id,payload,attempt_count,last_error,created_at,updated_at) VALUES(?,?,?,0,NULL,?,?)`
		)
		.bind(identity, branch, buildAuditPayload(input), committedAt, committedAt);
}
export async function appendAuditLog(db: D1Database, branch: BranchId, input: AuditLogInput) {
	const id = crypto.randomUUID(),
		now = Date.now(),
		stamp = new Date(now).toISOString();
	try {
		await db
			.prepare(
				'INSERT OR IGNORE INTO audit_log_outbox(id,cabang_id,payload,attempt_count,last_error,created_at,updated_at) VALUES(?,?,?,0,NULL,?,?)'
			)
			.bind(id, branch, buildAuditPayload(input), stamp, stamp)
			.run();
	} catch {
		return; /* Legacy best-effort logging cannot mask auth/business results; checkout uses atomic auditIntentStatement. */
	}
	await drainAuditOutbox(db, branch, { limit: 1, now, ids: [id] });
}
export async function flushAuditLogOutbox(
	db: D1Database,
	branch: BranchId,
	limit = 100,
	now = Date.now()
): Promise<number> {
	return (await drainAuditOutbox(db, branch, { limit, now })).delivered;
}
