import assert from 'node:assert/strict';
import {
	buildReceiptHtml,
	buildSaleReceiptHtml,
	buildSampleReceipt,
	buildRawBtIntentUrl,
	buildPrintIntentUrl
} from '../lib/utils/receiptPrint.js';
import {
	buildReceiptLayout,
	buildReceiptDocumentHtml,
	cleanReceiptText,
	wrapReceiptText,
	type ReceiptData
} from '../lib/utils/receiptLayout.js';
import { toReceiptLines } from '../lib/utils/receiptLines.js';
import { formatNomorHarian } from '../lib/utils/orderNumber.js';
import { formatLevelLabel, formatOrderDetails } from '../lib/utils/orderDetails.js';
import {
	buildReceiptEscPos,
	buildReceiptTextEscPos,
	EscPosBuilder
} from '../lib/utils/escposBuilder.js';
import {
	buildReceiptTextBlocks,
	logoRasterWidth,
	rasterizeReceiptText,
	receiptTextContent,
	toPrinterAscii,
	wrapColumns
} from '../lib/utils/receiptText.js';
import { buildHistoryEscPosData, prepareHistoryReceipt } from '../lib/utils/historyReceipt.js';
import { buildOfflineReceipt, buildSaleReceiptPrint } from '../lib/utils/saleReceipt.js';
import { parsePrinterConfig } from '../lib/utils/printerConfig.js';
import type { CartItem } from '$lib/types/cart';
import { buildLocalCardFromPending, mergeQueueWithLocal } from '../lib/utils/orderQueueLocal.js';
import { isTodayWita, rentangHariWitaUtc } from '../lib/utils/dateTime.js';
import type { HistoryItem, ReceiptSettings } from '$lib/types/laporan';

const settings: ReceiptSettings = {
	nama_toko: 'Toko UAT',
	alamat: 'Jalan UAT 1',
	telepon: '0812000000',
	instagram: '@toko.uat',
	ucapan: 'Terima kasih\nDatang kembali'
};

const history: HistoryItem = {
	id: 'history-1',
	transaction_id: 'transaction-1',
	nomor_harian: 7,
	tanggal_nomor: '2026-06-29',
	idempotency_key: '12345678-1234-4234-8234-abcdef123456',
	waktu: '2026-06-29T08:30:00.000Z',
	nama: 'Transaksi UAT',
	nominal: 25_000,
	tipe: 'in',
	sumber: 'pos',
	metode_bayar: 'tunai',
	nama_pelanggan: 'Pelanggan UAT'
};

const reprint = buildReceiptHtml(history, settings, [
	{
		nama_kustom: 'Jus UAT',
		jumlah: 2,
		harga: 12_500
	}
]);

const sale = buildSaleReceiptHtml({
	settings,
	nomorHarian: history.nomor_harian,
	items: [
		{
			product: { nama: 'Jus UAT', harga: 10_000 },
			jumlah: 2,
			addOns: [{ nama: 'Ekstra UAT', harga: 2_500 }],
			gula: 'normal',
			es: 'sedikit',
			catatan: 'UAT'
		}
	],
	customerName: 'Pelanggan UAT',
	total: 25_000,
	paymentMethod: 'tunai',
	cashReceived: 30_000,
	change: 5_000,
	queuedOffline: true,
	printedAt: new Date('2026-06-29T08:30:00.000Z')
});

const count = (s: string, sub: string) => s.split(sub).length - 1;
const receiptText = (data: ReceiptData) =>
	buildReceiptLayout(data)
		.nodes.filter((node) => node.type === 'text')
		.map((node) => node.text)
		.join(' ');

