import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { BranchId } from './branchResolver';
import { auditValues, parseAuditPayload } from './auditEnvelope';
export const AUDIT_PAGE_ROWS = 100;
export const AUDIT_MAX_PAYLOAD_BYTES = 65536;
const DOCUMENT_BYTES = 262144;
const RETENTION_MS = 90 * 86400000;
export interface AuditBudget {
	remaining: number;
	used: number;
}
export interface AuditDrainReport {
	selected: number;
	delivered: number;
	quarantined: number;
	retained: number;
	exhausted: boolean;
}
interface OutboxRow {
	id: string;
	cabang_id: string;
	payload: string | null;
	payload_bytes: number;
	attempt_count: number;
	created_at: string;
	updated_at: string;
}
interface Snapshot extends OutboxRow {
	values?: (string | number | null)[];
}
const FIELDS = [
	'actor_user_id',
	'actor_username',
	'actor_role',
	'action',
	'entity_type',
	'entity_id',
	'transaction_id',
	'amount',
	'metadata',
	'ip_hash'
];
const SOURCE = `o.id=json_extract(r.value,'$.id') AND o.cabang_id=? AND o.created_at IS json_extract(r.value,'$.created_at') AND o.updated_at IS json_extract(r.value,'$.updated_at') AND o.attempt_count IS json_extract(r.value,'$.attempt_count') AND (o.payload IS json_extract(r.value,'$.payload') OR (json_extract(r.value,'$.payload') IS NULL AND length(CAST(o.payload AS BLOB))>${AUDIT_MAX_PAYLOAD_BYTES}))`;
function eventTime(value: string): number {
	// SQLite CURRENT_TIMESTAMP is UTC even though its historical representation omits a zone.
	return Date.parse(
		/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
			? `${value.replace(' ', 'T')}Z`
			: value
	);
}
function changes(result: D1Result<unknown>): number {
	return Number(result.meta?.changes ?? 0);
}
function documents(rows: Snapshot[]): Snapshot[][] {
	const groups: Snapshot[][] = [];
	let group: Snapshot[] = [];
	let bytes = 2;
	for (const row of rows) {
		const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
		if (group.length && bytes + size > DOCUMENT_BYTES) {
			groups.push(group);
			group = [];
			bytes = 2;
		}
		group.push(row);
		bytes += size;
	}
	if (group.length) groups.push(group);
	return groups;
}
async function execute(
	db: D1Database,
	budget: AuditBudget,
	statements: D1PreparedStatement[]
): Promise<D1Result<unknown>[] | null> {
	if (budget.remaining < statements.length) return null;
	budget.remaining -= statements.length;
	budget.used += statements.length;
	return db.batch(statements);
}
async function failed(
	db: D1Database,
	branch: BranchId,
	rows: Snapshot[],
	budget: AuditBudget,
	now: string,
	reason: string
): Promise<void> {
	try {
		await execute(db, budget, [
			db
				.prepare(
					`UPDATE audit_log_outbox AS o SET attempt_count=attempt_count+1,last_error=?,updated_at=? WHERE EXISTS(SELECT 1 FROM json_each(?) r WHERE ${SOURCE})`
				)
				.bind(reason, now, JSON.stringify(rows), branch)
		]);
	} catch {
		/* Best-effort retry accounting never deletes the durable source or masks a sink outage. */
	}
}
async function quarantine(
	db: D1Database,
	branch: BranchId,
	rows: Snapshot[],
	budget: AuditBudget,
	now: string,
	reason: string
): Promise<number> {
	const doc = JSON.stringify(rows);
	try {
		const result = await execute(db, budget, [
			db
				.prepare(
					`INSERT OR IGNORE INTO audit_log_quarantine(id,cabang_id,payload,reason,attempt_count,created_at,quarantined_at)
			SELECT o.id,o.cabang_id,o.payload,?,o.attempt_count,o.created_at,? FROM json_each(?) r INNER JOIN audit_log_outbox o ON ${SOURCE}`
				)
				.bind(reason, now, doc, branch),
			db
				.prepare(
					`DELETE FROM audit_log_outbox AS o WHERE EXISTS(SELECT 1 FROM json_each(?) r INNER JOIN audit_log_quarantine q ON q.id=o.id AND q.cabang_id=o.cabang_id AND q.payload IS o.payload AND q.created_at IS o.created_at WHERE ${SOURCE})`
				)
				.bind(doc, branch)
		]);
		if (!result) return 0;
		const removed = changes(result[1]);
		if (removed < rows.length)
			await failed(db, branch, rows, budget, now, 'AUDIT_QUARANTINE_CONFLICT');
		return removed;
	} catch {
		await failed(db, branch, rows, budget, now, 'AUDIT_QUARANTINE_UNAVAILABLE');
		return 0;
	}
}
async function deliver(
	db: D1Database,
	branch: BranchId,
	rows: Snapshot[],
	budget: AuditBudget,
	now: string,
	isolation = { remaining: 32 }
): Promise<number> {
	if (isolation.remaining < 2) {
		await failed(db, branch, rows, budget, now, 'AUDIT_DELIVERY_UNAVAILABLE');
		return 0;
	}
	isolation.remaining -= 2;
	const doc = JSON.stringify(rows);
	const values = FIELDS.map((_field, i) => `json_extract(r.value,'$.values[${i}]')`);
	try {
		const result = await execute(db, budget, [
			db
				.prepare(
					`INSERT OR IGNORE INTO audit_logs(id,cabang_id,${FIELDS.join(',')},created_at)
			SELECT o.id,o.cabang_id,${values.join(',')},o.created_at FROM json_each(?) r INNER JOIN audit_log_outbox o ON ${SOURCE}`
				)
				.bind(doc, branch),
			db
				.prepare(
					`DELETE FROM audit_log_outbox AS o WHERE EXISTS(SELECT 1 FROM json_each(?) r INNER JOIN audit_logs a ON a.id=o.id AND a.cabang_id=o.cabang_id AND a.created_at IS o.created_at AND ${FIELDS.map((field, i) => `a.${field} IS ${values[i]}`).join(' AND ')} WHERE ${SOURCE})`
				)
				.bind(doc, branch)
		]);
		if (!result) return 0;
		const removed = changes(result[1]);
		if (removed < rows.length) await failed(db, branch, rows, budget, now, 'AUDIT_SINK_CONFLICT');
		return removed;
	} catch {
		// Bounded binary isolation avoids a poison row rolling back healthy neighbours in its page.
		if (rows.length > 1 && budget.remaining >= 4) {
			const middle = Math.floor(rows.length / 2);
			return (
				(await deliver(db, branch, rows.slice(0, middle), budget, now, isolation)) +
				(await deliver(db, branch, rows.slice(middle), budget, now, isolation))
			);
		}
		await failed(db, branch, rows, budget, now, 'AUDIT_DELIVERY_UNAVAILABLE');
		return 0;
	}
}
export async function drainAuditOutbox(
	db: D1Database,
	branch: BranchId,
	opts: {
		limit?: number;
		now?: number;
		budget?: AuditBudget;
		ids?: string[];
		dueOnly?: boolean;
	} = {}
): Promise<AuditDrainReport> {
	const limit = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? 100))),
		now = opts.now ?? Date.now(),
		stamp = new Date(now).toISOString();
	const budget = opts.budget ?? { remaining: 900, used: 0 };
	const report: AuditDrainReport = {
		selected: 0,
		delivered: 0,
		quarantined: 0,
		retained: 0,
		exhausted: false
	};
	let afterTime = '',
		afterId = '';
	while (report.selected < limit && budget.remaining >= 3) {
		let rows: OutboxRow[];
		try {
			budget.remaining--;
			budget.used++;
			const result = await db
				.prepare(
					`SELECT id,cabang_id,CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload,
			length(CAST(payload AS BLOB)) AS payload_bytes,attempt_count,created_at,updated_at FROM audit_log_outbox
			WHERE cabang_id=? AND (created_at>? OR (created_at=? AND id>?)) ${opts.ids ? 'AND id IN(SELECT value FROM json_each(?))' : ''}
			${opts.dueOnly ? 'AND (attempt_count=0 OR julianday(updated_at) IS NULL OR julianday(updated_at)<=julianday(?) - MIN(3600000,120000*attempt_count)/86400000.0)' : ''}
			ORDER BY created_at,id LIMIT ?`
				)
				.bind(
					AUDIT_MAX_PAYLOAD_BYTES,
					branch,
					afterTime,
					afterTime,
					afterId,
					...(opts.ids ? [JSON.stringify(opts.ids)] : []),
					...(opts.dueOnly ? [stamp] : []),
					Math.min(AUDIT_PAGE_ROWS, limit - report.selected)
				)
				.all<OutboxRow>();
			rows = result.results;
		} catch {
			report.exhausted = true;
			break; /* Schema/outage retains all durable source for the next supported tick. */
		}
		if (!rows.length) break;
		report.selected += rows.length;
		afterTime = rows.at(-1)!.created_at;
		afterId = rows.at(-1)!.id;
		const valid: Snapshot[] = [],
			poison: Snapshot[] = [],
			ageReview: Snapshot[] = [];
		for (const row of rows) {
			try {
				if (row.payload === null || !Number.isFinite(eventTime(row.created_at)))
					throw new Error('AUDIT_INVALID_SOURCE');
				const values = auditValues(parseAuditPayload(row.payload, branch));
				if (eventTime(row.created_at) < now - RETENTION_MS) ageReview.push(row);
				else valid.push({ ...row, values });
			} catch {
				poison.push(
					row
				); /* Permanent malformed/oversized envelope is preserved verbatim, not repaired. */
			}
		}
		for (const group of documents(poison))
			report.quarantined += await quarantine(
				db,
				branch,
				group,
				budget,
				stamp,
				'AUDIT_INVALID_SOURCE'
			);
		for (const group of documents(ageReview))
			report.quarantined += await quarantine(
				db,
				branch,
				group,
				budget,
				stamp,
				'AUDIT_RETENTION_REVIEW'
			);
		for (const group of documents(valid))
			report.delivered += await deliver(db, branch, group, budget, stamp);
		if (rows.length < AUDIT_PAGE_ROWS) break;
	}
	report.retained = report.selected - report.delivered - report.quarantined;
	report.exhausted ||= budget.remaining < 3;
	return report;
}
