import { dispatchOrderNotifications } from './orderNotifications/delivery';
import { BRANCH_GROUPS, branchContext, getD1Database } from './branchResolver';
import { drainAuditOutbox } from './auditDrain';
import { cleanTechnicalRows, cleanLocalRegistryDevices } from './technicalRetention';
export { RealtimeDurableObject } from './realtimeDurableObject.js';
const DAILY_CRON = '0 3 * * *';
const MINUTE_CRON = '* * * * *';
const AUDIT_ROWS_PER_SHARD = 1000;
const AUDIT_MAINTENANCE_QUERY_BUDGET = 40;
/**
 * @template T
 * @param {readonly T[]} values
 * @param {number} tick
 */
function rotate(values, tick) {
	const offset = ((tick % values.length) + values.length) % values.length;
	return [...values.slice(offset), ...values.slice(0, offset)];
}
export default {
	/** @param {Request} request */
	async fetch(request) {
		if (new URL(request.url).pathname === '/health')
			return new Response(JSON.stringify({ ok: true, service: 'zatiaraspos-realtime' }), {
				headers: { 'Content-Type': 'application/json' }
			});
		return new Response('Not found', { status: 404 });
	},
	/**
	 * @param {{cron?:string,scheduledTime?:number}} event
	 * @param {Record<string,unknown>} env
	 */
	async scheduled(event, env) {
		const now = event.scheduledTime ?? Date.now();
		if (!Number.isFinite(now) || ![DAILY_CRON, MINUTE_CRON].includes(event.cron ?? '')) return;
		for (const branch of Object.values(BRANCH_GROUPS).flat()) {
			try {
				await dispatchOrderNotifications(env, branchContext(branch), { now });
			} catch {
				/* Durable relay state survives outages; no provider diagnostics or credentials are logged. */
			}
		}
		const configured = env.AUDIT_MAINTENANCE_QUERY_BUDGET;
		const proposed =
			typeof configured === 'number'
				? configured
				: typeof configured === 'string' && /^\d+$/.test(configured)
					? Number(configured)
					: NaN;
		const validBudget = Number.isSafeInteger(proposed) && proposed >= 1 && proposed <= 900;
		const totalBudget = validBudget ? proposed : AUDIT_MAINTENANCE_QUERY_BUDGET;
		// Daily cleanup reserves its bounded 32 statements even when an audit shard remains unavailable.
		const reserved = event.cron === DAILY_CRON ? Math.min(32, totalBudget) : 0;
		const budget = { remaining: totalBudget - reserved, used: 0 };
		const retentionBudget = { remaining: reserved, used: 0 };
		const turn = Math.floor(now / (event.cron === DAILY_CRON ? 86400000 : 60000));
		const report = {
			selected: 0,
			delivered: 0,
			quarantined: 0,
			retained: 0,
			deleted: 0,
			queries: 0,
			queryBudget: totalBudget,
			invalidBudgetSetting: configured !== undefined && !validBudget,
			exhausted: false,
			missingBindings: 0,
			foreignRegistryTombstonesHeld: true
		};
		// Rotating both shard and sibling order prevents a bounded poisoned head from owning every tick.
		for (const [binding, group] of rotate(Object.entries(BRANCH_GROUPS), turn)) {
			const branches = rotate(group, turn);
			let db;
			try {
				db = getD1Database(env, branches[0]);
			} catch {
				report.missingBindings++;
				continue; /* Report missing shards; never silently certify complete maintenance. */
			}
			for (const branch of branches) {
				const result = await drainAuditOutbox(db, branch, {
					now,
					limit: Math.floor(AUDIT_ROWS_PER_SHARD / branches.length),
					budget,
					dueOnly: true
				});
				report.selected += result.selected;
				report.delivered += result.delivered;
				report.quarantined += result.quarantined;
				report.retained += result.retained;
				report.exhausted ||= result.exhausted;
			}
			// Audits older than the retention window are quarantined for review, not delivered then erased.
			if (event.cron === DAILY_CRON)
				for (const branch of branches) {
					report.deleted += await cleanTechnicalRows(
						db,
						branchContext(branch),
						now,
						retentionBudget
					);
					if (binding === 'DB_SAMARINDA_GROUP')
						report.deleted += await cleanLocalRegistryDevices(
							db,
							branchContext(branch),
							now,
							retentionBudget
						);
				}
		}
		report.queries = budget.used + retentionBudget.used;
		report.exhausted ||= budget.remaining + retentionBudget.remaining <= 0;
		console.log('[audit-maintenance]', JSON.stringify(report));
		return report;
	}
};
