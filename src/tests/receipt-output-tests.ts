import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildReceiptHtml, buildSaleReceiptHtml } from '../lib/utils/receiptPrint.js';
import { toReceiptLines } from '../lib/utils/receiptLines.js';
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

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

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
			snapshot_tambahan: JSON.stringify([{ nama: 'Nata', harga: 3_000 }])
		}
	]);
	const count = (s: string, sub: string) => s.split(sub).length - 1;
	assert.ok(toppingHtml.includes('Jus Beku'), 'nama snapshot tampil');
	assert.ok(toppingHtml.includes('Rp20.000'), 'baris dasar 10.000x2');
	assert.ok(toppingHtml.includes('Rp6.000'), 'baris topping 3.000x2');
	assert.equal(count(toppingHtml, 'Rp26.000'), 0, 'subtotal inklusif tak tampil ganda');
	assert.ok(toppingHtml.includes('Rp25.000'), 'total header ikut nominal transaksi');
}

assert.equal(hash(reprint), '7773c4dfeecf8e1f5ad9ae67a8b9a1f37403c1981a187c11e131d651bd852115');
assert.equal(hash(sale), '192a2c1fd559ba3fce3f9ed241a7742843b57d4b489ef731fbfc7e677c83181d');
console.log('Receipt HTML hashes match post-F17/F18 output (subtotal + @ + escape).');
process.exit(0);
