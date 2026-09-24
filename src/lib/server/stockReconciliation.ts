import { createHash } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { auditDataChange, getRawDb, publish } from '$lib/server/dataApiHelpers';
import { loadStockPolicy, type StockPolicyActor } from '$lib/server/stockPolicy';
import { roundFourDecimals } from '$lib/utils/ingredientCost';

export type StockReconciliationStatus = 'draft' | 'ready' | 'applied' | 'cancelled';
export type StockReconciliationEntityType = 'produk' | 'bahan';

export type StockReconciliationItem = {
	job_id: string;
	cabang_id: string;
	entity_type: StockReconciliationEntityType;
	entity_id: string;
	counted_quantity: number | null;
};

export type StockReconciliationJob = {
	id: string;
	cabang_id: string;
	expected_policy_revision: number;
	status: StockReconciliationStatus;
	inventory_fingerprint: string;
	created_by: string;
	created_at: string;
	finalized_at: string | null;
	items: StockReconciliationItem[];
};

export type StockReconciliationCountInput = {
	entityType: StockReconciliationEntityType;
	entityId: string;
	countedQuantity: number;
};

type InventoryRow = {
	entityType: StockReconciliationEntityType;
	entityId: string;
	quantity: number;
	marker: string;
};

type ProductInventoryRow = {
	id: string;
	quantity: number;
	updated_at: string | null;
	lacak_stok: number | null;
	is_active: number | null;
};

type IngredientInventoryRow = {
	id: string;
	quantity: number;
	updated_at: string | null;
	is_active: number | null;
};

type JobRow = Omit<StockReconciliationJob, 'items'>;

const MAX_COUNT_CHUNK = 100;
const MARKER_SEPARATOR = '\u001f';

export class StockReconciliationError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409
	) {
		super(message);
	}
}

function requireOwner(actor: StockPolicyActor): void {
	if (actor.role !== 'pemilik') {
		throw new StockReconciliationError(
			'Hanya pemilik yang dapat menjalankan rekonsiliasi stok',
			409
		);
	}
}

function rowsFrom<T>(result: { results?: T[] }): T[] {
	return Array.isArray(result.results) ? result.results : [];
}

function sortInventory(left: InventoryRow, right: InventoryRow): number {
	if (left.entityType !== right.entityType) return left.entityType < right.entityType ? -1 : 1;
	if (left.entityId === right.entityId) return 0;
	return left.entityId < right.entityId ? -1 : 1;
}

export function computeInventoryFingerprint(rows: InventoryRow[]): string {
	const canonical = [...rows]
		.sort(sortInventory)
		.map((row) => [row.entityType, row.entityId, row.marker]);
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function loadInventorySnapshot(
	db: D1Database,
	branch: BranchContext
): Promise<InventoryRow[]> {
	// Snapshot policy: every tracked product (active or inactive), plus every active ingredient.
	// Ingredients used only for costing remain relevant inventory while active, even without a recipe.
	const [productResult, ingredientResult] = await Promise.all([
		db
			.prepare(
				`SELECT id, COALESCE(stok, 0) AS quantity, updated_at,
					COALESCE(lacak_stok, 0) AS lacak_stok, COALESCE(is_active, 1) AS is_active
				 FROM produk
				 WHERE cabang_id = ? AND lacak_stok = 1`
			)
			.bind(branch)
			.all<ProductInventoryRow>(),
		db
			.prepare(
				`SELECT id, stok_saat_ini AS quantity, updated_at,
					COALESCE(is_active, 1) AS is_active
				 FROM bahan
				 WHERE cabang_id = ? AND COALESCE(is_active, 1) = 1`
			)
			.bind(branch)
			.all<IngredientInventoryRow>()
	]);

	const products = rowsFrom(productResult).map((row): InventoryRow => {
		const quantity = Number(row.quantity);
		if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
			throw new StockReconciliationError('Saldo produk tidak valid untuk rekonsiliasi', 409);
		}
		return {
			entityType: 'produk',
			entityId: row.id,
			quantity,
			marker: `${row.updated_at ?? ''}${MARKER_SEPARATOR}${Number(row.lacak_stok ?? 0)}${MARKER_SEPARATOR}${Number(row.is_active ?? 1)}`
		};
	});
	const ingredients = rowsFrom(ingredientResult).map((row): InventoryRow => {
		const quantity = Number(row.quantity);
		if (!Number.isFinite(quantity) || quantity < 0) {
			throw new StockReconciliationError('Saldo bahan tidak valid untuk rekonsiliasi', 409);
		}
		return {
			entityType: 'bahan',
			entityId: row.id,
			quantity,
			marker: `${row.updated_at ?? ''}${MARKER_SEPARATOR}${Number(row.is_active ?? 1)}`
		};
	});
	return [...products, ...ingredients].sort(sortInventory);
}

