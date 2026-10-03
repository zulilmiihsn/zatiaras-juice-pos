import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { buildCheckoutStatements } from '../lib/server/checkout/statementBuilder';
import {
	countPendingOrders,
	countPendingOrdersBefore,
	listOrderQueue,
	transitionOrderPreparation
} from '../lib/server/orderQueue/useCase';
import { GET as AntreanGet } from '../routes/api/antrean/+server';
import { POST as AntreanStatusPost } from '../routes/api/antrean/status/+server';
import { executeCheckout, CheckoutUseCaseError } from '../lib/server/checkout/checkoutUseCase';
import { getCheckoutCapabilities } from '../lib/server/checkout/dataLoader';
import { filterQueueOrders } from '../lib/utils/orderQueueLocal';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { voidTransaksiKasir } from '../lib/server/services/transaksiKasirService';
import { previewArchive, runArchive } from '../lib/server/archiveUseCase';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const ownerSession = {
	id: 'session-antrean-owner',
	userId: 'owner-antrean',
	username: 'owner',
	role: 'pemilik',
	branch: 'samarinda',
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [],
	unlockExpiresAt: 0
};
function apiEvent(
	method: 'GET' | 'POST',
	url: string,
	role: string,
	branch: string,
	body?: unknown
) {
	return {
		request: new Request(url, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		}),
		url: new URL(url),
		locals: {
			authSession: {
				id: `session-${role}`,
				userId: `${role}-1`,
				username: role,
				role,
				branch,
				createdAt: 0,
				expiresAt: Date.now() + 60_000,
				unlockedPages: [],
				unlockExpiresAt: 0
			}
		},
		platform: { env: { DB_SAMARINDA_GROUP: db } }
	};
}

async function expectStatus(run: () => unknown, status: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === status
	);
}

async function seedQueueRow(input: {
	bukuKasId: string;
	transactionId: string;
	idempotencyKey: string;
	branch?: string;
	waktu: string;
	nama?: string | null;
	state?: 'pending' | 'done' | null;
	completedAt?: string;
	revision?: number;
	sumber?: string;
	withItems?: boolean;
}) {
	const branch = input.branch ?? 'samarinda';
	const state = input.state === undefined ? 'pending' : input.state;
	await db
		.prepare(
			`INSERT INTO buku_kas (
				id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, deskripsi,
				nama_pelanggan, metode_bayar, transaction_id, idempotency_key,
				stock_policy_mode, stock_policy_revision, stock_replay_disposition,
				preparation_state, preparation_revision,
				preparation_completed_at, preparation_completed_by,
				restored_from_archive, created_at, updated_at
			) VALUES (?, ?, ?, ?, 'in', 'pendapatan_usaha', 15000, 1, 'Penjualan Antrean',
				?, 'tunai', ?, ?,
				'tracked', 0, 'normal',
				?, ?,
				?, ?,
				0, ?, ?)`
		)
		.bind(
			input.bukuKasId,
			branch,
			input.waktu,
			input.sumber ?? 'pos',
			input.nama ?? 'Pelanggan Antrean',
			input.transactionId,
			input.idempotencyKey,
			state,
			input.revision ?? 0,
			state === 'done' ? (input.completedAt ?? '2026-09-28T02:00:00.000Z') : null,
			state === 'done' ? 'owner-antrean' : null,
			input.waktu,
			input.waktu
		)
		.run();
	if (input.withItems !== false && (input.sumber ?? 'pos') === 'pos') {
		await db
			.prepare(
				`INSERT INTO transaksi_kasir (
					id, cabang_id, buku_kas_id, produk_id, nama_kustom, jumlah, nominal, harga,
					nama_produk, harga_dasar, total_tambahan, gula, es, catatan,
					transaction_id, created_at, updated_at
				) VALUES (?, ?, ?, 'produk-jus', NULL, 1, 15000, 15000,
					'Jus Mangga (Jumbo)', 15000, 0, 'kurang', 'tanpa', 'tanpa es batu',
					?, ?, ?)`
			)
			.bind(
				`detail-${input.bukuKasId}`,
				branch,
				input.bukuKasId,
				input.transactionId,
				input.waktu,
				input.waktu
			)
			.run();
	}
}

