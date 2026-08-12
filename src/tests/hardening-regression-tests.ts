import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import {
	isAllowedProductImageMime,
	isPublicProductImageKey,
	productImageExtension
} from '$lib/server/r2ObjectPolicy';
import { containsPosLedger } from '$lib/server/ledgerPolicy';
import { isProtectedPage, parsePageList } from '$lib/server/pageAccess';
import { constantTimeEqual } from '$lib/server/secureCompare';
import { buildDailySummaryReversalStatements } from '$lib/server/dailySummary';
import { buildLaporanAggregate } from '$lib/server/reportQueries';
import { computeItemFinancials } from '$lib/server/checkout/financials';
import { buildCheckoutStatements } from '$lib/server/checkout/statementBuilder';
import { CHECKOUT_MAX_LINE_ITEMS, checkoutItemCountError } from '$lib/server/checkout/utils';
import type { AddOnRow, ComputedTransactionItem, ProductRow } from '$lib/server/checkout/types';
import { chunkReportIds, D1_REPORT_ID_CHUNK_SIZE } from '../routes/api/aichat/reportData';
import { hashPin, validateNewPin, verifyPinHash } from '$lib/server/pinHash';
import { buildMonitoringSourceStatus } from '$lib/server/monitoringStatus';
import { getBestSellersSummary, getWeeklyIncomeSummary } from '$lib/server/dashboardQueries';
import type { DrizzleDb } from '$lib/server/branchResolver';
import { parseDataLimit } from '$lib/server/dataPagination';

assert.equal(isPublicProductImageKey('produk/123e4567-e89b-12d3-a456-426614174000.webp'), true);
assert.equal(isPublicProductImageKey('arsip/samarinda/arsip.json'), false);
assert.equal(isPublicProductImageKey('produk/../arsip.json'), false);
assert.equal(isPublicProductImageKey('produk/not-a-uuid.exe'), false);
assert.equal(isAllowedProductImageMime('image/jpeg'), true);
assert.equal(isAllowedProductImageMime('image/svg+xml'), false);
assert.equal(productImageExtension('image/jpeg'), 'jpg');

assert.equal(containsPosLedger([{ sumber: 'catat' }, { sumber: 'POS' }]), true);
assert.equal(containsPosLedger([{ sumber: 'catat' }]), false);
assert.deepEqual(parsePageList('["laporan","catat",7]'), ['laporan', 'catat']);
assert.deepEqual(parsePageList(['beranda', null]), ['beranda']);
assert.throws(() => parsePageList('{bad-json'));
assert.equal(isProtectedPage('laporan'), true);
assert.equal(isProtectedPage('admin'), false);
assert.equal(constantTimeEqual('1234', '1234'), true);
assert.equal(constantTimeEqual('1234', '1235'), false);
assert.equal(constantTimeEqual('1234', '12345'), false);
assert.equal(checkoutItemCountError(Array(CHECKOUT_MAX_LINE_ITEMS).fill({})), null);
assert.match(
	checkoutItemCountError(Array(CHECKOUT_MAX_LINE_ITEMS + 1).fill({})) || '',
	/Maksimal 100/
);
assert.equal(parseDataLimit(null), 200);
assert.equal(parseDataLimit('25'), 25);
assert.equal(parseDataLimit(null, 50), 50);
assert.throws(
	() => parseDataLimit('0'),
	(error: unknown) => {
		const candidate = error as { status?: unknown; body?: { message?: unknown } };
		return (
			candidate.status === 400 &&
			typeof candidate.body?.message === 'string' &&
			/antara 1 dan 500/.test(candidate.body.message)
		);
	}
);
assert.throws(() => parseDataLimit('-1'), /bilangan bulat/);
assert.throws(() => parseDataLimit('501'), /antara 1 dan 500/);

const aiChatSource = readFileSync(
	new URL('../routes/api/aichat/+server.ts', import.meta.url),
	'utf8'
);
assert.match(aiChatSource, /text\.length > 2000/);
assert.match(aiChatSource, /OPENROUTER_TIMEOUT_MS = 15_000/);
assert.match(aiChatSource, /signal: controller\.signal/);
assert.match(aiChatSource, /parseDataRequirements\(parsed, todayWita\)/);