// The committed receipt snapshot wins over later catalog, ledger, and settings values.
{
	const snapshot = JSON.stringify({
		schema_version: 1,
		items: [
			{
				product_id: 'old-product',
				nama: 'Jus Harga Lama',
				jumlah: 1,
				harga: 10_000,
				nominal: 10_000,
				harga_dasar: 10_000,
				total_tambahan: 0,
				tambahan: [],
				gula: null,
				es: null,
				catatan: null
			}
		],
		total_amount: 10_000,
		total_qty: 1,
		cash_received: 12_000,
		change: 2_000,
		metode_bayar: 'tunai',
		committed_at: '2026-06-29T08:30:00.000Z',
		customer_name: 'Pelanggan Historis',
		settings: {
			nama_toko: 'Toko Saat Transaksi',
			alamat: 'Alamat Lama',
			telepon: '0811000000',
			instagram: '@toko.lama',
			ucapan: 'Terima kasih versi lama'
		}
	});
	const prepared = prepareHistoryReceipt(
		{
			...history,
			nominal: 99_000,
			metode_bayar: 'non-tunai',
			nama_pelanggan: 'Nama Sekarang',
			receipt_snapshot: snapshot
		},
		[{ nama_produk: 'Nama Katalog Baru', jumlah: 1, harga: 99_000, nominal: 99_000 }]
	);
	const historicHtml = buildReceiptHtml(prepared.history, prepared.settings, prepared.items);
	assert.ok(historicHtml.includes('Toko Saat Transaksi'));
	assert.ok(historicHtml.includes('Alamat Lama'));
	assert.ok(historicHtml.includes('Jus Harga Lama'));
	assert.ok(historicHtml.includes('Pelanggan Historis'));
	assert.ok(historicHtml.includes('Rp10.000'), 'total lama yang tersimpan dipakai');
	assert.ok(historicHtml.includes('Rp12.000'), 'uang diterima snapshot ditampilkan');
	assert.ok(historicHtml.includes('Rp2.000'), 'kembalian snapshot ditampilkan');
	assert.ok(!historicHtml.includes('Nama Katalog Baru'));
	assert.ok(!historicHtml.includes('Toko UAT'), 'pengaturan receipt masa kini tidak dipakai');

	const escpos = receiptText(buildHistoryEscPosData(prepared));
	assert.ok(escpos.includes('TOKO SAAT TRANSAKSI'));
	assert.ok(escpos.includes('Jus Harga Lama'));
	assert.ok(escpos.includes('Dibayar'));
	assert.ok(escpos.includes('12.000'));
	assert.ok(escpos.includes('Kembalian'));
	assert.ok(escpos.includes('2.000'));
}

// Snapshot fields explicitly null remain unavailable, not a fabricated zero payment/change.
{
	const prepared = prepareHistoryReceipt({
		...history,
		receipt_snapshot: JSON.stringify({
			items: [
				{
					nama: 'Jus Parsial',
					jumlah: 1,
					harga: 10_000,
					nominal: 10_000,
					harga_dasar: 10_000,
					total_tambahan: 0,
					tambahan: []
				}
			],
			total_amount: 10_000,
			total_qty: 1,
			cash_received: null,
			change: null,
			metode_bayar: 'tunai'
		})
	});
	const partialHtml = buildReceiptHtml(prepared.history, prepared.settings, prepared.items);
	assert.ok(partialHtml.includes('Tidak tersimpan'));
	assert.ok(!receiptText(buildHistoryEscPosData(prepared)).includes('Dibayar Rp0'));
}

// Legacy: use only stored transaction detail; missing header/cash/change are never fabricated.
{
	const prepared = prepareHistoryReceipt(history, [
		{ nama_produk: 'Nama Historis Tersimpan', jumlah: 1, harga: 25_000, nominal: 25_000 }
	]);
	const legacyHtml = buildReceiptHtml(prepared.history, prepared.settings, prepared.items);
	assert.ok(legacyHtml.includes('Nama Historis Tersimpan'));
	assert.ok(legacyHtml.includes('Header toko saat transaksi tidak tersimpan'));
	assert.ok(legacyHtml.includes('Data uang diterima dan kembalian tidak tersimpan'));
	assert.ok(!receiptText(buildHistoryEscPosData(prepared)).includes('Dibayar'));
	assert.ok(!receiptText(buildHistoryEscPosData(prepared)).includes('Kembalian'));
	assert.ok(prepared.historyWarning);
}

// A present but corrupt snapshot must fail closed rather than substituting current catalog data.
assert.throws(
	() =>
		prepareHistoryReceipt({ ...history, receipt_snapshot: '{broken' }, [
			{ nama_produk: 'Catalog' }
		]),
	/Snapshot struk tidak dapat dibaca/
);
assert.throws(
	() => prepareHistoryReceipt({ ...history, sumber: 'arsip' }),
	/Ringkasan arsip bukan transaksi individual/
);

const nowAtWitaMidnight = new Date('2026-09-29T16:00:00.000Z');
assert.equal(isTodayWita('2026-09-29T16:00:00.000Z', nowAtWitaMidnight), true);
assert.equal(isTodayWita('2026-09-29T15:59:59.999Z', nowAtWitaMidnight), false);
assert.equal(isTodayWita('invalid', nowAtWitaMidnight), false);
// Satu sumber definisi "N hari terakhir" untuk Selesai Antrean dan Riwayat.
assert.deepEqual(rentangHariWitaUtc(1, '2026-09-30'), {
	startUtc: '2026-09-29T16:00:00.000Z',
	endUtc: '2026-09-30T15:59:59.999Z'
});
assert.deepEqual(rentangHariWitaUtc(7, '2026-09-30'), {
	startUtc: '2026-09-23T16:00:00.000Z',
	endUtc: '2026-09-30T15:59:59.999Z'
});
assert.deepEqual(rentangHariWitaUtc(0, '2026-09-30'), {
	startUtc: '2026-09-29T16:00:00.000Z',
	endUtc: '2026-09-30T15:59:59.999Z'
});

