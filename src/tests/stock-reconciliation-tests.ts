import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { branchContext } from '../lib/server/branchResolver';
import { loadStockPolicy, writeStockPolicy } from '../lib/server/stockPolicy';
import {
	cancelStockReconciliation,
	createStockReconciliation,
	finalizeStockReconciliation,
	loadStockReconciliation,
	StockReconciliationError,
	updateStockReconciliationCounts
} from '../lib/server/stockReconciliation';
import { isCsrfProtectedRequest } from '../lib/server/csrfPolicy';
import { POST as CREATE } from '../routes/api/pengaturan/stok/reconciliation/+server';
import { DELETE as CANCEL } from '../routes/api/pengaturan/stok/reconciliation/[id]/+server';
import { PUT as UPDATE_ITEMS } from '../routes/api/pengaturan/stok/reconciliation/[id]/items/+server';
import { POST as FINALIZE } from '../routes/api/pengaturan/stok/reconciliation/[id]/finalize/+server';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const samarinda2 = branchContext('samarinda2');
const owner = { userId: 'owner-reconciliation', role: 'pemilik' };

async function expectReconciliationStatus(run: () => unknown, status: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: unknown) => error instanceof StockReconciliationError && error.status === status
	);
}

async function expectHttpStatus(run: () => unknown, status: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === status
	);
}

