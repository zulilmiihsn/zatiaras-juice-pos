import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { BranchId } from './branchResolver';
import { auditValues, parseAuditPayload } from './auditEnvelope';
// Relative import: the realtime Worker bundles this file without the $lib alias.
import { MS_PER_DAY } from '../constants/time';

export const AUDIT_PAGE_ROWS = 100;
export const AUDIT_MAX_PAYLOAD_BYTES = 65536;
const DOCUMENT_BYTES = 262144;
const RETENTION_MS = 90 * MS_PER_DAY;
// A sink row with the same id but different values never converges; stop retrying it after a few
// confirmations so it cannot spend the shared cron budget for 90 days. Transient outages keep retrying.
export const AUDIT_SINK_CONFLICT_ATTEMPTS = 3;

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
	last_error: string | null;
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

/** Reads one property of the snapshot document element `r` inside a `json_each(?) r` query. */
const snapshotField = (path: string) => `json_extract(r.value,'$.${path}')`;

/**
 * Joins an outbox row `o` to its snapshot `r` and matches only if the row is unchanged since the
 * snapshot was read. An oversized payload is NULL in the snapshot, so it matches by byte length.
 * Binds the branch as its single `?`.
 */
const SOURCE = [
	`o.id=${snapshotField('id')}`,
	'o.cabang_id=?',
	`o.created_at IS ${snapshotField('created_at')}`,
	`o.updated_at IS ${snapshotField('updated_at')}`,
	`o.attempt_count IS ${snapshotField('attempt_count')}`,
	`(o.payload IS ${snapshotField('payload')} OR (${snapshotField('payload')} IS NULL AND length(CAST(o.payload AS BLOB))>${AUDIT_MAX_PAYLOAD_BYTES}))`
].join(' AND ');

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
					`UPDATE audit_log_outbox AS o SET attempt_count=attempt_count+1,last_error=?,updated_at=?
					WHERE EXISTS(SELECT 1 FROM json_each(?) r WHERE ${SOURCE})`
				)
				.bind(reason, now, JSON.stringify(rows), branch)
		]);
	} catch {
		// Best-effort retry accounting never deletes the durable source or masks a sink outage.
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
					SELECT o.id,o.cabang_id,o.payload,?,o.attempt_count,o.created_at,?
					FROM json_each(?) r INNER JOIN audit_log_outbox o ON ${SOURCE}`
				)
				.bind(reason, now, doc, branch),
			db
				.prepare(
					`DELETE FROM audit_log_outbox AS o WHERE EXISTS(
						SELECT 1 FROM json_each(?) r
						INNER JOIN audit_log_quarantine q
							ON q.id=o.id AND q.cabang_id=o.cabang_id AND q.payload IS o.payload AND q.created_at IS o.created_at
						WHERE ${SOURCE})`
				)
				.bind(doc, branch)
		]);
		if (!result) return 0;

		const removed = changes(result[1]);
		if (removed < rows.length) {
			await failed(db, branch, rows, budget, now, 'AUDIT_QUARANTINE_CONFLICT');
		}
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
	const values = FIELDS.map((_field, i) => snapshotField(`values[${i}]`));
	const sameAsSnapshot = FIELDS.map((field, i) => `a.${field} IS ${values[i]}`).join(' AND ');
	try {
		const result = await execute(db, budget, [
			db
				.prepare(
					`INSERT OR IGNORE INTO audit_logs(id,cabang_id,${FIELDS.join(',')},created_at)
					SELECT o.id,o.cabang_id,${values.join(',')},o.created_at
					FROM json_each(?) r INNER JOIN audit_log_outbox o ON ${SOURCE}`
				)
				.bind(doc, branch),
			db
				.prepare(
					`DELETE FROM audit_log_outbox AS o WHERE EXISTS(
						SELECT 1 FROM json_each(?) r
						INNER JOIN audit_logs a
							ON a.id=o.id AND a.cabang_id=o.cabang_id AND a.created_at IS o.created_at AND ${sameAsSnapshot}
						WHERE ${SOURCE})`
				)
				.bind(doc, branch)
		]);
		if (!result) return 0;

		const removed = changes(result[1]);
		if (removed < rows.length) {
			await failed(db, branch, rows, budget, now, 'AUDIT_SINK_CONFLICT');
		}
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

interface DrainOptions {
	limit?: number;
	now?: number;
	budget?: AuditBudget;
	ids?: string[];
	dueOnly?: boolean;
}

/** One keyset page of outbox rows after the (created_at, id) cursor. Costs one budget unit. */
async function selectPage(
	db: D1Database,
	branch: BranchId,
	cursor: { time: string; id: string },
	pageSize: number,
	stamp: string,
	opts: DrainOptions
): Promise<OutboxRow[]> {
	const result = await db
		.prepare(
			`SELECT id,cabang_id,CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload ELSE NULL END AS payload,
				length(CAST(payload AS BLOB)) AS payload_bytes,attempt_count,last_error,created_at,updated_at
			FROM audit_log_outbox
			WHERE cabang_id=? AND (created_at>? OR (created_at=? AND id>?)) ${opts.ids ? 'AND id IN(SELECT value FROM json_each(?))' : ''}
			${opts.dueOnly ? 'AND (attempt_count=0 OR julianday(updated_at) IS NULL OR julianday(updated_at)<=julianday(?) - MIN(3600000,120000*attempt_count)/86400000.0)' : ''}
			ORDER BY created_at,id LIMIT ?`
		)
		.bind(
			AUDIT_MAX_PAYLOAD_BYTES,
			branch,
			cursor.time,
			cursor.time,
			cursor.id,
			...(opts.ids ? [JSON.stringify(opts.ids)] : []),
			...(opts.dueOnly ? [stamp] : []),
			pageSize
		)
		.all<OutboxRow>();
	return result.results;
}

/** Sorts a page by what must happen to each row: deliver, or quarantine for a stated reason. */
function classify(rows: OutboxRow[], branch: BranchId, now: number) {
	const valid: Snapshot[] = [];
	const poison: Snapshot[] = [];
	const ageReview: Snapshot[] = [];
	const sinkConflict: Snapshot[] = [];
	for (const row of rows) {
		try {
			if (row.payload === null || !Number.isFinite(eventTime(row.created_at))) {
				throw new Error('AUDIT_INVALID_SOURCE');
			}
			const values = auditValues(parseAuditPayload(row.payload, branch));
			if (eventTime(row.created_at) < now - RETENTION_MS) {
				ageReview.push(row);
			} else if (
				row.last_error === 'AUDIT_SINK_CONFLICT' &&
				row.attempt_count >= AUDIT_SINK_CONFLICT_ATTEMPTS
			) {
				sinkConflict.push(row);
			} else {
				valid.push({ ...row, values });
			}
		} catch {
			// Permanent malformed/oversized envelope is preserved verbatim, not repaired.
			poison.push(row);
		}
	}
	return { valid, poison, ageReview, sinkConflict };
}

export async function drainAuditOutbox(
	db: D1Database,
	branch: BranchId,
	opts: DrainOptions = {}
): Promise<AuditDrainReport> {
	const limit = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? 100)));
	const now = opts.now ?? Date.now();
	const stamp = new Date(now).toISOString();
	const budget = opts.budget ?? { remaining: 900, used: 0 };
	const report: AuditDrainReport = {
		selected: 0,
		delivered: 0,
		quarantined: 0,
		retained: 0,
		exhausted: false
	};
	const cursor = { time: '', id: '' };

	while (report.selected < limit && budget.remaining >= 3) {
		let rows: OutboxRow[];
		try {
			budget.remaining--;
			budget.used++;
			const pageSize = Math.min(AUDIT_PAGE_ROWS, limit - report.selected);
			rows = await selectPage(db, branch, cursor, pageSize, stamp, opts);
		} catch {
			// Schema/outage retains all durable source for the next supported tick.
			report.exhausted = true;
			break;
		}
		if (!rows.length) break;

		report.selected += rows.length;
		cursor.time = rows.at(-1)!.created_at;
		cursor.id = rows.at(-1)!.id;

		const { valid, poison, ageReview, sinkConflict } = classify(rows, branch, now);
		const quarantines: [Snapshot[], string][] = [
			[poison, 'AUDIT_INVALID_SOURCE'],
			[ageReview, 'AUDIT_RETENTION_REVIEW'],
			[sinkConflict, 'AUDIT_SINK_CONFLICT']
		];
		for (const [batch, reason] of quarantines) {
			for (const group of documents(batch)) {
				report.quarantined += await quarantine(db, branch, group, budget, stamp, reason);
			}
		}
		for (const group of documents(valid)) {
			report.delivered += await deliver(db, branch, group, budget, stamp);
		}
		if (rows.length < AUDIT_PAGE_ROWS) break;
	}

	report.retained = report.selected - report.delivered - report.quarantined;
	report.exhausted ||= budget.remaining < 3;
	return report;
}