assert.equal(formatNomorHarian(history.nomor_harian), '007');
assert.equal(formatNomorHarian(1000), '1000', 'lewat 999 lanjut tanpa blokir');
assert.equal(formatNomorHarian(0), null);
assert.equal(formatNomorHarian(null), null);
// The official order number must be the visual focal point on both thermal paper sizes.
for (const paperSize of ['58mm', '80mm'] as const) {
	for (const reprint of [false, true]) {
		for (const nomorHarian of [1, 7, 27, 148, 999, 1000]) {
			const sample = buildSampleReceipt(settings, new Date('2026-06-29T08:30:00.000Z'));
			const layout = buildReceiptLayout({ ...sample, nomorHarian, reprint }, paperSize);
			const label = layout.nodes.find(
				(node) => node.type === 'text' && node.text === 'NOMOR PESANAN'
			);
			const number = layout.nodes.find(
				(node) => node.type === 'text' && node.text === formatNomorHarian(nomorHarian)
			);
			const customer = layout.nodes.find(
				(node) => node.type === 'text' && node.text === sample.customerName
			);
			assert.ok(label?.type === 'text', 'order number has a separate, clearly named label');
			assert.ok(number?.type === 'text', 'official number appears as its own untruncated text');
			assert.ok(customer?.type === 'text');
			assert.equal(number.align, 'center');
			assert.equal(number.x, layout.width / 2);
			assert.equal(number.bold, true);
			assert.ok(number.size >= 40, 'order number stays readable at a glance');
			assert.ok(number.size > label.size);
			assert.ok(number.y > label.y);
			assert.ok(number.y + number.size < customer.y, 'number and customer details never overlap');
		}
	}
	for (const queuedOffline of [false, true]) {
		const sample = buildSampleReceipt(settings, new Date('2026-06-29T08:30:00.000Z'));
		const layout = buildReceiptLayout({ ...sample, nomorHarian: null, queuedOffline }, paperSize);
		const texts = layout.nodes.filter((node) => node.type === 'text').map((node) => node.text);
		assert.ok(texts.includes('NOMOR PESANAN'));
		assert.ok(texts.includes(queuedOffline ? 'Menunggu sinkronisasi' : 'Belum tersedia'));
		assert.ok(!texts.includes('000'), 'missing official numbers are never fabricated');
	}
}
// Label level gula/es Indonesia; alias legacy ikut terpetakan, normal disembunyikan.
assert.equal(formatLevelLabel('gula', 'less'), 'Sedikit Gula');
assert.equal(formatLevelLabel('gula', 'no'), 'Tanpa Gula');
assert.equal(formatLevelLabel('es', 'less'), 'Sedikit Es');
assert.equal(formatLevelLabel('es', 'no'), 'Tanpa Es');
assert.equal(formatLevelLabel('gula', 'kurang'), 'Sedikit Gula');
assert.equal(formatLevelLabel('es', 'tanpa'), 'Tanpa Es');
assert.equal(formatLevelLabel('gula', 'normal'), null);
assert.equal(formatLevelLabel('es', null), null);
assert.equal(formatLevelLabel('gula', '  LESS  '), 'Sedikit Gula');
assert.equal(formatLevelLabel('gula', 'manis banget'), 'manis banget', 'tak dikenal lolos utuh');
assert.equal(
	formatOrderDetails({ gula: 'less', es: 'no', catatan: 'UAT' }),
	'Sedikit Gula, Tanpa Es, UAT'
);
assert.ok(reprint.includes('No. Pesanan: 007'), 'cetak ulang memuat nomor harian');
assert.ok(sale.includes('No. Pesanan: 007'), 'struk awal memuat nomor harian');
const offlineSale = buildSaleReceiptHtml({
	settings,
	nomorHarian: null,
	items: [],
	customerName: 'Pelanggan UAT',
	total: 25_000,
	paymentMethod: 'tunai',
	cashReceived: 25_000,
	change: 0,
	queuedOffline: true,
	printedAt: new Date('2026-06-29T08:30:00.000Z')
});
assert.ok(
	offlineSale.includes('No. Pesanan: menunggu sinkronisasi'),
	'struk offline tanpa nomor resmi menandai menunggu sinkron'
);
const pending = {
	type: 'pos_transaction',
	branch: 'samarinda',
	request: { idempotency_key: history.idempotency_key },
	receipt: { total_amount: 25000, items: [{ nama: 'Jus UAT', jumlah: 1 }] },
	summary: { created_at: history.waktu }
};
const localCard = buildLocalCardFromPending(pending, 'samarinda');
assert.equal(localCard?.nomor_harian, null, 'kartu lokal belum punya nomor resmi');
assert.equal(localCard?.nominal, 25000, 'ringkasan offline memakai total struk tersimpan');
assert.equal(
	localCard?.preparation_state,
	'processing',
	'checkout langsung Diproses di server, jadi kartu offline tidak boleh mulai di Masuk'
);
assert.equal(
	buildLocalCardFromPending(
		{ ...pending, receipt: { items: [{ nama: 'Jus UAT', jumlah: 1 }] } },
		'samarinda'
	)?.nominal,
	null,
	'total yang hilang tidak ditampilkan sebagai Rp0'
);
const synced = mergeQueueWithLocal(
	[
		{
			buku_kas_id: 'bk-1',
			transaction_id: history.transaction_id!,
			idempotency_key: history.idempotency_key!,
			nama_pelanggan: 'Pelanggan UAT',
			waktu: history.waktu,
			metode_bayar: 'tunai',
			nominal: 25000,
			jumlah: 1,
			nomor_harian: 7,
			tanggal_nomor: '2026-06-29',
			preparation_state: 'pending',
			preparation_revision: 0,
			preparation_completed_at: null,
			preparation_completed_by: null,
			items: []
		}
	],
	[pending],
	[],
	'samarinda',
	'fixture-user'
);
assert.equal(synced.length, 1, 'sinkronisasi tidak membuat pesanan kedua');
assert.equal(synced[0].nominal, 25000, 'ringkasan server memakai total transaksi');
assert.equal(synced[0].nomor_harian, 7, 'kartu sinkron memakai nomor resmi server');
assert.ok(
	receiptText({
		storeName: 'Toko UAT',
		dateTime: '29/06/26 08.30',
		nomorHarian: history.nomor_harian,
		items: [
			{
				name: 'Jus UAT',
				qty: 1,
				price: 25000,
				details: formatOrderDetails({ gula: 'kurang', es: 'no', catatan: null })
			}
		],
		total: 25000,
		paymentMethod: 'tunai'
	}).includes('NOMOR PESANAN 007'),
	'printer ESC/POS memuat nomor yang sama'
);
assert.ok(
	receiptText({
		storeName: 'Toko UAT',
		dateTime: '29/06/26 08.30',
		nomorHarian: history.nomor_harian,
		items: [
			{
				name: 'Jus UAT',
				qty: 1,
				price: 25000,
				details: formatOrderDetails({ gula: 'kurang', es: 'no', catatan: null })
			}
		],
		total: 25000,
		paymentMethod: 'tunai'
	}).includes('Sedikit Gula, Tanpa Es'),
	'printer ESC/POS memuat label level Indonesia'
);

