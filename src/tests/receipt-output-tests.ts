import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { buildReceiptHtml, buildSaleReceiptHtml } from '../lib/utils/receiptPrint.js';
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

assert.equal(hash(reprint), '0a699f228e3ae5abe1ea203337c36ea7a59c1b284177be1e62bbdd9474a877bb');
assert.equal(hash(sale), '192a2c1fd559ba3fce3f9ed241a7742843b57d4b489ef731fbfc7e677c83181d');
console.log('Receipt HTML hashes match pre-refactor output.');
process.exit(0);