async function loadJobRow(db: D1Database, branch: BranchContext, jobId: string): Promise<JobRow> {
	const row = await db
		.prepare(
			`SELECT id, cabang_id, expected_policy_revision, status, inventory_fingerprint,
				created_by, created_at, finalized_at
			 FROM stock_reconciliations
			 WHERE cabang_id = ? AND id = ?
			 LIMIT 1`
		)
		.bind(branch, jobId)
		.first<JobRow>();
	if (!row) throw new StockReconciliationError('Job rekonsiliasi tidak ditemukan', 404);
	return row;
}

async function loadItems(
	db: D1Database,
	branch: BranchContext,
	jobId: string
): Promise<StockReconciliationItem[]> {
	const result = await db
		.prepare(
			`SELECT job_id, cabang_id, entity_type, entity_id, counted_quantity
			 FROM stock_reconciliation_items
			 WHERE cabang_id = ? AND job_id = ?
			 ORDER BY entity_type, entity_id`
		)
		.bind(branch, jobId)
		.all<StockReconciliationItem>();
	return rowsFrom(result).map((row) => ({
		...row,
		counted_quantity: row.counted_quantity === null ? null : Number(row.counted_quantity)
	}));
}

export async function loadStockReconciliation(
	db: D1Database,
	branch: BranchContext,
	jobId: string
): Promise<StockReconciliationJob> {
	const [job, items] = await Promise.all([
		loadJobRow(db, branch, jobId),
		loadItems(db, branch, jobId)
	]);
	return { ...job, items };
}

function conflictFromDatabase(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	if (
		/STOCK_RECONCILIATION|RECONCILIATION_MUTATION|PRODUCT_STOCK_MISMATCH|UNIQUE constraint failed: stock_reconciliations\.cabang_id/.test(
			message
		)
	) {
		throw new StockReconciliationError(
			'Rekonsiliasi berubah atau inventaris tidak lagi cocok. Muat ulang lalu coba lagi.',
			409
		);
	}
	throw error;
}