// F17/F18: base 10.000 + topping 3.000 x2 -> baris 20.000 + 6.000 = 26.000
{
	const lines = toReceiptLines([
		{
			nama_produk: 'Jus Beku',
			nama_kustom: null,
			produk: { nama: 'Jus Baru' },
			jumlah: 2,
			nominal: 26_000,
			harga: 13_000,
			harga_dasar: 10_000,
			total_tambahan: 3_000,
			snapshot_tambahan: JSON.stringify([{ nama: 'Nata', harga: 3_000 }])
		}
	]);
	assert.equal(lines.length, 1);
	assert.equal(lines[0].nama, 'Jus Beku');
	assert.equal(lines[0].subtotal, 26_000);
	assert.equal(lines[0].inklusifSaja, false);
	assert.equal(lines[0].addOns.length, 1);
	assert.equal(lines[0].addOns[0].total, 6_000);
	assert.equal(lines[0].baseUnit !== null && lines[0].baseUnit * 2 + 6_000, 26_000);
}
// Snapshot beku menang atas katalog terbaru; custom fallback; nominal 0 sah.
{
	const lines = toReceiptLines([
		{ nama_produk: null, nama_kustom: 'Custom UAT', jumlah: 1, nominal: 5_000, harga: 5_000 },
		{ jumlah: 1, nominal: 0, harga: 0 }
	]);
	assert.equal(lines[0].nama, 'Custom UAT');
	assert.equal(lines[1].subtotal, 0);
	assert.equal(lines[1].nama, 'Produk Custom');
}
// Legacy inklusif tanpa breakdown: subtotal utuh, tanpa tebak topping.
{
	const lines = toReceiptLines([{ nama_kustom: 'Lama', jumlah: 2, harga: 10_000 }]);
	assert.equal(lines[0].subtotal, 20_000);
	assert.equal(lines[0].inklusifSaja, true);
	assert.equal(lines[0].addOns.length, 0);
}
// Nama numerik sah tidak dibuang.
{
	const lines = toReceiptLines([{ nama_produk: '123', jumlah: 1, nominal: 5_000, harga: 5_000 }]);
	assert.equal(lines[0].nama, '123');
}
// R07: render HTML fixture topping — baris dasar + topping = subtotal, tanpa ganda.
{
	const toppingHtml = buildReceiptHtml(history, settings, [
		{
			nama_produk: 'Jus Beku',
			nama_kustom: null,
			jumlah: 2,
			nominal: 26_000,
			harga: 13_000,
			harga_dasar: 10_000,
			total_tambahan: 3_000,
			snapshot_tambahan: JSON.stringify([{ nama: 'Nata', harga: 3_000 }]),
			gula: 'less',
			es: 'no',
			catatan: 'Dingin ya'
		}
	]);
	assert.ok(toppingHtml.includes('Jus Beku'), 'nama snapshot tampil');
	assert.ok(toppingHtml.includes('Rp20.000'), 'baris dasar 10.000x2');
	assert.ok(toppingHtml.includes('Rp6.000'), 'baris topping 3.000x2');
	assert.equal(count(toppingHtml, 'Rp26.000'), 0, 'subtotal inklusif tak tampil ganda');
	assert.ok(toppingHtml.includes('Rp25.000'), 'total header ikut nominal transaksi');
	assert.ok(toppingHtml.includes('Sedikit Gula'), 'cetak ulang memetakan level gula');
	assert.ok(toppingHtml.includes('Tanpa Es'), 'cetak ulang memetakan level es');
	assert.ok(!toppingHtml.includes('>less<'), 'nilai mentah less tak tampil');
}

