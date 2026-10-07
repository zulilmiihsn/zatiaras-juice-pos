import type { HistoryItem, ReceiptSettings } from '$lib/types/laporan.js';
import { decodeReceiptSnapshot } from './receiptSnapshot.js';
import type { ReceiptSnapshot } from './receiptSnapshot.js';
import { formatOrderDetails } from './orderDetails.js';
import { toReceiptLines } from './receiptLines.js';
import type { buildReceiptEscPos } from './escposBuilder.js';

const UNAVAILABLE_HEADER: ReceiptSettings = {
	nama_toko: 'Header toko saat transaksi tidak tersimpan',
	ucapan: ''
};

export interface HistoryReceipt {
	history: HistoryItem;
	settings: ReceiptSettings;
	items: Array<Record<string, unknown>>;
	historyWarning: string | null;
}

function snapshotItems(snapshot: ReceiptSnapshot): Array<Record<string, unknown>> {
	return snapshot.items.map((item) => ({
		nama_produk: item.nama,
		nama_kustom: null,
		jumlah: item.jumlah,
		harga: item.harga,
		nominal: item.nominal,
		harga_dasar: item.harga_dasar,
		total_tambahan: item.total_tambahan,
		snapshot_tambahan: JSON.stringify(item.tambahan),
		gula: item.gula,
		es: item.es,
		catatan: item.catatan
	}));
}

/** Resolve a history receipt once for HTML and ESC/POS; current settings are intentionally ignored. */
export function prepareHistoryReceipt(
	transaction: HistoryItem,
	historicalItems: Array<Record<string, unknown>> = []
): HistoryReceipt {
	if (['arsip', 'archive'].includes(transaction.sumber.toLowerCase())) {
		throw new Error(
			'Ringkasan arsip bukan transaksi individual dan tidak dapat dicetak sebagai struk.'
		);
	}
	const snapshot = decodeReceiptSnapshot(transaction.receipt_snapshot);
	if (!snapshot) {
		const itemsAvailable = historicalItems.length > 0;
		const warnings = [
			'Nilai uang diterima dan kembalian tidak tersimpan pada transaksi lama.',
			'Header toko saat transaksi tidak tersimpan.',
			...(itemsAvailable ? [] : ['Detail item transaksi tidak tersedia.'])
		];
		return {
			history: {
				...transaction,
				cash_received: null,
				change: null,
				receipt_data_available: false,
				receipt_header_available: false,
				receipt_items_available: itemsAvailable
			},
			settings: UNAVAILABLE_HEADER,
			items: historicalItems,
			historyWarning: warnings.join(' ')
		};
	}

	const settings = snapshot.settings
		? {
				...snapshot.settings,
				alamat: snapshot.settings.alamat,
				telepon: snapshot.settings.telepon
			}
		: UNAVAILABLE_HEADER;
	const warnings = [
		...(snapshot.settings ? [] : ['Header toko saat transaksi tidak tersimpan.']),
		...(snapshot.metode_bayar === 'tunai' &&
		(snapshot.cash_received === null || snapshot.change === null)
			? ['Data uang diterima atau kembalian tidak tersimpan pada snapshot.']
			: [])
	];
	return {
		history: {
			...transaction,
			nominal: snapshot.total_amount,
			waktu: snapshot.committed_at || transaction.waktu,
			nama_pelanggan: snapshot.customer_name ?? transaction.nama_pelanggan,
			metode_bayar: snapshot.metode_bayar ?? transaction.metode_bayar,
			cash_received: snapshot.cash_received,
			change: snapshot.change,
			receipt_data_available: true,
			receipt_header_available: snapshot.settings !== null,
			receipt_items_available: true
		},
		settings,
		items: snapshotItems(snapshot),
		historyWarning: warnings.length > 0 ? warnings.join(' ') : null
	};
}

/** ESC/POS receives the same resolved historical values as the HTML renderer. */
export function buildHistoryEscPosData(
	receipt: HistoryReceipt
): Parameters<typeof buildReceiptEscPos>[0] {
	const { history, settings, items, historyWarning } = receipt;
	const lines = toReceiptLines(items);
	return {
		storeName: settings.nama_toko || 'Header toko tidak tersimpan',
		nomorHarian: history.nomor_harian,
		address: settings.alamat,
		phone: settings.telepon,
		instagram: settings.instagram,
		customerName: history.nama_pelanggan || '',
		dateTime: new Date(history.waktu).toLocaleString('id-ID'),
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
							: line.addOns.map((addOn) => ({ name: addOn.nama, price: addOn.total })),
						details: formatOrderDetails(line) || undefined
					}))
				: [
						{
							name: history.nama || 'Transaksi Kasir',
							qty: 1,
							price: Number(history.nominal || 0)
						}
					],
		total: Number(history.nominal || 0),
		paymentMethod: history.metode_bayar || 'tunai',
		...(typeof history.cash_received === 'number' ? { cashReceived: history.cash_received } : {}),
		...(typeof history.change === 'number' ? { change: history.change } : {}),
		footerMessage: settings.ucapan,
		historyWarning: historyWarning ?? undefined
	};
}
