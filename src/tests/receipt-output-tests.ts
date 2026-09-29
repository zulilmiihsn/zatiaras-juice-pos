import assert from 'node:assert/strict';
import { buildReceiptHtml, buildSaleReceiptHtml } from '../lib/utils/receiptPrint.js';
import { toReceiptLines } from '../lib/utils/receiptLines.js';
import { formatNomorHarian } from '../lib/utils/orderNumber.js';
import { formatLevelLabel, formatOrderDetails } from '../lib/utils/orderDetails.js';
import { buildReceiptEscPos } from '../lib/utils/escposBuilder.js';
import { buildLocalCardFromPending, mergeQueueWithLocal } from '../lib/utils/orderQueueLocal.js';
import { isTodayWita } from '../lib/utils/dateTime.js';
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

const nowAtWitaMidnight = new Date('2026-09-29T16:00:00.000Z');
assert.equal(isTodayWita('2026-09-29T16:00:00.000Z', nowAtWitaMidnight), true);
assert.equal(isTodayWita('2026-09-29T15:59:59.999Z', nowAtWitaMidnight), false);
assert.equal(isTodayWita('invalid', nowAtWitaMidnight), false);

assert.equal(formatNomorHarian(history.nomor_harian), '007');
assert.equal(formatNomorHarian(1000), '1000', 'lewat 999 lanjut tanpa blokir');
assert.equal(formatNomorHarian(0), null);
assert.equal(formatNomorHarian(null), null);
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
	'samarinda'
);
assert.equal(synced.length, 1, 'sinkronisasi tidak membuat pesanan kedua');
assert.equal(synced[0].nominal, 25000, 'ringkasan server memakai total transaksi');
assert.equal(synced[0].nomor_harian, 7, 'kartu sinkron memakai nomor resmi server');
assert.ok(
	new TextDecoder()
		.decode(
			buildReceiptEscPos({
				storeName: 'Toko UAT',
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
			})
		)
		.includes('No. Pesanan: 007'),
	'printer ESC/POS memuat nomor yang sama'
);
assert.ok(
	new TextDecoder()
		.decode(
			buildReceiptEscPos({
				storeName: 'Toko UAT',
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
			})
		)
		.includes('Sedikit Gula, Tanpa Es'),
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
console.log('Receipt structural contract matches post-F17/F18 output (subtotal + @ + escape).');
process.exit(0);