// F17/F18 structural contract (portabel lintas OS/Node/ICU):
// jangan hash seluruh HTML karena toLocaleString('id-ID') berbeda antar runtime.
// Verifikasi subtotal, handle @, dan escaping secara eksplisit.
{
	assert.ok(reprint.includes('Jus UAT'), 'reprint memuat nama item');
	assert.ok(reprint.includes('Rp25.000'), 'reprint memuat total transaksi');
	assert.ok(reprint.includes('@toko.uat'), 'reprint memuat handle @');
	assert.ok(reprint.includes('Terima kasih'), 'reprint memuat ucapan');
	assert.ok(!reprint.includes('<script'), 'reprint tidak memuat tag mentah');
}
{
	assert.ok(sale.includes('Jus UAT'), 'sale memuat nama produk');
	assert.ok(sale.includes('Ekstra UAT'), 'sale memuat topping');
	assert.ok(sale.includes('Rp20.000'), 'sale memuat baris dasar 10.000x2');
	assert.ok(sale.includes('Rp5.000'), 'sale memuat baris topping 2.500x2');
	assert.ok(sale.includes('Rp25.000'), 'sale memuat total');
	assert.ok(sale.includes('Rp30.000'), 'sale memuat uang dibayar');
	assert.ok(sale.includes('MENUNGGU SINKRONISASI'), 'sale menandai antrean offline');
	assert.ok(sale.includes('@toko.uat'), 'sale memuat handle @');
}
{
	// Escaping: input berbahaya tidak boleh menjadi HTML aktif.
	const evil = buildReceiptHtml(history, settings, [
		{ nama_kustom: '<script>alert(1)</script>', jumlah: 1, harga: 1_000 }
	]);
	assert.ok(!evil.includes('<script>'), 'tag script di-escape');
	assert.ok(evil.includes('&lt;script&gt;'), 'escape entity tampil');
	assert.equal(count(evil, 'Rp1.000') >= 1, true, 'subtotal evil tetap tampil');
}
{
	// Struk penjualan POS: snapshot offline dan data cetak dari satu sumber.
	const cart: CartItem[] = [
		{
			product: { id: 9, nama: 'Jus Mangga', harga: 10_000, harga_jumbo: 14_000, tipe: 'minuman' },
			jumlah: 2,
			porsi: 'jumbo',
			addOns: [{ id: 3, nama: 'Keju', harga: 2_000 }],
			gula: 'less',
			es: '',
			catatan: ''
		}
	];
	const committedAt = new Date('2026-06-29T08:30:00.000Z');
	const offline = buildOfflineReceipt(
		cart,
		{ totalAmount: 32_000, totalQty: 2, cashReceived: 50_000, paymentMethod: 'tunai' },
		committedAt
	);
	assert.deepEqual(offline.items[0], {
		product_id: '9',
		nama: 'Jus Mangga',
		jumlah: 2,
		harga: 16_000,
		nominal: 32_000,
		harga_dasar: 14_000,
		total_tambahan: 2_000,
		tambahan: [{ id: '3', nama: 'Keju', harga: 2_000 }],
		gula: 'less',
		es: null,
		catatan: null
	});
	assert.equal(offline.change, 18_000, 'kembalian tunai');
	assert.equal(offline.committed_at, committedAt.toISOString());
	const qris = buildOfflineReceipt(cart, {
		totalAmount: 32_000,
		totalQty: 2,
		cashReceived: 50_000,
		paymentMethod: 'qris'
	});
	assert.equal(qris.metode_bayar, 'non-tunai', 'QRIS tercatat non-tunai');
	assert.equal(qris.change, 0, 'non-tunai tanpa kembalian');

	// Struk komit menang atas nilai keranjang; header kosong diberi tanda, bukan header terkini.
	const printed = buildSaleReceiptPrint({
		receipt: offline,
		cart: [],
		settings,
		nomorHarian: null,
		customerName: '',
		total: 1,
		paymentMethod: 'qris',
		cashReceived: 1,
		change: 1,
		queuedOffline: true
	});
	assert.equal(printed.receiptData.storeName, 'Header toko saat transaksi tidak tersimpan');
	assert.equal(printed.receiptData.customerName, 'Pelanggan');
	assert.equal(printed.receiptData.total, 32_000);
	assert.equal(printed.receiptData.paymentMethod, 'tunai');
	assert.equal(printed.receiptData.change, 18_000);
	assert.deepEqual(
		printed.receiptData.items.map(({ name, qty, price, addOns }) => ({ name, qty, price, addOns })),
		[{ name: 'Jus Mangga', qty: 2, price: 28_000, addOns: [{ name: 'Keju', price: 4_000 }] }],
		'harga dasar dan topping terpisah, tidak ganda'
	);
	assert.ok(printed.html.includes('MENUNGGU SINKRONISASI'));
	assert.ok(printed.html.includes('Rp28.000') && printed.html.includes('Rp4.000'));

	// Tanpa struk komit: keranjang terbuka + pengaturan terkini, porsi jumbo diberi label.
	const draft = buildSaleReceiptPrint({
		receipt: null,
		cart,
		settings,
		nomorHarian: 12,
		customerName: 'Budi',
		total: 32_000,
		paymentMethod: 'tunai',
		cashReceived: 40_000,
		change: 8_000,
		queuedOffline: false
	});
	assert.equal(draft.receiptData.storeName, 'Toko UAT');
	assert.equal(draft.receiptData.footerMessage, settings.ucapan);
	assert.equal(draft.receiptData.items[0].name, 'Jus Mangga (Jumbo)');
	assert.equal(draft.receiptData.items[0].price, 28_000);
	assert.equal(draft.receiptData.change, 8_000);
	assert.ok(draft.html.includes('Budi') && draft.html.includes('Toko UAT'));
}
// Long names must wrap completely; printer firmware must never decide column alignment.
for (const paperSize of ['58mm', '80mm'] as const) {
	const sample = buildSampleReceipt(settings, new Date('2026-06-29T08:30:00.000Z'));
	const layout = buildReceiptLayout(sample, paperSize);
	assert.equal(layout.width, paperSize === '80mm' ? 576 : 384);
	assert.ok(
		layout.nodes.some((node) => node.type === 'logo'),
		'every transport receives the logo'
	);
	const html = buildReceiptDocumentHtml(sample, paperSize);
	assert.ok(html.includes(`size:${paperSize === '80mm' ? 80 : 58}mm`));
	assert.ok(html.includes(`width:${paperSize === '80mm' ? 72 : 48}mm`));
	assert.equal(
		sample.total,
		sample.items.reduce(
			(total, item) =>
				total + item.price + (item.addOns ?? []).reduce((sum, addOn) => sum + addOn.price, 0),
			0
		)
	);
	assert.equal(sample.change, sample.cashReceived! - sample.total);
	const bytesPerRow = layout.width / 8;
	const bitmap = {
		width: layout.width,
		height: 257,
		bytes: Uint8Array.from({ length: bytesPerRow * 257 }, (_, i) => i % 256)
	};
	const encoded = buildReceiptEscPos(bitmap);
	const rawBt = buildRawBtIntentUrl(encoded);
	const rawBtSuffix = '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
	assert.ok(rawBt.startsWith('intent:base64,'));
	assert.ok(rawBt.endsWith(rawBtSuffix));
	assert.deepEqual(
		new Uint8Array(
			Buffer.from(rawBt.slice('intent:base64,'.length, -rawBtSuffix.length), 'base64')
		),
		encoded
	);
	assert.deepEqual([...encoded.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x61, 0]);
	let offset = 5;
	let row = 0;
	while (row < bitmap.height) {
		assert.deepEqual([...encoded.slice(offset, offset + 4)], [0x1d, 0x76, 0x30, 0]);
		assert.equal(encoded[offset + 4] + encoded[offset + 5] * 256, bytesPerRow);
		const rows = encoded[offset + 6] + encoded[offset + 7] * 256;
		assert.equal(rows, Math.min(128, bitmap.height - row));
		offset += 8;
		assert.deepEqual(
			encoded.slice(offset, offset + rows * bytesPerRow),
			bitmap.bytes.slice(row * bytesPerRow, (row + rows) * bytesPerRow)
		);
		offset += rows * bytesPerRow;
		row += rows;
	}
	assert.deepEqual([...encoded.slice(offset)], [10, 10, 10, 0x1d, 0x56, 0x41, 0x10]);
}
{
	// Blank gaps are fed, not sent, and decoding the stream must give back the exact same image.
	const bytesPerRow = 48;
	const height = 700;
	const bytes = new Uint8Array(bytesPerRow * height);
	const inkRows = [0, 1, 2, 30, 31, 32, 40, 41, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309];
	for (const r of inkRows) bytes.fill(0xaa, r * bytesPerRow, (r + 1) * bytesPerRow);
	const encoded = buildReceiptEscPos({ width: 384, height, bytes });
	assert.ok(encoded.length < bytes.length / 4, 'blank gaps must not be sent as image rows');
	const decoded = new Uint8Array(bytes.length);
	let offset = 5;
	let row = 0;
	const end = encoded.length - 7;
	while (offset < end) {
		if (encoded[offset] === 0x1b && encoded[offset + 1] === 0x4a) {
			row += encoded[offset + 2];
			offset += 3;
			continue;
		}
		assert.deepEqual([...encoded.slice(offset, offset + 4)], [0x1d, 0x76, 0x30, 0]);
		const rows = encoded[offset + 6] + encoded[offset + 7] * 256;
		assert.ok(rows >= 1 && rows <= 128);
		decoded.set(encoded.slice(offset + 8, offset + 8 + rows * bytesPerRow), row * bytesPerRow);
		offset += 8 + rows * bytesPerRow;
		row += rows;
	}
	assert.equal(row, height);
	assert.deepEqual(decoded, bytes);
	// A fully blank image becomes feed commands only.
	const blank = buildReceiptEscPos({ width: 384, height: 600, bytes: new Uint8Array(48 * 600) });
	assert.deepEqual(
		[...blank],
		[
			0x1b, 0x40, 0x1b, 0x61, 0, 0x1b, 0x4a, 255, 0x1b, 0x4a, 255, 0x1b, 0x4a, 90, 10, 10, 10
		].concat([0x1d, 0x56, 0x41, 0x10])
	);
}
{
	// Kolom nama_toko boleh NULL di database; struk tidak boleh gagal atau berkepala kosong.
	const printedAt = new Date('2026-06-29T08:30:00.000Z');
	for (const missing of [null, undefined, '', '   ']) {
		const data = buildSampleReceipt(
			{ ...settings, nama_toko: missing as unknown as string },
			printedAt
		);
		assert.equal(data.storeName, 'Zatiaras Juice', `nama_toko ${JSON.stringify(missing)}`);
		assert.doesNotThrow(() => buildReceiptLayout(data));
	}
	assert.equal(
		buildSampleReceipt({ ...settings, nama_toko: '  Toko UAT ' }, printedAt).storeName,
		'Toko UAT'
	);
}
for (const value of [
	'a'.repeat(1000),
	'Alamat toko sangat panjang '.repeat(15),
	'\u00c9lodie Cafe\u0301 \u6d4b\u8bd5 '.repeat(10)
]) {
	const lines = wrapReceiptText(value, 30, (s) => Array.from(s).length);
	assert.ok(lines.every((line) => Array.from(line).length <= 30));
	assert.equal(lines.join('').replaceAll(' ', ''), cleanReceiptText(value).replaceAll(' ', ''));
}
assert.equal(cleanReceiptText('Pelanggan\u001b@\u001dV\u0000'), 'Pelanggan@V');
assert.throws(
	() => buildReceiptEscPos({ width: 385, height: 1, bytes: new Uint8Array(48) }),
	/Gambar struk tidak valid/
);
assert.throws(
	() => buildReceiptEscPos({ width: 384, height: 2, bytes: new Uint8Array(48) }),
	/Gambar struk tidak valid/
);
assert.throws(
	() => buildReceiptEscPos({ width: 384, height: 0, bytes: new Uint8Array() }),
	/Gambar struk tidak valid/
);
{
	const intent = await buildPrintIntentUrl(sale);
	assert.ok(intent.startsWith('intent://#Intent;scheme=print-intent;S.content='));
	const content = intent.split('S.content=')[1].split(';end')[0];
	const { ungzip } = await import('pako');
	assert.deepEqual(JSON.parse(new TextDecoder().decode(ungzip(Buffer.from(content, 'base64')))), [
		sale
	]);
}
assert.deepEqual(parsePrinterConfig({ method: 'intent', paperSize: '58mm' }), {
	method: 'intent',
	paperSize: '58mm',
	printMode: 'image',
	deviceName: ''
});
assert.equal(parsePrinterConfig({ printMode: 'text' }).printMode, 'text');
assert.equal(parsePrinterConfig({ printMode: 'raw' }).printMode, 'image');

