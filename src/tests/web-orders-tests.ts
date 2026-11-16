import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { CheckoutDomainError } from '../lib/server/checkout/utils';
import { listOrderQueue } from '../lib/server/orderQueue/useCase';
import { readWebOrdersConfig, parseWebOrder } from '../lib/server/webOrders/client';
import { outletForBranch, webKey, webOrderIdFromKey } from '../lib/server/webOrders/mapping';
import {
	acceptWebOrder,
	listWebOrdersForBranch,
	rejectWebOrder,
	syncWebOrderProgress
} from '../lib/server/webOrders/useCase';
import { WebOrderError } from '../lib/server/webOrders/types';
import { loadPublicMenu } from '../lib/server/webOrders/publicMenu';
import { GET as MenuGet } from '../routes/api/public/menu/+server';
import { createTestD1 } from './helpers/testD1';

const TOKEN = 'web-orders-test-token-24-chars-min';
const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const session = { userId: 'owner-web', username: 'owner', role: 'pemilik' };
const kasirSession = { userId: 'kasir-web', username: 'kasir', role: 'kasir' };
const env = {
	DB_SAMARINDA_GROUP: db,
	POS_PRICE_SIGNING_KEY: 'web-orders-test-key-32-bytes-minimum',
	POS_PRICE_SIGNING_KEY_ID: 'test',
	WEB_ORDERS_URL: 'https://pesan.example.test',
	WEB_ORDERS_TOKEN: TOKEN
};
const platform = { env } as unknown as App.Platform;

/** Situs pesan palsu: menyimpan pesanan dan status, menerapkan aturan perpindahan sederhana. */
function fakeWeb(initial: Array<Record<string, unknown>>) {
	const orders = new Map(initial.map((order) => [String(order.id), { ...order }]));
	const calls: string[] = [];
	const order = ['AWAITING_CASHIER', 'CONFIRMED', 'PREPARING', 'READY'];
	let down = false;
	const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
		if (down) throw new Error('jaringan mati');
		const headers = init?.headers as Record<string, string>;
		if (headers.authorization !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });
		const url = new URL(input);
		if (url.pathname === '/api/pos/orders') {
			const waiting = [...orders.values()].filter((o) => o.state === 'AWAITING_CASHIER');
			return Response.json({ outletId: url.searchParams.get('outlet'), orders: waiting });
		}
		const match = /\/api\/pos\/orders\/([^/]+)\/state$/.exec(url.pathname);
		if (match) {
			const body = JSON.parse(String(init?.body)) as { to: string };
			const target = orders.get(match[1]);
			if (!target) return new Response('{}', { status: 404 });
			calls.push(`${match[1]}:${body.to}`);
			const from = String(target.state);
			const legal =
				body.to === 'CANCELLED'
					? from === 'AWAITING_CASHIER'
					: order.indexOf(body.to) === order.indexOf(from) + 1;
			if (!legal) return new Response('{}', { status: 409 });
			target.state = body.to;
			return Response.json({ ok: true });
		}
		return new Response('{}', { status: 404 });
	};
	return { fetchImpl, orders, calls, setDown: (value: boolean) => (down = value) };
}

function webOrder(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		outletId: 'juanda',
		state: 'AWAITING_CASHIER',
		name: 'Haura',
		pickupNote: 'jam 3',
		note: null,
		total: 15000,
		uniqueCode: 37,
		payTotal: 15037,
		createdAt: 1,
		items: [
			{
				menuItemId: 'm1',
				name: 'Jus Web',
				qty: 1,
				unitPrice: 15000,
				size: 'REG',
				sweet: 'LESS',
				ice: 'NONE'
			}
		],
		...overrides
	};
}

