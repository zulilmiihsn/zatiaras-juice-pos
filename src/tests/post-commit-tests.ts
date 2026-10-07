import assert from 'node:assert/strict';
import {
	settlePostCommitEffects,
	POST_COMMIT_EFFECTS_TIMEOUT_MS
} from '../lib/server/postCommit.js';
import { REALTIME_PUBLISH_TIMEOUT_MS } from '../lib/server/realtimePublisher.js';
import { executeCheckout } from '../lib/server/checkout/checkoutUseCase';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { branchContext } from '../lib/server/branchResolver';
import { createTestD1 } from './helpers/testD1';

// AUD-049: efek post-commit bounded, commit tetap sah saat downstream stall.
const { db, close } = await createTestD1();
try {
	// Unit: cepat selesai tanpa menunggu budget penuh.
	const fastStart = Date.now();
	await settlePostCommitEffects([Promise.resolve(1), Promise.resolve(2)], 1000);
	assert.ok(Date.now() - fastStart < 1000, 'tugas cepat tak boleh kena budget');

	// Unit: tugas gantung dibatasi budget, tanpa throw, tanpa unhandled rejection.
	let releaseHang!: () => void;
	const hanging = new Promise<void>((resolve) => {
		releaseHang = resolve;
	});
	const hangStart = Date.now();
	await settlePostCommitEffects([hanging], 150);
	const hangElapsed = Date.now() - hangStart;
	assert.ok(hangElapsed < 1500, `gantung dibatasi budget, aktual ${hangElapsed}ms`);
	assert.ok(hangElapsed >= 100, 'budget benar-benar ditunggu');
	releaseHang();
	await hanging;

	// Unit: rejection tak melempar.
	await settlePostCommitEffects([Promise.reject(new Error('downstream down'))], 150);

	// Unit: budget terpublikasi untuk SLO.
	assert.ok(POST_COMMIT_EFFECTS_TIMEOUT_MS <= 5000);
	assert.ok(REALTIME_PUBLISH_TIMEOUT_MS <= POST_COMMIT_EFFECTS_TIMEOUT_MS);

	// Integrasi: realtime HANG total -> checkout tetap sah dalam budget, satu sale.
	await db.batch([
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('postcommit-produk', 'samarinda', 'Jus PostCommit', 12000, 0, 0, 0, 1)`
		),
		db.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nama_toko, alamat, telepon, instagram, ucapan)
			 VALUES ('settings-postcommit', 'samarinda', NULL, 'Toko', 'Alamat', '081', '@t', 'Thanks')`
		)
	]);
	const env = {
		DB_SAMARINDA_GROUP: db,
		POS_PRICE_SIGNING_KEY: 'postcommit-test-key-32-bytes-minimum-abcdef',
		POS_PRICE_SIGNING_KEY_ID: 'test',
		REALTIME_HUB: {
			idFromName: () => 'id',
			get: () => ({ fetch: () => new Promise<Response>(() => {}) })
		}
	} as unknown as App.Platform['env'];
	const source = { product_id: 'postcommit-produk', jumlah: 1 };
	const quote = await signPosPricingToken(env, {
		kind: 'checkout_quote',
		branch: 'samarinda',
		data: {
			items: [
				{
					source,
					product_name: 'Jus PostCommit',
					product_price: 12000,
					add_ons: [],
					line_total: 12000
				}
			],
			total_amount: 12000,
			total_qty: 1
		},
		ttlMs: 60_000
	});
	const session = { userId: 'owner-pc', username: 'owner', role: 'pemilik' };
	const started = Date.now();
	const sale = await executeCheckout({
		db,
		branch: branchContext('samarinda'),
		session,
		platform: { env } as App.Platform,
		rawBody: {
			idempotency_key: 'postcommit-key-1',
			metode_bayar: 'tunai',
			cash_received: 12000,
			items: [source],
			quote_token: quote
		}
	});
	const elapsed = Date.now() - started;
	assert.equal(sale.idempotent, false);
	assert.ok(
		elapsed < POST_COMMIT_EFFECTS_TIMEOUT_MS + REALTIME_PUBLISH_TIMEOUT_MS + 5000,
		`respons bounded saat realtime hang, aktual ${elapsed}ms`
	);
	assert.equal(
		await db
			.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE idempotency_key = 'postcommit-key-1'")
			.first<number>('n'),
		1
	);
	// Retry key sama tetap satu sale (audit intent dapat drain, tanpa duplikat).
	const retry = await executeCheckout({
		db,
		branch: branchContext('samarinda'),
		session,
		platform: { env } as App.Platform,
		rawBody: {
			idempotency_key: 'postcommit-key-1',
			metode_bayar: 'tunai',
			cash_received: 12000,
			items: [source],
			quote_token: quote
		}
	});
	assert.equal(retry.idempotent, true);
	assert.equal(
		await db
			.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE idempotency_key = 'postcommit-key-1'")
			.first<number>('n'),
		1
	);

	console.log(
		'post-commit-tests: settle-bounded/rejection-safe/hang-checkout-once passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