try {
	// Q01: kolom migrasi aditif tersedia dan legacy nullable.
	const bukuKasCols = (
		(await db.prepare('PRAGMA table_info(buku_kas);').all()) as unknown as {
			results: Array<{ name: string }>;
		}
	).results.map((c) => c.name);
	for (const col of [
		'preparation_state',
		'preparation_revision',
		'preparation_completed_at',
		'preparation_completed_by'
	]) {
		assert.ok(bukuKasCols.includes(col), `buku_kas harus punya kolom ${col}`);
	}
	const prepIndex = (
		(await db
			.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='buku_kas'")
			.all()) as unknown as { results: Array<{ name: string }> }
	).results.map((r) => r.name);
	assert.ok(
		prepIndex.some((n) => n.includes('preparation')),
		'buku_kas harus punya index preparation'
	);

	// Q02: statement checkout menulis pending dalam batch yang sama.
	const statements = buildCheckoutStatements({
		db,
		branch: 'samarinda',
		items: [
			{
				id: 'item-antrean-1',
				buku_kas_id: 'bk-antrean-1',
				produk_id: 'produk-jus',
				nama_kustom: null,
				jumlah: 1,
				nominal: 15000,
				harga: 15000,
				product_name: 'Jus Mangga',
				harga_dasar: 15000,
				total_tambahan: 0,
				snapshot_tambahan: null,
				gula: null,
				es: null,
				catatan: null,
				snapshot_hpp: null,
				nominal_hpp: 0,
				transaction_id: 'trx-antrean-1'
			}
		],
		stockDeductions: new Map(),
		ingredientDeductions: new Map(),
		totalAmount: 15000,
		totalQty: 1,
		totalHpp: 0,
		paymentMethod: 'tunai',
		customerName: 'Rina',
		salesDate: '2026-09-28',
		bukuKasId: 'bk-antrean-1',
		transactionId: 'trx-antrean-1',
		createdAt: '2026-09-28T01:00:00.000Z',
		idSesiToko: null,
		idempotencyKey: 'antrean-key-0001',
		requestFingerprint: 'fp-antrean-1',
		receiptSnapshot: null,
		session: { userId: 'owner-antrean', username: 'owner' },
		capabilities: {
			stockTrackingAvailable: false,
			ingredientTrackingAvailable: false,
			idempotencyAvailable: true,
			salesSummaryAvailable: false,
			transactionSnapshotAvailable: true,
			nomorHarianAvailable: true
		},
		stockPolicy: {
			mode: 'tracked',
			revision: 0,
			disabled_at: null,
			reconciled_at: null,
			updated_at: null
		},
		inventoryApplication: 'apply',
		replayDisposition: 'normal'
	});
	assert.ok(statements.length >= 1, 'checkout harus menghasilkan statement header');

	// Q02 lanjutan: checkout pemilik end-to-end membuat satu kartu pending.
	await db.batch([
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('antrean-produk', 'samarinda', 'Jus Antrean', 15000, 0, 0, 0, 1)`
		)
	]);
	const checkoutEnv = {
		DB_SAMARINDA_GROUP: db,
		POS_PRICE_SIGNING_KEY: 'antrean-test-key-32-bytes-minimum-abc',
		POS_PRICE_SIGNING_KEY_ID: 'test'
	} as App.Platform['env'];
	const checkoutSource = { product_id: 'antrean-produk', jumlah: 1 };
	const checkoutQuote = await signPosPricingToken(checkoutEnv, {
		kind: 'checkout_quote',
		branch: 'samarinda',
		data: {
			items: [
				{
					source: checkoutSource,
					product_name: 'Jus Antrean',
					product_price: 15000,
					add_ons: [],
					line_total: 15000
				}
			],
			total_amount: 15000,
			total_qty: 1
		},
		ttlMs: 60_000
	});
	const checkoutResult = await executeCheckout({
		db,
		branch: samarinda,
		session: { userId: 'owner-antrean', username: 'owner', role: 'pemilik' },
		platform: { env: checkoutEnv } as App.Platform,
		rawBody: {
			idempotency_key: 'antrean-checkout-e2e-0001',
			metode_bayar: 'tunai',
			cash_received: 15000,
			items: [checkoutSource],
			quote_token: checkoutQuote
		}
	});
	assert.equal(checkoutResult.idempotent, false);
	const storedState = await db
		.prepare('SELECT preparation_state FROM buku_kas WHERE idempotency_key = ? AND cabang_id = ?')
		.bind('antrean-checkout-e2e-0001', 'samarinda')
		.first<string>('preparation_state');
	assert.equal(storedState, 'pending');
	const retryResult = await executeCheckout({
		db,
		branch: samarinda,
		session: { userId: 'owner-antrean', username: 'owner', role: 'pemilik' },
		platform: { env: checkoutEnv } as App.Platform,
		rawBody: {
			idempotency_key: 'antrean-checkout-e2e-0001',
			metode_bayar: 'tunai',
			cash_received: 15000,
			items: [checkoutSource],
			quote_token: checkoutQuote
		}
	});
	assert.equal(retryResult.idempotent, true);
	assert.equal(
		await db
			.prepare('SELECT COUNT(*) AS n FROM buku_kas WHERE idempotency_key = ? AND cabang_id = ?')
			.bind('antrean-checkout-e2e-0001', 'samarinda')
			.first<number>('n'),
		1
	);

	// Q04b: nomor antrean harian: transaksi pertama = 1, retry memakai nomor sama.
	assert.equal(checkoutResult.data.nomor_harian, 1);
	assert.equal(retryResult.data.nomor_harian, 1);
	assert.equal(retryResult.data.tanggal_nomor, checkoutResult.data.tanggal_nomor);
	const storedNomor = (await db
		.prepare(
			'SELECT nomor_harian, tanggal_nomor FROM buku_kas WHERE idempotency_key = ? AND cabang_id = ?'
		)
		.bind('antrean-checkout-e2e-0001', 'samarinda')
		.first()) as { nomor_harian?: number; tanggal_nomor?: string } | null;
	assert.equal(storedNomor?.nomor_harian, 1);
	assert.equal(storedNomor?.tanggal_nomor, checkoutResult.data.tanggal_nomor);

	// Q04c: 10 checkout paralel mendapat nomor unik berurutan (alokasi atomik).
	const parallelResults = await Promise.all(
		Array.from({ length: 10 }, (_, index) =>
			executeCheckout({
				db,
				branch: samarinda,
				session: { userId: 'owner-antrean', username: 'owner', role: 'pemilik' },
				platform: { env: checkoutEnv } as App.Platform,
				rawBody: {
					idempotency_key: `antrean-paralel-${index}`,
					metode_bayar: 'tunai',
					cash_received: 15000,
					items: [checkoutSource],
					quote_token: checkoutQuote
				}
			})
		)
	);
	assert.deepEqual(
		parallelResults.map((r) => r.data.nomor_harian).sort((a, b) => Number(a) - Number(b)),
		[2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
	);

	// Q04d: counter terisolasi per cabang: cabang lain mulai dari 1 di tanggal sama.
	await db.batch([
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('antrean-produk-bpp', 'balikpapan', 'Jus Antrean', 15000, 0, 0, 0, 1)`
		)
	]);
	const balikpapanSource = { product_id: 'antrean-produk-bpp', jumlah: 1 };
	const balikpapanQuote = await signPosPricingToken(checkoutEnv, {
		kind: 'checkout_quote',
		branch: 'balikpapan',
		data: {
			items: [
				{
					source: balikpapanSource,
					product_name: 'Jus Antrean',
					product_price: 15000,
					add_ons: [],
					line_total: 15000
				}
			],
			total_amount: 15000,
			total_qty: 1
		},
		ttlMs: 60_000
	});
	const balikpapanResult = await executeCheckout({
		db,
		branch: branchContext('balikpapan'),
		session: { userId: 'owner-antrean', username: 'owner', role: 'pemilik' },
		platform: { env: checkoutEnv } as App.Platform,
		rawBody: {
			idempotency_key: 'antrean-cabang-0001',
			metode_bayar: 'tunai',
			cash_received: 15000,
			items: [balikpapanSource],
			quote_token: balikpapanQuote
		}
	});
	assert.equal(balikpapanResult.data.nomor_harian, 1);
	assert.equal(balikpapanResult.data.tanggal_nomor, checkoutResult.data.tanggal_nomor);

	// Q05: daftar, urutan, snapshot, pagination, dan isolasi cabang.
	await seedQueueRow({
		bukuKasId: 'bk-old',
		transactionId: 'trx-old',
		idempotencyKey: 'antrean-old-0001',
		waktu: '2026-09-27T01:00:00.000Z',
		nama: 'Rina'
	});
	await seedQueueRow({
		bukuKasId: 'bk-new',
		transactionId: 'trx-new',
		idempotencyKey: 'antrean-new-0002',
		waktu: '2026-09-28T01:00:00.000Z',
		nama: 'Budi'
	});
	await seedQueueRow({
		bukuKasId: 'bk-manual',
		transactionId: 'trx-manual',
		idempotencyKey: 'antrean-manual-0003',
		waktu: '2026-09-28T02:00:00.000Z',
		sumber: 'catat',
		withItems: false
	});
	await seedQueueRow({
		bukuKasId: 'bk-legacy',
		transactionId: 'trx-legacy',
		idempotencyKey: 'antrean-legacy-0004',
		waktu: '2026-09-28T03:00:00.000Z',
		state: null,
		withItems: false
	});
	await seedQueueRow({
		bukuKasId: 'bk-other-branch',
		transactionId: 'trx-other',
		idempotencyKey: 'antrean-other-0005',
		branch: 'balikpapan',
		waktu: '2026-09-28T04:00:00.000Z'
	});
	const pendingPage = await listOrderQueue(db, samarinda, { state: 'pending', limit: 50 });
	assert.ok(
		pendingPage.items.some((i) => i.idempotency_key === 'antrean-old-0001'),
		'pending harus memuat pesanan lama'
	);
	assert.ok(
		pendingPage.items.some((i) => i.idempotency_key === 'antrean-checkout-e2e-0001'),
		'pending harus memuat checkout baru'
	);
	assert.ok(
		!pendingPage.items.some((i) => i.idempotency_key === 'antrean-manual-0003'),
		'transaksi manual bukan pesanan'
	);
	assert.ok(
		!pendingPage.items.some((i) => i.idempotency_key === 'antrean-legacy-0004'),
		'legacy NULL bukan pesanan'
	);
	assert.ok(
		!pendingPage.items.some((i) => i.idempotency_key === 'antrean-other-0005'),
		'cabang lain terisolasi'
	);
	const orderedKeys = pendingPage.items.map((i) => i.idempotency_key);
	assert.ok(
		orderedKeys.indexOf('antrean-old-0001') < orderedKeys.indexOf('antrean-new-0002'),
		'pending tertua dulu'
	);
	const oldCard = pendingPage.items.find((i) => i.idempotency_key === 'antrean-old-0001');
	assert.equal(oldCard?.nama_pelanggan, 'Rina');
	assert.equal(oldCard?.items.length, 1);
	assert.equal(oldCard?.items[0]?.nama, 'Jus Mangga (Jumbo)');
	assert.equal(oldCard?.items[0]?.gula, 'kurang');
	assert.equal(oldCard?.items[0]?.catatan, 'tanpa es batu');
	// Nomor resmi terbawa ke daftar; baris seed lama (NULL) tetap tampil tanpa nomor.
	const checkoutCard = pendingPage.items.find(
		(i) => i.idempotency_key === 'antrean-checkout-e2e-0001'
	);
	assert.equal(checkoutCard?.nomor_harian, 1);
	assert.equal(oldCard?.nomor_harian, null);
	await db
		.prepare(
			"UPDATE produk SET nama = 'Berubah' WHERE id = 'antrean-produk' AND cabang_id = 'samarinda'"
		)
		.run();
	const afterCatalogChange = await listOrderQueue(db, samarinda, { state: 'pending', limit: 50 });
	assert.equal(
		afterCatalogChange.items.find((i) => i.idempotency_key === 'antrean-old-0001')?.items[0]?.nama,
		'Jus Mangga (Jumbo)'
	);
	assert.equal(await countPendingOrders(db, samarinda), pendingPage.pending_count);
	const firstTwo = await listOrderQueue(db, samarinda, { state: 'pending', limit: 1 });
	assert.equal(firstTwo.items.length, 1);
	assert.equal(firstTwo.hasMore, true);
	assert.ok(firstTwo.nextCursor, 'cursor harus ada bila hasMore');
	const nextPage = await listOrderQueue(db, samarinda, {
		state: 'pending',
		limit: 50,
		cursor: firstTwo.nextCursor
	});
	assert.ok(
		!nextPage.items.some((i) => i.idempotency_key === firstTwo.items[0]?.idempotency_key),
		'pagination tidak boleh ganda'
	);

	// Q06: Selesai idempotent, Buka lagi, dan stale revision ditolak.
	const doneOnce = await transitionOrderPreparation(
		db,
		samarinda,
		{ userId: 'owner-antrean', role: 'pemilik' },
		{ idempotency_key: 'antrean-old-0001', target: 'done', expected_revision: 0 }
	);
	assert.equal(doneOnce.preparation_state, 'done');
	assert.equal(doneOnce.preparation_revision, 1);
	const doneAgain = await transitionOrderPreparation(
		db,
		samarinda,
		{ userId: 'owner-antrean', role: 'pemilik' },
		{ idempotency_key: 'antrean-old-0001', target: 'done', expected_revision: 1 }
	);
	assert.equal(doneAgain.idempotent, true);
	assert.equal(doneAgain.preparation_revision, 1);
	const reopened = await transitionOrderPreparation(
		db,
		samarinda,
		{ userId: 'kasir-1', role: 'kasir' },
		{ idempotency_key: 'antrean-old-0001', target: 'pending', expected_revision: 1 }
	);
	assert.equal(reopened.preparation_state, 'pending');
	assert.equal(reopened.preparation_revision, 2);
	await expectStatus(
		() =>
			transitionOrderPreparation(
				db,
				samarinda,
				{ userId: 'owner-antrean', role: 'pemilik' },
				{ idempotency_key: 'antrean-old-0001', target: 'done', expected_revision: 1 }
			),
		409
	);
	await expectStatus(
		() =>
			transitionOrderPreparation(
				db,
				samarinda,
				{ userId: 'owner-antrean', role: 'pemilik' },
				{ idempotency_key: 'antrean-legacy-0004', target: 'done', expected_revision: 0 }
			),
		409
	);
	await expectStatus(
		() =>
			transitionOrderPreparation(
				db,
				branchContext('balikpapan'),
				{ userId: 'owner-antrean', role: 'pemilik' },
				{ idempotency_key: 'antrean-new-0002', target: 'done', expected_revision: 0 }
			),
		404
	);
	await expectStatus(
		() =>
			transitionOrderPreparation(
				db,
				samarinda,
				{ userId: 'owner-antrean', role: 'pemilik' },
				{ idempotency_key: 'tidak-ada-0000', target: 'done', expected_revision: 0 }
			),
		404
	);

	// A void between the initial read and CAS must remain a not-found response.
	await seedQueueRow({
		bukuKasId: 'bk-antrean-disappears',
		transactionId: 'trx-antrean-disappears',
		idempotencyKey: 'antrean-disappears-0001',
		waktu: '2026-09-28T03:00:00.000Z'
	});
	await db
		.prepare(
			`CREATE TRIGGER delete_queue_row_during_transition
			 BEFORE UPDATE OF preparation_state ON buku_kas
			 WHEN OLD.id = 'bk-antrean-disappears'
			 BEGIN
				DELETE FROM transaksi_kasir WHERE buku_kas_id = OLD.id AND cabang_id = OLD.cabang_id;
				DELETE FROM buku_kas WHERE id = OLD.id AND cabang_id = OLD.cabang_id;
				SELECT RAISE(IGNORE);
			 END`
		)
		.run();
	try {
		await expectStatus(
			() =>
				transitionOrderPreparation(
					db,
					samarinda,
					{ userId: 'owner-antrean', role: 'pemilik' },
					{
						idempotency_key: 'antrean-disappears-0001',
						target: 'done',
						expected_revision: 0
					}
				),
			404
		);
	} finally {
		await db.prepare('DROP TRIGGER IF EXISTS delete_queue_row_during_transition').run();
	}

	// Q07: route auth/role/cabang/body.
	for (const role of ['admin', 'tamu']) {
		for (const requestedBranch of ['samarinda', 'balikpapan']) {
			const denied = apiEvent(
				'GET',
				`https://test.invalid/api/antrean?branch=${requestedBranch}`,
				role,
				'samarinda'
			);
			await expectStatus(() => AntreanGet({ ...denied, platform: undefined } as never), 403);
		}
		const deniedPost = apiEvent(
			'POST',
			'https://test.invalid/api/antrean/status',
			role,
			'samarinda'
		);
		await expectStatus(
			() => AntreanStatusPost({ ...deniedPost, platform: undefined } as never),
			403
		);
	}
	for (const role of ['admin', 'tamu']) {
		let bodyRead = false;
		const deniedBody = apiEvent(
			'POST',
			'https://test.invalid/api/antrean/status',
			role,
			'samarinda'
		);
		await expectStatus(
			() =>
				AntreanStatusPost({
					...deniedBody,
					request: {
						json: async () => {
							bodyRead = true;
							throw new Error('denied role must not read request body');
						}
					},
					platform: undefined
				} as never),
			403
		);
		assert.equal(bodyRead, false, `${role} denial must precede JSON body parsing`);
	}
	const anonymous = apiEvent('GET', 'https://test.invalid/api/antrean', 'kasir', 'samarinda');
	await expectStatus(
		() => AntreanGet({ ...anonymous, locals: {}, platform: undefined } as never),
		401
	);
	await expectStatus(
		() => AntreanStatusPost({ ...anonymous, locals: {}, platform: undefined } as never),
		401
	);
	await expectStatus(
		() =>
			AntreanGet(
				apiEvent(
					'GET',
					'https://test.invalid/api/antrean?branch=balikpapan&state=pending',
					'kasir',
					'samarinda'
				) as never
			),
		403
	);
	await expectStatus(
		() =>
			AntreanStatusPost(
				apiEvent('POST', 'https://test.invalid/api/antrean/status', 'tamu', 'samarinda', {
					idempotency_key: 'antrean-new-0002',
					target: 'done',
					expected_revision: 0
				}) as never
			),
		403
	);
	await expectStatus(
		() =>
			AntreanStatusPost(
				apiEvent('POST', 'https://test.invalid/api/antrean/status', 'kasir', 'samarinda', {
					idempotency_key: 'pendek',
					target: 'done',
					expected_revision: 0
				}) as never
			),
		400
	);
	const getOk = (await AntreanGet(
		apiEvent('GET', 'https://test.invalid/api/antrean?state=pending', 'kasir', 'samarinda') as never
	)) as Response;
	assert.equal(getOk.status, 200);
	const getJson = (await getOk.json()) as {
		ok: boolean;
		data: { items: Array<{ idempotency_key: string }>; pending_count: number };
	};
	assert.equal(getJson.ok, true);
	assert.ok(Array.isArray(getJson.data.items));
	const statusOk = (await AntreanStatusPost(
		apiEvent('POST', 'https://test.invalid/api/antrean/status', 'kasir', 'samarinda', {
			idempotency_key: 'antrean-new-0002',
			target: 'done',
			expected_revision: 0
		}) as never
	)) as Response;
	assert.equal(statusOk.status, 200);
	const ownerGet = await AntreanGet(
		apiEvent('GET', 'https://test.invalid/api/antrean', 'pemilik', 'samarinda') as never
	);
	assert.equal(ownerGet.status, 200);
	await seedQueueRow({
		bukuKasId: 'bk-antrean-cross-route',
		transactionId: 'trx-antrean-cross-route',
		idempotencyKey: 'antrean-new-0002',
		branch: 'balikpapan',
		waktu: '2026-09-28T04:00:00.000Z'
	});
	const ownerPost = await AntreanStatusPost(
		apiEvent(
			'POST',
			'https://test.invalid/api/antrean/status?branch=balikpapan',
			'pemilik',
			'samarinda',
			{
				branch: 'balikpapan',
				idempotency_key: 'antrean-new-0002',
				target: 'done',
				expected_revision: 1
			}
		) as never
	);
	assert.equal(ownerPost.status, 200);
	const crossBranch = await listOrderQueue(db, branchContext('balikpapan'), { state: 'pending' });
	const unmodifiedCrossTenant = crossBranch.items.find(
		(item) => item.idempotency_key === 'antrean-new-0002'
	);
	assert.equal(unmodifiedCrossTenant?.preparation_state, 'pending');
	assert.equal(unmodifiedCrossTenant?.preparation_revision, 0);

	// Q09: void menghapus kartu pending/done.
	await seedQueueRow({
		bukuKasId: 'bk-void',
		transactionId: 'trx-void-1',
		idempotencyKey: 'antrean-void-0006',
		waktu: '2026-09-28T05:00:00.000Z'
	});
	const voidResult = await voidTransaksiKasir(
		db,
		'samarinda',
		ownerSession,
		undefined,
		'trx-void-1'
	);
	assert.equal(voidResult.ok, true);
	const afterVoid = await listOrderQueue(db, samarinda, { state: 'pending', limit: 100 });
	assert.ok(!afterVoid.items.some((i) => i.idempotency_key === 'antrean-void-0006'));
	await expectStatus(
		() =>
			transitionOrderPreparation(
				db,
				samarinda,
				{ userId: 'owner-antrean', role: 'pemilik' },
				{ idempotency_key: 'antrean-void-0006', target: 'done', expected_revision: 0 }
			),
		404
	);

	// Q10: arsip menolak pending dalam cutoff dan preview menandai blocker.
	await seedQueueRow({
		bukuKasId: 'bk-arsip-pending',
		transactionId: 'trx-arsip-pending',
		idempotencyKey: 'antrean-arsip-0007',
		waktu: '2025-12-01T01:00:00.000Z'
	});
	assert.equal(await countPendingOrdersBefore(db, samarinda, '2026-01-01T00:00:00.000Z'), 1);
	const preview = await previewArchive(db, samarinda, 2026);
	assert.equal(preview.pending_orders, 1);
	const mockBucket = {
		async put() {},
		async get() {
			return null;
		}
	};
	let archiveStatus = 0;
	try {
		await runArchive(db, mockBucket, samarinda, 2026);
	} catch (error) {
		archiveStatus = Number((error as { status?: number }).status ?? 0);
	}
	assert.equal(archiveStatus, 409);
	assert.equal(
		await db
			.prepare('SELECT COUNT(*) AS n FROM buku_kas WHERE id = ? AND cabang_id = ?')
			.bind('bk-arsip-pending', 'samarinda')
			.first<number>('n'),
		1
	);

	// Q10b: saring antrean berdasarkan nama atau nomor (murni, tanpa IO).
	const sampleCards = [
		{
			idempotency_key: 'k-1',
			transaction_id: 't-1',
			buku_kas_id: 'bk-1',
			preparation_completed_at: null,
			nominal: 10000,
			nomor_harian: 7,
			nama_pelanggan: 'Ilham',
			waktu: '2026-09-29T04:00:00.000Z',
			preparation_state: 'pending' as const,
			preparation_revision: 0,
			items: [],
			unsynced: false
		},
		{
			idempotency_key: 'k-2',
			transaction_id: 't-2',
			buku_kas_id: 'bk-2',
			preparation_completed_at: null,
			nominal: 20000,
			nomor_harian: 142,
			nama_pelanggan: 'Haura',
			waktu: '2026-09-29T05:00:00.000Z',
			preparation_state: 'pending' as const,
			preparation_revision: 0,
			items: [],
			unsynced: false
		},
		{
			idempotency_key: 'k-3',
			transaction_id: 'k-3',
			buku_kas_id: null,
			preparation_completed_at: null,
			nominal: null,
			nomor_harian: null,
			nama_pelanggan: 'Budi',
			waktu: '2026-09-29T06:00:00.000Z',
			preparation_state: 'pending' as const,
			preparation_revision: 0,
			items: [],
			unsynced: true
		}
	];
	assert.equal(filterQueueOrders(sampleCards, '').length, 3);
	assert.deepEqual(
		filterQueueOrders(sampleCards, 'ilha').map((c) => c.idempotency_key),
		['k-1']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, 'HAU').map((c) => c.idempotency_key),
		['k-2']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, '42').map((c) => c.idempotency_key),
		['k-2']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, '007').map((c) => c.idempotency_key),
		['k-1']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, 'budi').map((c) => c.idempotency_key),
		['k-3']
	);
	assert.deepEqual(filterQueueOrders(sampleCards, 'zzz-tidak-ada'), []);
	assert.deepEqual(
		filterQueueOrders(sampleCards, '142 haura').map((c) => c.idempotency_key),
		['k-2']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, 'haura 142').map((c) => c.idempotency_key),
		['k-2']
	);
	assert.deepEqual(
		filterQueueOrders(sampleCards, '007 ilham').map((c) => c.idempotency_key),
		['k-1']
	);
	assert.deepEqual(filterQueueOrders(sampleCards, '142 ilham'), []);
	assert.deepEqual(filterQueueOrders(sampleCards, '007 budi'), []);

	// Q05b: Selesai dibatasi 7 hari; Belum selesai tanpa batas tanggal.
	const dayMs = 24 * 60 * 60 * 1000;
	await seedQueueRow({
		bukuKasId: 'bk-done-sepekan',
		transactionId: 'trx-done-sepekan',
		idempotencyKey: 'antrean-done-sepekan',
		waktu: new Date(Date.now() - dayMs).toISOString(),
		state: 'done',
		completedAt: new Date(Date.now() - dayMs).toISOString(),
		withItems: false
	});
	await seedQueueRow({
		bukuKasId: 'bk-done-lawas',
		transactionId: 'trx-done-lawas',
		idempotencyKey: 'antrean-done-lawas',
		waktu: new Date(Date.now() - 10 * dayMs).toISOString(),
		state: 'done',
		completedAt: new Date(Date.now() - 10 * dayMs).toISOString(),
		withItems: false
	});
	await seedQueueRow({
		bukuKasId: 'bk-pending-lawas',
		transactionId: 'trx-pending-lawas',
		idempotencyKey: 'antrean-pending-lawas',
		waktu: new Date(Date.now() - 10 * dayMs).toISOString(),
		withItems: false
	});
	const donePage = await listOrderQueue(db, samarinda, { state: 'done', limit: 50 });
	assert.ok(
		donePage.items.some((i) => i.idempotency_key === 'antrean-done-sepekan'),
		'selesai kemarin tetap tampil'
	);
	assert.ok(
		!donePage.items.some((i) => i.idempotency_key === 'antrean-done-lawas'),
		'selesai 10 hari lalu disembunyikan'
	);
	const pendingLawas = await listOrderQueue(db, samarinda, { state: 'pending', limit: 100 });
	assert.ok(
		pendingLawas.items.some((i) => i.idempotency_key === 'antrean-pending-lawas'),
		'pending lawas wajib tetap tampil'
	);

	// Q10c: deteksi capability jujur — semua true di skema penuh, false per artefak hilang.
	const capsPenuh = await getCheckoutCapabilities(db, samarinda);
	assert.deepEqual(capsPenuh, {
		stockTrackingAvailable: true,
		ingredientTrackingAvailable: true,
		idempotencyAvailable: true,
		salesSummaryAvailable: true,
		transactionSnapshotAvailable: true,
		nomorHarianAvailable: true
	});
	type CapsDb = Parameters<typeof getCheckoutCapabilities>[0];
	function fakeCapsDb(opts: {
		tables: string[];
		bukuKas: string[];
		produk: string[];
		transaksiKasir: string[];
	}): CapsDb {
		const pick = (sql: string): Array<{ name: string }> => {
			const rows = sql.includes('sqlite_master')
				? opts.tables
				: sql.includes('buku_kas')
					? opts.bukuKas
					: sql.includes('produk')
						? opts.produk
						: opts.transaksiKasir;
			return rows.map((name) => ({ name }));
		};
		return {
			prepare: (sql: string) => ({
				bind: (..._args: unknown[]) => ({ all: async () => ({ results: pick(sql) }) }),
				all: async () => ({ results: pick(sql) })
			})
		} as unknown as CapsDb;
	}
	const skemaPenuh = {
		tables: [
			'pos_nomor_harian',
			'resep_produk',
			'ringkasan_penjualan_harian',
			'penjualan_produk_harian'
		],
		bukuKas: ['idempotency_key', 'nomor_harian', 'tanggal_nomor'],
		produk: ['lacak_stok', 'lacak_bahan'],
		transaksiKasir: ['nama_produk']
	};
	assert.deepEqual(await getCheckoutCapabilities(fakeCapsDb(skemaPenuh), samarinda), {
		stockTrackingAvailable: true,
		ingredientTrackingAvailable: true,
		idempotencyAvailable: true,
		salesSummaryAvailable: true,
		transactionSnapshotAvailable: true,
		nomorHarianAvailable: true
	});
	const tanpaSatu: Array<{ nama: string; ubah: () => typeof skemaPenuh; mati: string }> = [
		{
			nama: 'tanpa lacak_stok',
			ubah: () => ({ ...skemaPenuh, produk: ['lacak_bahan'] }),
			mati: 'stockTrackingAvailable'
		},
		{
			nama: 'tanpa lacak_bahan',
			ubah: () => ({ ...skemaPenuh, produk: ['lacak_stok'] }),
			mati: 'ingredientTrackingAvailable'
		},
		{
			nama: 'tanpa tabel resep',
			ubah: () => ({
				...skemaPenuh,
				tables: skemaPenuh.tables.filter((t) => t !== 'resep_produk')
			}),
			mati: 'ingredientTrackingAvailable'
		},
		{
			nama: 'tanpa idempotency_key',
			ubah: () => ({ ...skemaPenuh, bukuKas: ['nomor_harian', 'tanggal_nomor'] }),
			mati: 'idempotencyAvailable'
		},
		{
			nama: 'tanpa tabel ringkasan',
			ubah: () => ({
				...skemaPenuh,
				tables: skemaPenuh.tables.filter((t) => t !== 'ringkasan_penjualan_harian')
			}),
			mati: 'salesSummaryAvailable'
		},
		{
			nama: 'tanpa snapshot nama_produk',
			ubah: () => ({ ...skemaPenuh, transaksiKasir: [] }),
			mati: 'transactionSnapshotAvailable'
		},
		{
			nama: 'tanpa tabel nomor harian',
			ubah: () => ({
				...skemaPenuh,
				tables: skemaPenuh.tables.filter((t) => t !== 'pos_nomor_harian')
			}),
			mati: 'nomorHarianAvailable'
		}
	];
	for (const kasus of tanpaSatu) {
		const caps = await getCheckoutCapabilities(fakeCapsDb(kasus.ubah()), samarinda);
		assert.equal(
			(caps as unknown as Record<string, boolean>)[kasus.mati],
			false,
			`capability mati ${kasus.nama}`
		);
		const hidup = Object.entries(caps).filter(([k]) => k !== kasus.mati);
		assert.ok(
			hidup.every(([, v]) => v === true),
			`hanya satu capability mati ${kasus.nama}`
		);
	}

	// Q11: tanpa skema 0036, checkout gagal tertutup 503 dengan pesan jelas.
	assert.equal((await getCheckoutCapabilities(db, samarinda)).nomorHarianAvailable, true);
	await db.batch([
		db.prepare('DROP TRIGGER IF EXISTS trg_buku_kas_nomor_pair_guard'),
		db.prepare('DROP TRIGGER IF EXISTS trg_buku_kas_nomor_pair_update_guard'),
		db.prepare('DROP TABLE pos_nomor_harian')
	]);
	assert.equal((await getCheckoutCapabilities(db, samarinda)).nomorHarianAvailable, false);
	await assert.rejects(
		executeCheckout({
			db,
			branch: samarinda,
			session: { userId: 'owner-antrean', username: 'owner', role: 'pemilik' },
			platform: { env: checkoutEnv } as App.Platform,
			rawBody: {
				idempotency_key: 'antrean-tanpa-skema-0001',
				metode_bayar: 'tunai',
				cash_received: 15000,
				items: [checkoutSource],
				quote_token: checkoutQuote
			}
		}),
		(error: unknown) => error instanceof CheckoutUseCaseError && error.status === 503
	);

	console.log('antrean-tests: kontrak Antrean lulus');
} finally {
	await close();
}
process.exit(0);