const hppCrudSource = readFileSync(
	new URL('../lib/services/manajemenmenuCrud.ts', import.meta.url),
	'utf8'
);
assert.doesNotMatch(hppCrudSource, /hpp_purchases/);
assert.match(hppCrudSource, /insertRows\('bahan'/);
assert.match(hppCrudSource, /insertRows\('bahan_mutasi'/);

const credentialRouteSource = readFileSync(
	new URL('../routes/api/gantikeamanan/+server.ts', import.meta.url),
	'utf8'
);
assert.match(credentialRouteSource, /rawDb\.batch/);
assert.match(
	credentialRouteSource,
	/DELETE FROM auth_sessions WHERE cabang_id = \? AND user_id = \?/
);

const rotationSource = readFileSync(
	new URL('../../scripts/rotate-production-credentials.mjs', import.meta.url),
	'utf8'
);
assert.match(rotationSource, /Rotasi production memerlukan --live/);
assert.match(rotationSource, /canonicalizeExternalPath/);
assert.match(rotationSource, /parseAndVerifyInfo/);
assert.match(rotationSource, /ConvertFrom-SecureString/);
assert.match(rotationSource, /DELETE FROM auth_sessions/);

const reportChunks = chunkReportIds(
	Array.from({ length: D1_REPORT_ID_CHUNK_SIZE * 2 + 7 }, (_, index) => `kas-${index}`)
);
assert.deepEqual(
	reportChunks.map((chunk) => chunk.length),
	[99, 99, 7]
);
assert.throws(() => chunkReportIds(['kas-1'], 100), /Ukuran chunk/);

assert.equal(validateNewPin('1234'), 'Gunakan PIN yang tidak mudah ditebak');
assert.equal(validateNewPin('5827'), null);
const encodedPin = await hashPin('5827');
assert.notEqual(encodedPin, '5827');
assert.equal(await verifyPinHash('5827', encodedPin), true);
assert.equal(await verifyPinHash('5828', encodedPin), false);
assert.equal(await verifyPinHash('5827', 'invalid'), false);

const monitoringStatus = buildMonitoringSourceStatus([
	{ status: 'fulfilled', value: {} },
	{ status: 'rejected', reason: new Error('missing') },
	{ status: 'fulfilled', value: {} },
	{ status: 'fulfilled', value: {} }
]);
assert.equal(monitoringStatus.requestMetrics.available, true);
assert.equal(monitoringStatus.errorEvents.available, false);

const pageAccessMatrix = [
	['../routes/api/dashboard/stats/+server.ts', 'beranda'],
	['../routes/api/dashboard/best-sellers/+server.ts', 'beranda'],
	['../routes/api/dashboard/weekly/+server.ts', 'beranda'],
	['../routes/api/dashboard/pos-kas-7hari/+server.ts', 'beranda'],
	['../routes/api/buku-kas/+server.ts', 'catat'],
	['../routes/api/reports/aggregate/+server.ts', 'laporan'],
	['../routes/api/aichat/+server.ts', 'laporan']
] as const;
for (const [relativePath, page] of pageAccessMatrix) {
	const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
	assert.match(source, /requirePageAccess/);
	assert.match(source, new RegExp(`['"]${page}['"]`));
}

type FakeStatement = {
	sql: string;
	values: unknown[];
	bind: (...values: unknown[]) => FakeStatement;
	first: () => Promise<unknown>;
	all: () => Promise<{ results: unknown[] }>;
};

function reversalDb(options?: { found?: boolean }) {
	let batchCalls = 0;
	const db = {
		prepare(sql: string): FakeStatement {
			const statement: FakeStatement = {
				sql,
				values: [],
				bind(...values) {
					statement.values = values;
					return statement;
				},
				async first() {
					if (options?.found === false) return null;
					return {
						tanggal_penjualan: '2026-07-03',
						metode_bayar: 'tunai',
						item_qty: 2,
						gross: 30_000,
						hpp: 12_000
					};
				},
				async all() {
					return {
						results: [{ produk_id: 'produk-1', jumlah: 2, gross: 30_000 }]
					};
				}
			};
			return statement;
		},
		async batch() {
			batchCalls += 1;
			return [];
		}
	};
	return {
		db: db as unknown as D1Database,
		batchCalls: () => batchCalls
	};
}

const reversal = reversalDb();
const built = await buildDailySummaryReversalStatements(reversal.db, 'samarinda', 'transaction-1');
assert.equal(built.found, true);
assert.equal(built.statements.length, 2);
assert.equal(reversal.batchCalls(), 0, 'builder tidak boleh commit batch sendiri');

const missingReversal = await buildDailySummaryReversalStatements(
	reversalDb({ found: false }).db,
	'samarinda',
	'missing'
);
assert.deepEqual(missingReversal, { found: false, statements: [] });

const failingReportDb = {
	prepare() {
		return {
			bind() {
				return this;
			},
			async first() {
				throw new Error('D1 unavailable');
			}
		};
	}
} as unknown as D1Database;
await assert.rejects(
	() => buildLaporanAggregate(failingReportDb, 'samarinda', '2026-07-01', '2026-07-03'),
	/D1 unavailable/
);

const failingDashboardDb = {
	select() {
		return {
			from() {
				return {
					where() {
						return {
							orderBy() {
								return Promise.reject(new Error('dashboard unavailable'));
							}
						};
					}
				};
			}
		};
	}
} as unknown as DrizzleDb;
await assert.rejects(
	() =>
		getWeeklyIncomeSummary(
			failingDashboardDb,
			'samarinda',
			'2026-07-01T00:00:00.000Z',
			'2026-07-03T00:00:00.000Z'
		),
	/dashboard unavailable/
);

const failingBestSellerDb = {
	prepare() {
		return {
			bind() {
				return this;
			},
			async all() {
				throw new Error('best seller unavailable');
			}
		};
	}
} as unknown as D1Database;
await assert.rejects(
	() =>
		getBestSellersSummary(
			failingBestSellerDb,
			'samarinda',
			'2026-07-01T00:00:00.000Z',
			'2026-07-03T00:00:00.000Z'
		),
	/best seller unavailable/
);

const product: ProductRow = {
	id: 'produk-1',
	nama: 'Jus Mangga',
	harga: 10_000,
	stok: 12,
	lacak_stok: true,
	lacak_bahan: false,
	is_active: true
};
const addOn: AddOnRow = {
	id: 'tambahan-1',
	nama: 'Jelly',
	harga: 2_000,
	is_active: true
};
const stockDeductions = new Map<string, { nama: string; jumlah: number }>();
const computed = computeItemFinancials({
	input: {
		source: { product_id: product.id, jumlah: 2, add_on_ids: [addOn.id] },
		productId: product.id,
		addOnIds: [addOn.id],
		jumlah: 2
	},
	addOnsById: new Map([[addOn.id, addOn]]),
	productsById: new Map([[product.id, product]]),
	recipesByProduct: new Map(),
	stockTrackingAvailable: true,
	ingredientTrackingAvailable: false,
	stockDeductions,
	ingredientDeductions: new Map(),
	bukuKasId: 'kas-1',
	transactionId: 'transaction-1'
});
assert.equal(computed.harga, 12_000);
assert.equal(computed.nominal, 24_000);
assert.equal(stockDeductions.get(product.id)?.jumlah, 2);

const preparedStatements: FakeStatement[] = [];
const statementDb = {
	prepare(sql: string) {
		const statement: FakeStatement = {
			sql,
			values: [],
			bind(...values) {
				statement.values = values;
				return statement;
			},
			async first() {
				return null;
			},
			async all() {
				return { results: [] };
			}
		};
		preparedStatements.push(statement);
		return statement;
	}
} as unknown as D1Database;
const statementItem: ComputedTransactionItem = {
	id: 'item-1',
	buku_kas_id: 'kas-1',
	produk_id: 'produk-1',
	nama_kustom: null,
	jumlah: 2,
	nominal: 24_000,
	harga: 12_000,
	product_name: 'Jus Mangga',
	harga_dasar: 10_000,
	total_tambahan: 2_000,
	snapshot_tambahan: '[{"id":"tambahan-1"}]',
	gula: 'normal',
	es: 'normal',
	catatan: null,
	snapshot_hpp: null,
	nominal_hpp: 8_000,
	transaction_id: 'transaction-1'
};
const builtCheckout = buildCheckoutStatements({
	db: statementDb,
	branch: 'samarinda',
	items: [statementItem],
	stockDeductions: new Map([['produk-1', { nama: 'Jus Mangga', jumlah: 2 }]]),
	ingredientDeductions: new Map([
		['bahan-1', { nama: 'Mangga', satuan: 'gram', jumlah: 200, products: ['Jus Mangga'] }]
	]),
	totalAmount: 24_000,
	totalQty: 2,
	totalHpp: 8_000,
	paymentMethod: 'tunai',
	customerName: 'Ayu',
	salesDate: '2026-07-03',
	bukuKasId: 'kas-1',
	transactionId: 'transaction-1',
	createdAt: '2026-07-03T06:00:00.000Z',
	idSesiToko: 'sesi-1',
	idempotencyKey: 'idempotency-1',
	session: { userId: 'kasir-1', username: 'kasir' },
	capabilities: {
		stockTrackingAvailable: true,
		ingredientTrackingAvailable: true,
		idempotencyAvailable: true,
		salesSummaryAvailable: true,
		transactionSnapshotAvailable: true
	}
});
assert.equal(builtCheckout.length, 7);
assert.equal(preparedStatements.length, 7);
assert.equal(
	preparedStatements.some((statement) => statement.sql.includes('INSERT INTO buku_kas')),
	true
);
assert.equal(
	preparedStatements.some((statement) =>
		statement.sql.includes('INSERT INTO ringkasan_penjualan_harian')
	),
	true
);
assert.equal(
	preparedStatements.every(
		(statement) => !statement.sql.includes('cabang_id') || statement.values.includes('samarinda')
	),
	true
);

console.log('Hardening regression tests passed.');
