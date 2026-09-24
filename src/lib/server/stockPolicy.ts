import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { auditDataChange, getRawDb, publish } from '$lib/server/dataApiHelpers';

export type StockPolicyMode = 'tracked' | 'ignored';

export type StockPolicy = {
	mode: StockPolicyMode;
	revision: number;
	disabled_at: string | null;
	reconciled_at: string | null;
	updated_at: string | null;
};

type StockPolicyRow = StockPolicy & {
	cabang_id: string;
	updated_by: string;
	updated_by_role: string;
	reconciliation_job_id: string | null;
};

export type StockPolicyActor = {
	userId: string;
	role: string;
};

export type StockPolicyWrite = {
	expectedRevision: number;
	mode: StockPolicyMode;
	actor: StockPolicyActor;
	now: string;
};

export class StockPolicyConflictError extends Error {
	readonly status = 409;
}

const DEFAULT_POLICY: StockPolicy = {
	mode: 'tracked',
	revision: 0,
	disabled_at: null,
	reconciled_at: null,
	updated_at: null
};

export function stockPolicyRolloutAllows(
	platform: App.Platform | undefined,
	branch: string
): boolean {
	const configured = platform?.env.STOCK_POLICY_ROLLOUT_BRANCHES;
	if (!configured) return false;
	const branches = configured
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return branches.includes('*') || branches.includes(branch);
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

function isValidRow(row: StockPolicyRow | null, branch: BranchContext): row is StockPolicyRow {
	return Boolean(
		row &&
		row.cabang_id === branch &&
		(row.mode === 'tracked' || row.mode === 'ignored') &&
		Number.isInteger(row.revision) &&
		row.revision >= 1 &&
		nullableString(row.disabled_at) &&
		nullableString(row.reconciled_at) &&
		typeof row.updated_at === 'string' &&
		row.updated_at.length > 0 &&
		typeof row.updated_by === 'string' &&
		row.updated_by.length > 0 &&
		typeof row.updated_by_role === 'string' &&
		row.updated_by_role.length > 0 &&
		nullableString(row.reconciliation_job_id) &&
		(row.mode !== 'ignored' || row.disabled_at !== null) &&
		(row.reconciliation_job_id === null || row.reconciled_at !== null)
	);
}

async function loadRow(db: D1Database, branch: BranchContext): Promise<StockPolicyRow | null> {
	return db
		.prepare(
			`SELECT cabang_id, mode, revision, disabled_at, reconciled_at, updated_at,
				updated_by, updated_by_role, reconciliation_job_id
			 FROM stock_policy WHERE cabang_id = ? LIMIT 1`
		)
		.bind(branch)
		.first<StockPolicyRow>();
}

function publicPolicy(row: StockPolicyRow): StockPolicy {
	return {
		mode: row.mode,
		revision: row.revision,
		disabled_at: row.disabled_at,
		reconciled_at: row.reconciled_at,
		updated_at: row.updated_at
	};
}

export async function loadStockPolicy(db: D1Database, branch: BranchContext): Promise<StockPolicy> {
	const row = await loadRow(db, branch);
	if (!row) return { ...DEFAULT_POLICY };
	if (!isValidRow(row, branch)) {
		console.error('[stock-policy] Invalid policy row; using tracked@0 fallback', { branch });
		return { ...DEFAULT_POLICY };
	}
	return publicPolicy(row);
}

export async function writeStockPolicy(
	db: D1Database,
	branch: BranchContext,
	input: StockPolicyWrite
): Promise<{ policy: StockPolicy; changed: boolean }> {
	const row = await loadRow(db, branch);
	if (row && !isValidRow(row, branch)) {
		throw new StockPolicyConflictError(
			'Konfigurasi stok tidak valid. Hubungi operator sebelum mengubah pengaturan.'
		);
	}

	const current = row ? publicPolicy(row) : { ...DEFAULT_POLICY };
	if (input.expectedRevision !== current.revision) {
		throw new StockPolicyConflictError(
			'Pengaturan stok berubah di perangkat lain. Muat ulang lalu coba lagi.'
		);
	}
	if (input.mode === current.mode) return { policy: current, changed: false };
	if (current.mode === 'ignored' && input.mode === 'tracked') {
		throw new StockPolicyConflictError(
			'Aktivasi monitoring stok memerlukan rekonsiliasi fisik terlebih dahulu.'
		);
	}

	const next: StockPolicy = {
		mode: 'ignored',
		revision: current.revision + 1,
		disabled_at: input.now,
		reconciled_at: current.reconciled_at,
		updated_at: input.now
	};
	const result = row
		? await db
				.prepare(
					`UPDATE stock_policy
					 SET mode = ?, revision = ?, disabled_at = ?, updated_at = ?, updated_by = ?,
						 updated_by_role = ?, reconciliation_job_id = NULL
					 WHERE cabang_id = ? AND revision = ?`
				)
				.bind(
					next.mode,
					next.revision,
					next.disabled_at,
					next.updated_at,
					input.actor.userId,
					input.actor.role,
					branch,
					input.expectedRevision
				)
				.run()
		: await db
				.prepare(
					`INSERT INTO stock_policy (
						cabang_id, mode, revision, disabled_at, reconciled_at, updated_at,
						updated_by, updated_by_role, reconciliation_job_id
					 ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL)
					 ON CONFLICT(cabang_id) DO NOTHING`
				)
				.bind(
					branch,
					next.mode,
					next.revision,
					next.disabled_at,
					next.updated_at,
					input.actor.userId,
					input.actor.role
				)
				.run();

	// D1 may include AFTER-trigger history inserts in changes; zero alone means CAS miss.
	if (Number(result.meta.changes ?? 0) === 0) {
		throw new StockPolicyConflictError(
			'Pengaturan stok berubah di perangkat lain. Muat ulang lalu coba lagi.'
		);
	}
	return { policy: next, changed: true };
}

export function loadBranchStockPolicy(
	platform: App.Platform | undefined,
	branch: BranchContext
): Promise<StockPolicy> {
	return loadStockPolicy(getRawDb(platform, branch), branch);
}

export async function updateBranchStockPolicy(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: NonNullable<App.Locals['authSession']>,
	input: StockPolicyWrite
): Promise<{ policy: StockPolicy; changed: boolean }> {
	const db = getRawDb(platform, branch);
	const result = await writeStockPolicy(db, branch, input);
	if (result.changed) {
		await Promise.all([
			publish(platform, branch, 'stock_policy', 'update', { key: branch }),
			auditDataChange(db, branch, session, 'stock_policy', 'update', branch, {
				mode: result.policy.mode,
				revision: result.policy.revision
			})
		]);
	}
	return result;
}
