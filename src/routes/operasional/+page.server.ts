import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	closeKioskShift,
	openKioskShift,
	parseKioskSession,
	readKioskSession,
	submitKioskSale
} from '$lib/server/kioskSession';
import { decodeReceiptSnapshot } from '$lib/utils/receiptSnapshot';
import { SESSION_COOKIE } from '$lib/server/sessionStore';
export const load: PageServerLoad = async ({ cookies, platform, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'private, no-store' });
	const scope = parseKioskSession(cookies.get(SESSION_COOKIE));
	const user = scope && (await readKioskSession(platform, cookies, scope));
	if (!user) redirect(303, '/login');
	return { user, operationId: crypto.randomUUID() };
};
export const actions: Actions = {
	sale: async ({ request, cookies, platform }) => {
		const scope = parseKioskSession(cookies.get(SESSION_COOKIE));
		if (!scope) redirect(303, '/login');
		const fields = await request.formData();
		const id = fields.get('id'),
			shiftId = fields.get('shiftId'),
			payment = fields.get('payment'),
			cash = Number(fields.get('cash'));
		const ids = fields.getAll('productId'),
			quantities = fields.getAll('qty'),
			prices = fields.getAll('unitPrice'),
			portions = fields.getAll('portion');
		const lines = ids.flatMap((productId, index) => {
			const qty = Number(quantities[index]),
				unitPrice = Number(prices[index]);
			const portion = portions[index],
				addOnIds = fields
					.getAll('extra-' + index)
					.filter((value): value is string => typeof value === 'string');
			return (portion === 'reguler' || portion === 'jumbo') &&
				addOnIds.length <= 10 &&
				typeof productId === 'string' &&
				productId.length > 0 &&
				productId.length <= 128 &&
				Number.isInteger(qty) &&
				qty >= 1 &&
				qty <= 99 &&
				Number.isSafeInteger(unitPrice) &&
				unitPrice > 0
				? [{ productId, qty, unitPrice, portion, addOnIds }]
				: [];
		});
		if (
			typeof id !== 'string' ||
			!/^[-\w]{8,114}$/.test(id) ||
			typeof shiftId !== 'string' ||
			!/^[-\w]{1,128}$/.test(shiftId) ||
			!lines.length ||
			lines.length > 20 ||
			lines.length !== ids.length ||
			ids.length !== quantities.length ||
			ids.length !== prices.length ||
			ids.length !== portions.length ||
			(payment !== 'tunai' && payment !== 'qris') ||
			(payment === 'qris' && fields.get('qrisConfirmed') !== 'yes') ||
			!Number.isSafeInteger(cash) ||
			cash < 0
		)
			return fail(400, { message: 'Periksa data pembayaran.' });
		try {
			const result = await submitKioskSale(platform, cookies, scope, {
				id,
				shiftId,
				lines,
				payment,
				cash
			});
			if (!result) return fail(401, { message: 'Sesi kios telah berakhir.' });
			if (result.status === 'rejected')
				return fail(409, {
					message: typeof result.message === 'string' ? result.message : 'Penjualan ditolak.',
					saleId: id
				});
			if (result.status === 'recorded' || result.status === 'replayed') {
				const receipt = decodeReceiptSnapshot(result.receipt);
				if (receipt)
					return {
						message: 'Penjualan tercatat di kios. Sinkronisasi pusat terpisah.',
						receipt,
						receiptId: id,
						orderNumber: result.orderNumber
					};
			}
		} catch {
			// The coordinator may have committed before the response was lost.
		}
		return fail(503, {
			message:
				'Status pembayaran belum terkonfirmasi. Jangan buat transaksi baru; ulangi data yang sama.',
			saleId: id
		});
	},
	close: async ({ request, cookies, platform }) => {
		const scope = parseKioskSession(cookies.get(SESSION_COOKIE));
		if (!scope) redirect(303, '/login');
		const form = await request.formData();
		const id = form.get('id');
		if (typeof id !== 'string' || !/^[-\w]{1,128}$/.test(id) || form.get('confirm') !== 'yes')
			return fail(400, { message: 'Konfirmasi penutupan shift diperlukan.' });
		const result = await closeKioskShift(platform, cookies, scope, id, form.get('pin'));
		if (!result) redirect(303, '/login');
		switch (result.status) {
			case 'closed':
				return { message: 'Shift ditutup. Laporan pusat belum disinkronkan.' };
			case 'replayed':
				return { message: 'Shift itu sudah ditutup sebelumnya.' };
			case 'conflict':
				return fail(409, { message: 'Shift aktif sudah berubah. Periksa status kios.' });
			default:
				return fail(403, {
					message: 'PIN tutup toko belum terverifikasi. Periksa PIN atau coba lagi nanti.'
				});
		}
	},
	open: async ({ request, cookies, platform }) => {
		const scope = parseKioskSession(cookies.get(SESSION_COOKIE));
		if (!scope) redirect(303, '/login');
		const form = await request.formData();
		const raw = form.get('openingCash'),
			id = form.get('id');
		if (
			typeof raw !== 'string' ||
			!/^\d+$/.test(raw) ||
			!Number.isSafeInteger(Number(raw)) ||
			typeof id !== 'string' ||
			!/^[-\w]{1,128}$/.test(id)
		)
			return fail(400, { message: 'Periksa nominal modal awal.' });
		const result = await openKioskShift(platform, cookies, scope, id, Number(raw), form.get('pin'));
		if (!result) redirect(303, '/login');
		switch (result.status) {
			case 'replayed':
				return { message: 'Permintaan buka shift sudah diproses sebelumnya. Cek status kios.' };
			case 'opened':
			case 'already-open':
				return {
					message:
						'Pembukaan shift terkonfirmasi. Modal awal Rp' +
						Number(raw).toLocaleString('id-ID') +
						'.'
				};
			case 'conflict':
				return fail(409, {
					message: 'Modal berbeda dengan pembukaan sebelumnya. Tidak ada perubahan.'
				});
			case 'policy-blocked':
				return fail(403, {
					message: 'PIN buka toko belum terverifikasi. Periksa PIN atau coba lagi nanti.'
				});
			default:
				return fail(503, { message: 'Cabang belum dialihkan. Tidak ada shift baru.' });
		}
	}
};