function session(role: string, branch = 'samarinda') {
	return {
		id: `session-${role}-${branch}`,
		userId: `${role}-1`,
		username: role,
		role,
		branch,
		createdAt: 0,
		expiresAt: Date.now() + 60_000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}

function routeEvent(
	method: 'POST' | 'PUT' | 'DELETE',
	role: string,
	body: unknown,
	options: { branch?: string; id?: string; rollout?: string } = {}
) {
	const branch = options.branch ?? 'samarinda';
	return {
		request: new Request('https://test.invalid/api/pengaturan/stok/reconciliation', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params: { id: options.id ?? '' },
		locals: { authSession: session(role, branch) },
		platform: {
			env: {
				DB_SAMARINDA_GROUP: db
			}
		}
	};
}

function countInputs(
	items: Array<{ entity_type: 'produk' | 'bahan'; entity_id: string }>,
	targets: Record<string, number>
) {
	return items.map((item) => ({
		entityType: item.entity_type,
		entityId: item.entity_id,
		countedQuantity: targets[`${item.entity_type}:${item.entity_id}`]
	}));
}

try {
	await db
		.prepare(
			`INSERT INTO stock_feature_rollout (feature, branches, updated_at)
			 VALUES ('stock_monitoring', 'samarinda,samarinda2', '2026-09-24T00:00:00.000Z')
			 ON CONFLICT(feature) DO UPDATE SET branches = excluded.branches`
		)
		.run();
	await db.batch([
		db.prepare(
			`INSERT INTO produk (
				id, cabang_id, nama, harga, stok, lacak_stok, is_active, updated_at
			 ) VALUES
				('p-tracked', 'samarinda', 'Tracked', 1000, 5, 1, 1, '2026-09-24T00:00:00.000Z'),
				('p-inactive', 'samarinda', 'Inactive tracked', 1000, 2, 1, 0, '2026-09-24T00:00:01.000Z'),
				('p-untracked', 'samarinda', 'Untracked', 1000, 9, 0, 1, '2026-09-24T00:00:02.000Z'),
				('p-route', 'samarinda2', 'Route product', 1000, 1, 1, 1, '2026-09-24T00:00:03.000Z')`
		),
		db.prepare(
			`INSERT INTO bahan (
				id, cabang_id, nama, satuan, stok_saat_ini, is_active, updated_at
			 ) VALUES
				('b-active', 'samarinda', 'Active', 'gram', 10.1234, 1, '2026-09-24T00:01:00.000Z'),
				('b-zero-delta', 'samarinda', 'Zero delta', 'ml', 4.5, 1, '2026-09-24T00:01:01.000Z'),
				('b-inactive', 'samarinda', 'Inactive', 'gram', 8, 0, '2026-09-24T00:01:02.000Z')`
		)
	]);

	await expectReconciliationStatus(
		() => createStockReconciliation(db, samarinda, owner, '2026-09-24T01:00:00.000Z'),
		409
	);
	await writeStockPolicy(db, samarinda, {
		expectedRevision: 0,
		mode: 'ignored',
		actor: owner,
		now: '2026-09-24T01:01:00.000Z'
	});
	await writeStockPolicy(db, samarinda2, {
		expectedRevision: 0,
		mode: 'ignored',
		actor: owner,
		now: '2026-09-24T01:02:00.000Z'
	});

	const firstJob = await createStockReconciliation(
		db,
		samarinda,
		owner,
		'2026-09-24T02:00:00.000Z'
	);
	assert.equal(firstJob.status, 'draft');
	assert.deepEqual(
		firstJob.items.map((item) => `${item.entity_type}:${item.entity_id}`),
		['bahan:b-active', 'bahan:b-zero-delta', 'produk:p-inactive', 'produk:p-tracked'],
		'snapshot includes all tracked products and all active ingredients only'
	);
	assert.ok(firstJob.inventory_fingerprint.match(/^[a-f0-9]{64}$/));
	await expectReconciliationStatus(
		() => createStockReconciliation(db, samarinda, owner, '2026-09-24T02:01:00.000Z'),
		409
	);
	await expectReconciliationStatus(() => loadStockReconciliation(db, samarinda2, firstJob.id), 404);

	for (const invalid of [
		[{ entityType: 'produk' as const, entityId: 'p-tracked', countedQuantity: 1.5 }],
		[{ entityType: 'bahan' as const, entityId: 'b-active', countedQuantity: -1 }],
		[
			{
				entityType: 'bahan' as const,
				entityId: 'b-active',
				countedQuantity: Number.POSITIVE_INFINITY
			}
		],
		[{ entityType: 'produk' as const, entityId: 'missing', countedQuantity: 1 }],
		[
			{ entityType: 'produk' as const, entityId: 'p-tracked', countedQuantity: 1 },
			{ entityType: 'produk' as const, entityId: 'p-tracked', countedQuantity: 2 }
		]
	]) {
		await expectReconciliationStatus(
			() => updateStockReconciliationCounts(db, samarinda, firstJob.id, owner, invalid),
			400
		);
	}

	await updateStockReconciliationCounts(db, samarinda, firstJob.id, owner, [
		{ entityType: 'produk', entityId: 'p-tracked', countedQuantity: 7 }
	]);
	await expectReconciliationStatus(
		() =>
			finalizeStockReconciliation(db, samarinda, firstJob.id, 1, owner, '2026-09-24T03:00:00.000Z'),
		409
	);
	assert.equal((await loadStockPolicy(db, samarinda)).mode, 'ignored');
	assert.equal(
		await db.prepare("SELECT stok FROM produk WHERE id = 'p-tracked'").first<number>('stok'),
		5
	);

	const readyFirst = await updateStockReconciliationCounts(
		db,
		samarinda,
		firstJob.id,
		owner,
		countInputs(
			firstJob.items.filter((item) => item.entity_id !== 'p-tracked'),
			{
				'bahan:b-active': 8.125,
				'bahan:b-zero-delta': 4.5,
				'produk:p-inactive': 2
			}
		)
	);
	assert.equal(readyFirst.status, 'ready');
	assert.equal(
		readyFirst.items.find((item) => item.entity_id === 'b-active')?.counted_quantity,
		8.125,
		'bahan count is normalized to four decimals'
	);

	let raced = false;
	const raceDb = {
		prepare: db.prepare.bind(db),
		async batch(statements: Parameters<D1Database['batch']>[0]) {
			if (!raced) {
				raced = true;
				await db
					.prepare(
						"UPDATE produk SET updated_at = '2026-09-24T03:01:00.000Z' WHERE cabang_id = 'samarinda' AND id = 'p-tracked'"
					)
					.run();
			}
			return db.batch(statements);
		}
	} as D1Database;
	await expectReconciliationStatus(
		() =>
			finalizeStockReconciliation(
				raceDb,
				samarinda,
				firstJob.id,
				1,
				owner,
				'2026-09-24T03:02:00.000Z'
			),
		409
	);
	assert.equal((await loadStockReconciliation(db, samarinda, firstJob.id)).status, 'ready');
	assert.equal((await loadStockPolicy(db, samarinda)).mode, 'ignored');
	assert.equal(
		await db
			.prepare('SELECT COUNT(*) AS n FROM produk_mutasi WHERE cabang_id = ? AND referensi_id = ?')
			.bind(samarinda, firstJob.id)
			.first<number>('n'),
		0,
		'fingerprint race rolls back every finalization statement'
	);

	const cancelled = await cancelStockReconciliation(db, samarinda, firstJob.id, owner);
	assert.equal(cancelled.status, 'cancelled');
	assert.equal(
		(await cancelStockReconciliation(db, samarinda, firstJob.id, owner)).status,
		'cancelled'
	);

	const staleJob = await createStockReconciliation(
		db,
		samarinda,
		owner,
		'2026-09-24T04:00:00.000Z'
	);
	await updateStockReconciliationCounts(
		db,
		samarinda,
		staleJob.id,
		owner,
		countInputs(staleJob.items, {
			'bahan:b-active': 8.125,
			'bahan:b-zero-delta': 4.5,
			'produk:p-inactive': 2,
			'produk:p-tracked': 7
		})
	);
	await expectReconciliationStatus(
		() =>
			finalizeStockReconciliation(db, samarinda, staleJob.id, 2, owner, '2026-09-24T04:02:00.000Z'),
		409
	);
	await cancelStockReconciliation(db, samarinda, staleJob.id, owner);

	const validJob = await createStockReconciliation(
		db,
		samarinda,
		owner,
		'2026-09-24T05:00:00.000Z'
	);
	await updateStockReconciliationCounts(
		db,
		samarinda,
		validJob.id,
		owner,
		countInputs(validJob.items, {
			'bahan:b-active': 8.125,
			'bahan:b-zero-delta': 4.5,
			'produk:p-inactive': 2,
			'produk:p-tracked': 7
		})
	);
	const applied = await finalizeStockReconciliation(
		db,
		samarinda,
		validJob.id,
		1,
		owner,
		'2026-09-24T05:01:00.000Z'
	);
	assert.equal(applied.status, 'applied');
	assert.equal(applied.finalized_at, '2026-09-24T05:01:00.000Z');
	assert.equal(
		await db.prepare("SELECT stok FROM produk WHERE id = 'p-tracked'").first<number>('stok'),
		7
	);
	assert.equal(
		await db
			.prepare("SELECT stok_saat_ini FROM bahan WHERE id = 'b-active'")
			.first<number>('stok_saat_ini'),
		8.125
	);
	const appliedPolicy = await loadStockPolicy(db, samarinda);
	assert.equal(appliedPolicy.mode, 'tracked');
	assert.equal(appliedPolicy.revision, 2);
	assert.equal(appliedPolicy.reconciled_at, '2026-09-24T05:01:00.000Z');
	const appliedTransition = await db
		.prepare(
			`SELECT actor_user_id, actor_role, reconciliation_job_id
			 FROM stock_policy_transitions WHERE cabang_id = ? AND revision = 2`
		)
		.bind(samarinda)
		.first<{ actor_user_id: string; actor_role: string; reconciliation_job_id: string }>();
	assert.deepEqual(
		{ ...appliedTransition },
		{
			actor_user_id: owner.userId,
			actor_role: owner.role,
			reconciliation_job_id: validJob.id
		}
	);
	assert.equal(
		await db
			.prepare(
				"SELECT COUNT(*) AS n FROM produk_mutasi WHERE cabang_id = ? AND referensi_id = ? AND sumber = 'reconciliation'"
			)
			.bind(samarinda, validJob.id)
			.first<number>('n'),
		1
	);
	assert.equal(
		await db
			.prepare(
				"SELECT COUNT(*) AS n FROM bahan_mutasi WHERE cabang_id = ? AND referensi_id = ? AND sumber = 'reconciliation'"
			)
			.bind(samarinda, validJob.id)
			.first<number>('n'),
		1
	);
	assert.equal(
		await db
			.prepare(
				`SELECT COUNT(*) AS n FROM produk_mutasi
				 WHERE cabang_id = ? AND referensi_id = ? AND produk_id = 'p-inactive'`
			)
			.bind(samarinda, validJob.id)
			.first<number>('n'),
		0
	);
	assert.equal(
		await db
			.prepare(
				`SELECT COUNT(*) AS n FROM bahan_mutasi
				 WHERE cabang_id = ? AND referensi_id = ? AND bahan_id = 'b-zero-delta'`
			)
			.bind(samarinda, validJob.id)
			.first<number>('n'),
		0
	);
	await expectReconciliationStatus(
		() => cancelStockReconciliation(db, samarinda, validJob.id, owner),
		409
	);

	for (const [path, method] of [
		['/api/pengaturan/stok/reconciliation', 'POST'],
		['/api/pengaturan/stok/reconciliation/job/items', 'PUT'],
		['/api/pengaturan/stok/reconciliation/job/finalize', 'POST'],
		['/api/pengaturan/stok/reconciliation/job', 'DELETE']
	] as const) {
		assert.equal(isCsrfProtectedRequest(path, method), true);
	}

	await expectHttpStatus(
		() =>
			CREATE(
				routeEvent('POST', 'admin', { branch: 'samarinda2' }, { branch: 'samarinda2' }) as never
			),
		403
	);
	await expectHttpStatus(
		() =>
			CREATE(
				routeEvent('POST', 'kasir', { branch: 'samarinda2' }, { branch: 'samarinda2' }) as never
			),
		403
	);
	await expectHttpStatus(
		() => CREATE(routeEvent('POST', 'pemilik', { branch: 'samarinda2' }) as never),
		403
	);
	await db
		.prepare(
			"UPDATE stock_feature_rollout SET branches = 'samarinda' WHERE feature = 'stock_monitoring'"
		)
		.run();
	await expectHttpStatus(
		() => CREATE(routeEvent('POST', 'pemilik', { branch: 'samarinda2' }) as never),
		403
	);
	await db
		.prepare(
			"UPDATE stock_feature_rollout SET branches = 'samarinda,samarinda2' WHERE feature = 'stock_monitoring'"
		)
		.run();

	const createResponse = await CREATE(
		routeEvent('POST', 'pemilik', { branch: 'samarinda2' }, { branch: 'samarinda2' }) as never
	);
	const routeJob = (await createResponse.json()) as { data: { id: string; status: string } };
	assert.equal(routeJob.data.status, 'draft');
	await expectHttpStatus(
		() =>
			UPDATE_ITEMS(
				routeEvent(
					'PUT',
					'pemilik',
					{
						branch: 'samarinda2',
						job_id: routeJob.data.id,
						items: [{ entity_type: 'produk', entity_id: 'p-route', counted_quantity: 3 }]
					},
					{ branch: 'samarinda2', id: routeJob.data.id }
				) as never
			),
		400
	);
	const itemsResponse = await UPDATE_ITEMS(
		routeEvent(
			'PUT',
			'pemilik',
			{
				branch: 'samarinda2',
				items: [{ entity_type: 'produk', entity_id: 'p-route', counted_quantity: 3 }]
			},
			{ branch: 'samarinda2', id: routeJob.data.id }
		) as never
	);
	assert.equal(itemsResponse.status, 200);
	await expectHttpStatus(
		() =>
			FINALIZE(
				routeEvent(
					'POST',
					'admin',
					{ branch: 'samarinda2', expected_policy_revision: 1 },
					{ branch: 'samarinda2', id: routeJob.data.id }
				) as never
			),
		403
	);
	const finalizeResponse = await FINALIZE(
		routeEvent(
			'POST',
			'pemilik',
			{ branch: 'samarinda2', expected_policy_revision: 1 },
			{ branch: 'samarinda2', id: routeJob.data.id }
		) as never
	);
	assert.equal(finalizeResponse.status, 200);
	assert.equal(
		await db.prepare("SELECT stok FROM produk WHERE id = 'p-route'").first<number>('stok'),
		3
	);

	await writeStockPolicy(db, samarinda2, {
		expectedRevision: 2,
		mode: 'ignored',
		actor: owner,
		now: '2026-09-24T06:00:00.000Z'
	});
	const cancelCreateResponse = await CREATE(
		routeEvent('POST', 'pemilik', { branch: 'samarinda2' }, { branch: 'samarinda2' }) as never
	);
	const cancelJob = (await cancelCreateResponse.json()) as { data: { id: string } };
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await CANCEL(
			routeEvent(
				'DELETE',
				'pemilik',
				{ branch: 'samarinda2' },
				{ branch: 'samarinda2', id: cancelJob.data.id }
			) as never
		);
		assert.equal(response.status, 200);
		assert.equal(
			((await response.json()) as { data: { status: string } }).data.status,
			'cancelled'
		);
	}

	console.log(
		'stock-reconciliation-tests: snapshot, validation, atomic guards, ledgers, policy, routes passed'
	);
} finally {
	await close();
}
