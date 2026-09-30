/**
 * Cetak ulang struk dari Riwayat — satu implementasi dipakai riwayat
 * umum/kasir/pemilik. Sebelumnya diduplikasi verbatim di 3 halaman.
 * Melempar error; caller yang mengatur loading/toast/notifikasi.
 */
import { transactionService } from '$lib/services/transactionService';
import { buildReceiptHtml } from '$lib/utils/receiptPrint';
import { toReceiptLines } from '$lib/utils/receiptLines';
import { formatOrderDetails } from '$lib/utils/orderDetails';
import { printReceiptUnified } from '$lib/services/printerEngine';
import type { HistoryItem, ReceiptSettings } from '$lib/types/laporan';

export async function printRiwayatStruk(
	trx: HistoryItem,
	pengaturan: ReceiptSettings | null
): Promise<void> {
	let items: Record<string, unknown>[] = [];
	if (trx.sumber === 'pos') {
		items = await transactionService.getRows('transaksi_kasir', {
			transaction_id: trx.transaction_id || trx.id
		});
	}
	const html = buildReceiptHtml(trx, pengaturan, items);
	const lines = toReceiptLines(items);
	const escposData = {
		storeName: pengaturan?.nama_toko || 'Zatiaras Juice',
		address: pengaturan?.alamat,
		phone: pengaturan?.telepon,
		instagram: pengaturan?.instagram,
		customerName: trx.nama_pelanggan || '',
		dateTime: new Date(trx.waktu).toLocaleString('id-ID'),
		items:
			lines.length > 0
				? lines.map((line) => ({
						name: line.nama,
						qty: line.jumlah,
						price: line.inklusifSaja
							? line.subtotal
							: Math.round((line.baseUnit ?? 0) * line.jumlah * 100) / 100,
						addOns: line.inklusifSaja
							? []
							: line.addOns.map((a) => ({ name: a.nama, price: a.total })),
						details: formatOrderDetails(line) || undefined
					}))
				: [
						{
							name: trx.nama || 'Transaksi Kasir',
							qty: 1,
							price: Number(trx.nominal || 0)
						}
					],
		total: Number(trx.nominal || 0),
		paymentMethod: trx.metode_bayar || 'tunai',
		footerMessage: pengaturan?.ucapan
	};
	await printReceiptUnified({ html, receiptData: escposData });
}