// Printer-font receipt: ASCII only, fits the 32/48 columns, and carries the same amounts.
assert.equal(toPrinterAscii('Café “Ñam” – 2×\u0007 测试'), 'Cafe "Nam" - 2x ??');
assert.deepEqual(wrapColumns('  Catatan sangat panjang sekali', 12), [
	'  Catatan',
	'  sangat',
	'  panjang',
	'  sekali'
]);
assert.deepEqual(wrapColumns('ABCDEFGHIJKLMNOP', 6), ['ABCDEF', 'GHIJKL', 'MNOP']);
{
	const data = buildSampleReceipt(
		{ nama_toko: 'Zatiaras Juice', alamat: 'Jalan Panjang '.repeat(6), ucapan: 'Terima kasih' },
		new Date('2026-10-25T02:30:00.000Z')
	);
	data.items[0].name = 'Jus Mangga Jumbo dengan nama sangat panjang sekali';
	data.items[0].details = 'Catatan\n<script>\u001b@</script> Café';
	for (const paperSize of ['58mm', '80mm'] as const) {
		// One normal-size space (12 dots) stays blank on each side, like the image layout's padding.
		const columns = paperSize === '80mm' ? 46 : 30;
		const blocks = buildReceiptTextBlocks(data, paperSize);
		const lines = blocks.flatMap((block) => (block.type === 'text' ? [block] : []));
		for (const line of lines) {
			assert.ok(line.text.length * line.scale <= columns, `${line.text} fits ${paperSize}`);
			assert.match(line.text, /^[\x20-\x7e]*$/);
		}
		const content = receiptTextContent(blocks).join('\n');
		for (const expected of ['NOMOR PESANAN', '007', 'Rp39.000', 'Rp50.000', 'Rp11.000', 'Rp4.000'])
			assert.ok(content.includes(expected), `${expected} on ${paperSize}`);
		assert.equal(lines.find((line) => line.text === '007')?.scale, 3);
		const width = logoRasterWidth(paperSize);
		const logo = { width, height: 96, bytes: new Uint8Array((width / 8) * 96) };
		const bytes = buildReceiptTextEscPos(blocks, logo);
		// Only the logo raster may carry bytes outside printable ASCII and the known commands.
		assert.ok(bytes.length < 4_000 + logo.bytes.length, `${bytes.length} bytes on ${paperSize}`);
		assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 0x41, 0x10]);
		// With every glyph dot inked, nothing may reach the outer 12 dots of the head.
		const solid = (code: number) => new Uint8Array(48).fill(code === 0x20 ? 0 : 0xff);
		const paper = rasterizeReceiptText(blocks, logo, paperSize, solid);
		const perRow = paper.width / 8;
		let edgeInk = 0;
		let contentInk = 0;
		for (let r = 0; r < paper.height; r++)
			for (let x = 0; x < paper.width; x++) {
				const inked = paper.bytes[r * perRow + (x >> 3)] & (0x80 >> (x & 7));
				if (!inked) continue;
				if (x < 12 || x >= paper.width - 12) edgeInk++;
				else contentInk++;
			}
		assert.equal(edgeInk, 0, `text touches the paper edge on ${paperSize}`);
		assert.ok(contentInk > 0);
	}
}
assert.throws(() => new EscPosBuilder().text('a\u001bb'), /karakter tidak dikenal/);
assert.throws(() => new EscPosBuilder().scale(9), /Ukuran huruf/);
assert.equal(parsePrinterConfig({ androidApp: 'rawbt' }).androidApp, 'rawbt');
assert.equal(parsePrinterConfig({ androidApp: 'print-intent' }).androidApp, 'print-intent');
assert.equal(parsePrinterConfig({ androidApp: 'unknown' }).androidApp, undefined);
console.log('Receipt structural contract matches post-F17/F18 output (subtotal + @ + escape).');
process.exit(0);