try {
	// Konfigurasi: tertutup bila tidak lengkap atau tidak HTTPS.
	assert.equal(readWebOrdersConfig(undefined), null);
	assert.equal(
		readWebOrdersConfig({ WEB_ORDERS_URL: 'https://a.test', WEB_ORDERS_TOKEN: 'pendek' }),
		null
	);
	assert.equal(
		readWebOrdersConfig({ WEB_ORDERS_URL: 'http://a.test', WEB_ORDERS_TOKEN: TOKEN }),
		null,
		'token tidak boleh lewat HTTP'
	);
	assert.ok(
		readWebOrdersConfig({ WEB_ORDERS_URL: 'http://localhost:5173', WEB_ORDERS_TOKEN: TOKEN })
	);
	assert.deepEqual(
		['samarinda', 'samarinda2', 'berau', 'balikpapan', 'balikpapan2'].map(outletForBranch),
		['juanda', 'slamet-riyadi', 'merah-delima', 'mt-haryono', null]
	);
	assert.equal(webOrderIdFromKey(webKey('ZT-ABC234')), 'ZT-ABC234');
	assert.equal(webOrderIdFromKey('antrean-1'), null);

	// Parser membuang data yang tidak konsisten (nominal tidak sama dengan total + kode unik).
	assert.equal(parseWebOrder(webOrder('ZT-ABC234', { payTotal: 15000 })), null);
	assert.equal(parseWebOrder(webOrder('bukan-kode')), null);
	assert.ok(parseWebOrder(webOrder('ZT-ABC234')));

	// Produk di POS; "jus web" sengaja beda huruf besar agar pencocokan nama tidak sensitif.
	await db
		.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('p-web', 'samarinda', 'Jus  Web', 15000, 0, 0, 0, 1)`
		)
		.run();

	// Cabang tanpa pasangan atau tanpa konfigurasi: pesanan web nonaktif, bukan error.
	const off = await listWebOrdersForBranch({ env: {} } as unknown as App.Platform, samarinda);
	assert.deepEqual(off, { enabled: false, unavailable: false, orders: [] });
	await assert.rejects(
		acceptWebOrder({ env: {} } as unknown as App.Platform, samarinda, session, 'ZT-ABC234'),
		(e: unknown) => e instanceof WebOrderError && e.status === 503
	);

	// Daftar: pesanan menunggu tampil, TIDAK masuk buku kas.
	const web = fakeWeb([webOrder('ZT-ABC234')]);
	const listed = await listWebOrdersForBranch(platform, samarinda, { fetchImpl: web.fetchImpl });
	assert.equal(listed.orders.length, 1);
	assert.equal(listed.orders[0].payTotal, 15037);
	const before = await db.prepare(`SELECT COUNT(*) AS n FROM buku_kas`).first<{ n: number }>();
	assert.equal(before?.n, 0, 'pesanan menunggu bukan penjualan');

	// Situs mati: daftar kosong bertanda unavailable, tidak melempar.
	web.setDown(true);
	const down = await listWebOrdersForBranch(platform, samarinda, { fetchImpl: web.fetchImpl });
	assert.deepEqual([down.enabled, down.unavailable, down.orders.length], [true, true, 0]);
	await assert.rejects(
		acceptWebOrder(platform, samarinda, session, 'ZT-ABC234', { fetchImpl: web.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 502
	);
	web.setDown(false);

	// Kasir saat toko belum dibuka: aturan checkout POS berlaku, pesanan web tidak menembusnya.
	await assert.rejects(
		acceptWebOrder(platform, samarinda, kasirSession, 'ZT-ABC234', { fetchImpl: web.fetchImpl }),
		(e: unknown) => e instanceof CheckoutDomainError && e.status >= 400 && e.status < 500
	);
	assert.equal(web.orders.get('ZT-ABC234')?.state, 'AWAITING_CASHIER');

	// Terima: checkout QRIS nyata, kartu langsung di Diproses, omzet = harga menu (tanpa kode unik).
	const accepted = await acceptWebOrder(platform, samarinda, session, 'ZT-ABC234', {
		fetchImpl: web.fetchImpl
	});
	assert.equal(accepted.idempotent, false);
	assert.equal(accepted.webSynced, true);
	assert.equal(web.orders.get('ZT-ABC234')?.state, 'PREPARING');
	const row = await db
		.prepare(
			`SELECT nominal, metode_bayar, nama_pelanggan, preparation_started_at FROM buku_kas
			 WHERE cabang_id = 'samarinda' AND idempotency_key = ?`
		)
		.bind(webKey('ZT-ABC234'))
		.first<{
			nominal: number;
			metode_bayar: string;
			nama_pelanggan: string;
			preparation_started_at: string | null;
		}>();
	assert.equal(row?.nominal, 15000, 'omzet memakai harga menu');
	assert.equal(row?.metode_bayar, 'non-tunai');
	assert.match(row?.nama_pelanggan ?? '', /ZT-ABC234/);
	assert.ok(row?.preparation_started_at);
	const processing = await listOrderQueue(db, samarinda, { state: 'processing', limit: 50 });
	assert.ok(processing.items.some((item) => item.idempotency_key === webKey('ZT-ABC234')));
	const detail = await db
		.prepare(
			`SELECT gula, es, catatan FROM transaksi_kasir
			 WHERE buku_kas_id IN (SELECT id FROM buku_kas WHERE idempotency_key = ?)`
		)
		.bind(webKey('ZT-ABC234'))
		.first<{ gula: string | null; es: string | null; catatan: string | null }>();
	assert.ok(detail, 'baris item penjualan harus ada');
	assert.equal(detail.gula, 'less');
	assert.equal(detail.es, 'no');
	assert.match(detail.catatan ?? '', /jam 3/);

	// Terima ulang (perangkat lain / ketuk ganda): idempoten, tidak ada penjualan kedua.
	const again = await acceptWebOrder(platform, samarinda, session, 'ZT-ABC234', {
		fetchImpl: web.fetchImpl
	});
	assert.equal(again.idempotent, true);
	const count = await db
		.prepare(`SELECT COUNT(*) AS n FROM buku_kas WHERE idempotency_key = ?`)
		.bind(webKey('ZT-ABC234'))
		.first<{ n: number }>();
	assert.equal(count?.n, 1);

	// Sinkron kemajuan antrean POS ke situs pesan; kunci non-web diabaikan.
	await syncWebOrderProgress(platform, samarinda, webKey('ZT-ABC234'), 'done', {
		fetchImpl: web.fetchImpl
	});
	assert.equal(web.orders.get('ZT-ABC234')?.state, 'READY');
	const callsBefore = web.calls.length;
	await syncWebOrderProgress(platform, samarinda, 'antrean-biasa-1', 'done', {
		fetchImpl: web.fetchImpl
	});
	assert.equal(web.calls.length, callsBefore);

	// Menu tidak cocok: ditolak, tidak ada penjualan.
	const web2 = fakeWeb([
		webOrder('ZT-BBB222', {
			items: [{ menuItemId: 'x', name: 'Menu Tak Ada', qty: 1, unitPrice: 1000 }]
		})
	]);
	await assert.rejects(
		acceptWebOrder(platform, samarinda, session, 'ZT-BBB222', { fetchImpl: web2.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 422 && /Menu Tak Ada/.test(e.message)
	);

	// Harga web beda dari POS: ditolak, tidak diam-diam dipilih salah satu.
	const web3 = fakeWeb([
		webOrder('ZT-CCC333', {
			total: 14000,
			payTotal: 14012,
			uniqueCode: 12
		})
	]);
	await assert.rejects(
		acceptWebOrder(platform, samarinda, session, 'ZT-CCC333', { fetchImpl: web3.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 409
	);

	// Nama menu ganda di POS = ambigu = ditolak.
	await db
		.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('p-web-2', 'samarinda', 'jus web', 15000, 0, 0, 0, 1)`
		)
		.run();
	const web4 = fakeWeb([webOrder('ZT-DDD444')]);
	await assert.rejects(
		acceptWebOrder(platform, samarinda, session, 'ZT-DDD444', { fetchImpl: web4.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 422
	);

	// Tolak: situs pesan jadi CANCELLED; tak bisa ditolak bila sudah jadi penjualan.
	await rejectWebOrder(platform, samarinda, 'ZT-DDD444', { fetchImpl: web4.fetchImpl });
	assert.equal(web4.orders.get('ZT-DDD444')?.state, 'CANCELLED');
	await assert.rejects(
		rejectWebOrder(platform, samarinda, 'ZT-ABC234', { fetchImpl: web.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 409
	);
	await assert.rejects(
		rejectWebOrder(platform, samarinda, 'bukan-kode', { fetchImpl: web.fetchImpl }),
		(e: unknown) => e instanceof WebOrderError && e.status === 400
	);

	// Penjualan sah tetapi situs pesan gagal dikabari: daftar berikutnya menyusul statusnya.
	await db.prepare(`DELETE FROM produk WHERE id = 'p-web-2'`).run();
	const web5 = fakeWeb([webOrder('ZT-EEE555', { uniqueCode: 5, payTotal: 15005 })]);
	const flaky = async (input: string, init?: RequestInit) => {
		if (init?.method === 'POST') throw new Error('putus saat sinkron');
		return web5.fetchImpl(input, init);
	};
	const partial = await acceptWebOrder(platform, samarinda, session, 'ZT-EEE555', {
		fetchImpl: flaky
	});
	assert.equal(partial.webSynced, false);
	assert.equal(web5.orders.get('ZT-EEE555')?.state, 'AWAITING_CASHIER');
	const relist = await listWebOrdersForBranch(platform, samarinda, { fetchImpl: web5.fetchImpl });
	assert.equal(relist.orders.length, 0, 'sudah jadi penjualan: tidak muncul lagi sebagai menunggu');
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(web5.orders.get('ZT-EEE555')?.state, 'PREPARING', 'status disusul otomatis');

	// Menu publik: hanya produk aktif, harga dari POS, stok habis (bila dilacak) = tidak tersedia.
	await db.batch([
		db.prepare(
			`INSERT INTO produk (id, cabang_id, nama, harga, harga_jumbo, stok, lacak_stok, lacak_bahan, is_active)
			 VALUES ('p-m1', 'samarinda', 'Jus Menu Habis', 18000, 26000, 0, 1, 0, 1),
			        ('p-m2', 'samarinda', 'Jus Menu Nonaktif', 12000, NULL, 0, 0, 0, 0),
			        ('p-m3', 'berau', 'Jus Berau', 15000, NULL, 0, 0, 0, 1)`
		)
	]);
	const menu = await loadPublicMenu(platform, 'juanda');
	assert.equal(menu.outletId, 'juanda');
	const habis = menu.items.find((item) => item.name === 'Jus Menu Habis');
	assert.deepEqual(habis, {
		name: 'Jus Menu Habis',
		price: 18000,
		jumboPrice: 26000,
		available: false
	});
	assert.ok(menu.items.find((item) => item.name === 'Jus  Web')?.available);
	assert.equal(menu.items.find((item) => item.name === 'Jus  Web')?.jumboPrice, null);
	assert.equal(
		menu.items.some((item) => item.name === 'Jus Menu Nonaktif'),
		false
	);
	assert.equal(
		menu.items.some((item) => item.name === 'Jus Berau'),
		false,
		'tidak bocor lintas cabang'
	);
	await assert.rejects(
		loadPublicMenu(platform, 'outlet-asing'),
		(e: unknown) => e instanceof WebOrderError && e.status === 404
	);
	// Endpoint: tanpa token, token salah, dan token benar.
	const callMenu = (authorization?: string) =>
		MenuGet({
			request: new Request('https://pos.test/api/public/menu?outlet=juanda', {
				headers: authorization ? { authorization } : {}
			}),
			url: new URL('https://pos.test/api/public/menu?outlet=juanda'),
			platform
		} as never);
	await assert.rejects(callMenu(), (e: unknown) => (e as { status?: number }).status === 401);
	await assert.rejects(
		callMenu('Bearer salah-salah'),
		(e: unknown) => (e as { status?: number }).status === 401
	);
	const okResponse = await callMenu(`Bearer ${TOKEN}`);
	assert.equal(okResponse.status, 200);
	assert.equal(((await okResponse.json()) as { items: unknown[] }).items.length >= 2, true);

	console.log('web-orders-tests: kontrak pesanan web lulus');
} finally {
	await close();
}
process.exit(0);
