import { getD1Database, getDrizzleDb, requireBranch } from '$lib/server/branchResolver';
import { publishBranchEvent, type RealtimeTable } from '$lib/server/realtimePublisher';
import { appendAuditLog } from '$lib/server/auditLog';
import type { D1Database } from '@cloudflare/workers-types';

/** Helper bersama untuk handler /api/data (GET reads & POST writes). */

export function getDb(platform: App.Platform | undefined, branch: string) {
	return getDrizzleDb(platform, requireBranch(branch));
}

export function getRawDb(platform: App.Platform | undefined, branch: string) {
	return getD1Database(platform?.env as Record<string, unknown> | undefined, requireBranch(branch));
}

export function newId() {
	return crypto.randomUUID();
}

export function payloadRows(
	payload: Record<string, unknown> | Record<string, unknown>[],
	branch: string
) {
	const rows = Array.isArray(payload) ? payload : [payload];
	return rows.map((row) => {
		const rawId = row.id != null && String(row.id).trim() !== '' ? String(row.id) : newId();
		return {
			...row,
			id: rawId,
			cabang_id: branch
		};
	}) as Array<Record<string, any>>;
}

export async function publish(
	platform: App.Platform | undefined,
	branch: string,
	table: RealtimeTable,
	action: 'insert' | 'update' | 'delete' | 'upsert',
	extra: Record<string, unknown> = {}
) {
	await publishBranchEvent(
		platform?.env as Record<string, unknown> | undefined,
		branch,
		table,
		action,
		extra
	);
}

export async function auditDataChange(
	db: D1Database,
	branch: string,
	session: App.Locals['authSession'],
	table: string,
	action: string,
	entityId: string | number | null | undefined,
	metadata: Record<string, unknown> = {}
) {
	await appendAuditLog(db, requireBranch(branch), {
		action: `${table}.${action}`,
		entityType: table,
		entityId: entityId == null ? null : String(entityId),
		session,
		metadata
	});
}
