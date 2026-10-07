/**
 * Cetak ulang struk dari Riwayat — satu implementasi dipakai riwayat
 * umum/kasir/pemilik. Snapshot transaksi menjadi sumber tunggal bila tersedia;
 * baris transaksi lama hanya dipakai sebagai fallback historis, bukan katalog.
 * Melempar error; caller yang mengatur loading/toast/notifikasi.
 */
import { transactionService } from '$lib/services/transactionService';
import { buildReceiptHtml } from '$lib/utils/receiptPrint';
import { buildHistoryEscPosData, prepareHistoryReceipt } from '$lib/utils/historyReceipt';
import { printReceiptUnified } from '$lib/services/printerEngine';
import type { HistoryItem } from '$lib/types/laporan';

export async function printRiwayatStruk(trx: HistoryItem): Promise<void> {
	let historicalItems: Record<string, unknown>[] = [];
	if (!trx.receipt_snapshot && trx.sumber === 'pos') {
		historicalItems = await transactionService.getRows('transaksi_kasir', {
			transaction_id: trx.transaction_id || trx.id
		});
	}
	const receipt = prepareHistoryReceipt(trx, historicalItems);
	const html = buildReceiptHtml(receipt.history, receipt.settings, receipt.items);
	await printReceiptUnified({ html, receiptData: buildHistoryEscPosData(receipt) });
}