export async function createStockReconciliation(
	db: D1Database,
	branch: BranchContext,
	actor: StockPolicyActor,
	now: string
): Promise<StockReconciliationJob> {
	requireOwner(actor);
	const policy = await loadStockPolicy(db, branch);
	if (policy.mode !== 'ignored' || policy.revision < 1) {
		throw new StockReconciliationError(
			'Rekonsiliasi hanya dapat dibuat saat monitoring stok nonaktif',
			409
		);
	}

	const inventory = await loadInventorySnapshot(db, branch);
	const jobId = crypto.randomUUID();
	const fingerprint = computeInventoryFingerprint(inventory);
	const initialStatus: StockReconciliationStatus = inventory.length === 0 ? 'ready' : 'draft';
	const snapshotJson = JSON.stringify(inventory);
	try {
		await db.batch([
			db
				.prepare(
					`INSERT INTO stock_reconciliations (
						id, cabang_id, expected_policy_revision, status, inventory_fingerprint,
						created_by, created_at, finalized_at
					 ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
				)
				.bind(jobId, branch, policy.revision, initialStatus, fingerprint, actor.userId, now),
			db
				.prepare(
					`INSERT INTO stock_reconciliation_items (
						job_id, cabang_id, entity_type, entity_id, inventory_marker, counted_quantity
					 )
					 SELECT ?, ?,
						json_extract(value, '$.entityType'),
						json_extract(value, '$.entityId'),
						json_extract(value, '$.marker'),
						NULL
					 FROM json_each(?)`
				)
				.bind(jobId, branch, snapshotJson),
			// No-op update invokes the database exact-set guard after all item rows exist.
			db
				.prepare(
					`UPDATE stock_reconciliations
					 SET inventory_fingerprint = inventory_fingerprint
					 WHERE cabang_id = ? AND id = ?`
				)
				.bind(branch, jobId)
		]);
	} catch (error) {
		conflictFromDatabase(error);
	}
	return loadStockReconciliation(db, branch, jobId);
}

function normalizeCount(input: StockReconciliationCountInput): number {
	if (
		(input.entityType !== 'produk' && input.entityType !== 'bahan') ||
		typeof input.entityId !== 'string' ||
		input.entityId.trim() === '' ||
		typeof input.countedQuantity !== 'number' ||
		!Number.isFinite(input.countedQuantity) ||
		input.countedQuantity < 0
	) {
		throw new StockReconciliationError('Jumlah hitung stok tidak valid', 400);
	}
	if (input.entityType === 'produk') {
		if (!Number.isInteger(input.countedQuantity)) {
			throw new StockReconciliationError('Jumlah produk harus bilangan bulat nonnegatif', 400);
		}
		return input.countedQuantity;
	}
	return roundFourDecimals(input.countedQuantity);
}

export async function updateStockReconciliationCounts(
	db: D1Database,
	branch: BranchContext,
	jobId: string,
	actor: StockPolicyActor,
	counts: StockReconciliationCountInput[]
): Promise<StockReconciliationJob> {
	requireOwner(actor);
	if (!Array.isArray(counts) || counts.length < 1 || counts.length > MAX_COUNT_CHUNK) {
		throw new StockReconciliationError(
			`Setiap chunk harus memuat 1 sampai ${MAX_COUNT_CHUNK} item`,
			400
		);
	}
	const job = await loadJobRow(db, branch, jobId);
	if (job.status !== 'draft' && job.status !== 'ready') {
		throw new StockReconciliationError('Job rekonsiliasi tidak dapat diubah lagi', 409);
	}

	const items = await loadItems(db, branch, jobId);
	const known = new Set(items.map((item) => `${item.entity_type}\u0000${item.entity_id}`));
	const seen = new Set<string>();
	const normalized = counts.map((input) => {
		const key = `${input.entityType}\u0000${input.entityId}`;
		if (seen.has(key)) {
			throw new StockReconciliationError('Item hitung stok tidak boleh duplikat', 400);
		}
		if (!known.has(key)) {
			throw new StockReconciliationError(
				'Item tidak termasuk snapshot rekonsiliasi cabang ini',
				400
			);
		}
		seen.add(key);
		return { ...input, countedQuantity: normalizeCount(input) };
	});
	const countsJson = JSON.stringify(normalized);

	try {
		await db.batch([
			db
				.prepare(
					`UPDATE stock_reconciliation_items
					 SET counted_quantity = (
						SELECT json_extract(value, '$.countedQuantity')
						FROM json_each(?)
						WHERE json_extract(value, '$.entityType') = stock_reconciliation_items.entity_type
							AND json_extract(value, '$.entityId') = stock_reconciliation_items.entity_id
					 )
					 WHERE cabang_id = ? AND job_id = ?
						AND EXISTS (
							SELECT 1 FROM json_each(?)
							WHERE json_extract(value, '$.entityType') = stock_reconciliation_items.entity_type
								AND json_extract(value, '$.entityId') = stock_reconciliation_items.entity_id
						)`
				)
				.bind(countsJson, branch, jobId, countsJson),
			db
				.prepare(
					`UPDATE stock_reconciliations
					 SET status = CASE
						WHEN NOT EXISTS (
							SELECT 1 FROM stock_reconciliation_items
							WHERE cabang_id = ? AND job_id = ? AND counted_quantity IS NULL
						) THEN 'ready' ELSE 'draft' END
					 WHERE cabang_id = ? AND id = ? AND status IN ('draft', 'ready')`
				)
				.bind(branch, jobId, branch, jobId)
		]);
	} catch (error) {
		conflictFromDatabase(error);
	}
	return loadStockReconciliation(db, branch, jobId);
}

function assertCurrentSnapshot(job: JobRow, current: InventoryRow[]): void {
	if (computeInventoryFingerprint(current) !== job.inventory_fingerprint) {
		throw new StockReconciliationError(
			'Daftar inventaris berubah sejak rekonsiliasi dibuat. Batalkan lalu buat job baru.',
			409
		);
	}
}

export async function finalizeStockReconciliation(
	db: D1Database,
	branch: BranchContext,
	jobId: string,
	expectedPolicyRevision: number,
	actor: StockPolicyActor,
	now: string
): Promise<StockReconciliationJob> {
	requireOwner(actor);
	const job = await loadJobRow(db, branch, jobId);
	if (job.status !== 'ready') {
		throw new StockReconciliationError('Semua item wajib dihitung sebelum finalisasi', 409);
	}
	if (expectedPolicyRevision !== job.expected_policy_revision) {
		throw new StockReconciliationError(
			'Revisi kebijakan stok berubah. Muat ulang lalu coba lagi.',
			409
		);
	}
	const policy = await loadStockPolicy(db, branch);
	if (policy.mode !== 'ignored' || policy.revision !== job.expected_policy_revision) {
		throw new StockReconciliationError(
			'Kebijakan stok berubah sejak rekonsiliasi dibuat. Muat ulang lalu coba lagi.',
			409
		);
	}

	const [items, current] = await Promise.all([
		loadItems(db, branch, jobId),
		loadInventorySnapshot(db, branch)
	]);
	if (items.some((item) => item.counted_quantity === null)) {
		throw new StockReconciliationError('Semua item wajib dihitung sebelum finalisasi', 409);
	}
	assertCurrentSnapshot(job, current);
	const currentByKey = new Map(
		current.map((item) => [`${item.entityType}\u0000${item.entityId}`, item] as const)
	);

	const mutationStatements: ReturnType<D1Database['prepare']>[] = [];
	for (const item of items) {
		const currentItem = currentByKey.get(`${item.entity_type}\u0000${item.entity_id}`);
		if (!currentItem || item.counted_quantity === null) {
			throw new StockReconciliationError('Snapshot inventaris tidak lagi lengkap', 409);
		}
		const target = item.counted_quantity;
		const delta = target - currentItem.quantity;
		if (delta === 0) continue;
		if (item.entity_type === 'produk') {
			mutationStatements.push(
				db
					.prepare(
						`INSERT INTO produk_mutasi (
							id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber,
							referensi_id, dibuat_oleh, created_at
						 ) VALUES (?, ?, ?, ?, ?, 'reconciliation', ?, ?, ?)`
					)
					.bind(
						crypto.randomUUID(),
						branch,
						item.entity_id,
						delta,
						target,
						jobId,
						actor.userId,
						now
					)
			);
		} else {
			mutationStatements.push(
				db
					.prepare(
						`INSERT INTO bahan_mutasi (
							id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber,
							referensi_id, catatan, dibuat_oleh, created_at
						 ) VALUES (?, ?, ?, ?, ?, 'reconciliation', ?, ?, ?, ?)`
					)
					.bind(
						crypto.randomUUID(),
						branch,
						item.entity_id,
						delta,
						target,
						jobId,
						`Rekonsiliasi stok ${jobId}`.slice(0, 160),
						actor.userId,
						now
					)
			);
		}
	}

	try {
		await db.batch([
			db
				.prepare(
					`UPDATE stock_reconciliations
					 SET status = 'applied', finalized_at = ?
					 WHERE cabang_id = ? AND id = ? AND status = 'ready'
						AND expected_policy_revision = ? AND inventory_fingerprint = ?`
				)
				.bind(now, branch, jobId, expectedPolicyRevision, job.inventory_fingerprint),
			...mutationStatements,
			db
				.prepare(
					`UPDATE stock_policy
					 SET mode = 'tracked', revision = revision + 1, disabled_at = NULL,
						reconciled_at = ?, updated_at = ?, updated_by = ?, updated_by_role = ?,
						reconciliation_job_id = ?
					 WHERE cabang_id = ? AND mode = 'ignored' AND revision = ?`
				)
				.bind(now, now, actor.userId, actor.role, jobId, branch, expectedPolicyRevision)
		]);
	} catch (error) {
		conflictFromDatabase(error);
	}
	return loadStockReconciliation(db, branch, jobId);
}

export async function cancelStockReconciliation(
	db: D1Database,
	branch: BranchContext,
	jobId: string,
	actor: StockPolicyActor
): Promise<StockReconciliationJob> {
	requireOwner(actor);
	const job = await loadJobRow(db, branch, jobId);
	if (job.status === 'applied') {
		throw new StockReconciliationError('Job yang sudah diterapkan tidak dapat dibatalkan', 409);
	}
	if (job.status === 'cancelled') return { ...job, items: await loadItems(db, branch, jobId) };
	try {
		await db
			.prepare(
				`UPDATE stock_reconciliations
				 SET status = 'cancelled'
				 WHERE cabang_id = ? AND id = ? AND status IN ('draft', 'ready')`
			)
			.bind(branch, jobId)
			.run();
	} catch (error) {
		conflictFromDatabase(error);
	}
	const result = await loadStockReconciliation(db, branch, jobId);
	if (result.status !== 'cancelled') {
		throw new StockReconciliationError('Job rekonsiliasi berubah saat dibatalkan', 409);
	}
	return result;
}

type Session = NonNullable<App.Locals['authSession']>;

function actorFromSession(session: Session): StockPolicyActor {
	return { userId: session.userId, role: session.role };
}

export async function createBranchStockReconciliation(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: Session,
	now: string
): Promise<StockReconciliationJob> {
	const db = getRawDb(platform, branch);
	const job = await createStockReconciliation(db, branch, actorFromSession(session), now);
	await auditDataChange(db, branch, session, 'stock_reconciliation', 'insert', job.id, {
		status: job.status,
		expected_policy_revision: job.expected_policy_revision,
		item_count: job.items.length
	});
	return job;
}

export async function updateBranchStockReconciliationCounts(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: Session,
	jobId: string,
	counts: StockReconciliationCountInput[]
): Promise<StockReconciliationJob> {
	const db = getRawDb(platform, branch);
	const job = await updateStockReconciliationCounts(
		db,
		branch,
		jobId,
		actorFromSession(session),
		counts
	);
	await auditDataChange(db, branch, session, 'stock_reconciliation', 'update_counts', job.id, {
		status: job.status,
		count: counts.length
	});
	return job;
}

export async function finalizeBranchStockReconciliation(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: Session,
	jobId: string,
	expectedPolicyRevision: number,
	now: string
): Promise<StockReconciliationJob> {
	const db = getRawDb(platform, branch);
	const job = await finalizeStockReconciliation(
		db,
		branch,
		jobId,
		expectedPolicyRevision,
		actorFromSession(session),
		now
	);
	await Promise.all([
		publish(platform, branch, 'stock_policy', 'update', { key: branch }),
		publish(platform, branch, 'produk', 'update', { id: job.id }),
		publish(platform, branch, 'bahan', 'update', { id: job.id }),
		auditDataChange(db, branch, session, 'stock_reconciliation', 'finalize', job.id, {
			status: job.status,
			expected_policy_revision: expectedPolicyRevision
		})
	]);
	return job;
}

export async function cancelBranchStockReconciliation(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: Session,
	jobId: string
): Promise<StockReconciliationJob> {
	const db = getRawDb(platform, branch);
	const job = await cancelStockReconciliation(db, branch, jobId, actorFromSession(session));
	await auditDataChange(db, branch, session, 'stock_reconciliation', 'cancel', job.id, {
		status: job.status
	});
	return job;
}
