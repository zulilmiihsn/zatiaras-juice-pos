import { goto } from '$app/navigation';
import { v4 as uuidv4 } from 'uuid';
import { validateNumber, sanitizeInput } from '$lib/utils/validation';
import { securityUtils } from '$lib/utils/security';
import { userRole } from '$lib/stores/userRole.svelte';
import { posCart } from '$lib/stores/posCart.svelte';
import { buildSaleReceiptHtml } from '$lib/utils/receiptPrint';
import { printReceiptUnified } from '$lib/services/printerEngine';
import { addPendingTransaction } from '$lib/utils/offline';
import { ErrorHandler, parseApiError } from '$lib/utils/errorHandling';
import { formatRupiah } from '$lib/utils/currency';
import { NOTIF } from '$lib/constants/ui';
import { transactionService } from '$lib/services/transactionService';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { refreshBus } from '$lib/utils/refreshBus';
import { getSesiAktif } from '$lib/services/sesiTokoService';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { productService } from '$lib/services/productService';
import {
	isStrictStockEnforcement,
	isProductOutOfStock,
	getProductStockAvailability
} from '$lib/services/stockAlertService';
import type { ReceiptSettings } from '$lib/types/laporan';
import type { TokoSession } from '$lib/types/store';
import type { CartItem } from '$lib/types/cart';
import type { NotifModalType } from '$lib/components/shared/NotifModal.svelte';

interface QuoteLine {
	source: Record<string, unknown>;
	product_name: string;
	product_price: number;
	add_ons: Array<{ id: string; nama: string; harga: number }>;
	line_total: number;
}

interface QuoteResponse {
	ok: boolean;
	quote_token: string;
	expires_at: string;
	items: QuoteLine[];
	total_amount: number;
	total_qty: number;
}

interface CommittedReceipt {
	items: Array<{
		product_id: string | null;
		nama: string;
		jumlah: number;
		harga: number;
		nominal: number;
		tambahan: Array<{ id: string; nama: string; harga: number }>;
		gula: string | null;
		es: string | null;
		catatan: string | null;
	}>;
	total_amount: number;
	total_qty: number;
	cash_received: number;
	change: number;
	metode_bayar: string;
	committed_at: string;
}

interface CheckoutResponse {
	ok: boolean;
	data?: {
		buku_kas_id: string;
		transaction_id: string;
		total_amount: number;
		total_qty: number;
		change: number;
		receipt: CommittedReceipt;
	};
}

export function createBayarState() {
	let cart = $state<CartItem[]>([]);
	let customerName = $state('');
	let paymentMethod = $state('');
	let isOffline = $state(false);
	let showCancelModal = $state(false);
	let showCashModal = $state(false);
	let cashReceived = $state('');
	let showSuccessModal = $state(false);
	let showQrisWarning = $state(false);
	let transactionId = $state('');
	let transactionCode = $state('');
	let transactionQueuedOffline = $state(false);
	let showErrorNotification = $state(false);
	let errorNotificationMessage = $state('');
	let showNotifModal = $state(false);
	let notifModalMsg = $state('');
	let notifModalType = $state<NotifModalType>('warning');
	let activeQuoteToken = $state('');
	let quoteExpiresAt = $state('');
	let quotedTotal = $state<number | null>(null);
	let committedReceipt = $state<CommittedReceipt | null>(null);

	let pengaturanStruk: ReceiptSettings | null = null;
	let sesiAktif: TokoSession | null = null;
	let errorNotificationTimeout: number | null = null;

	const currentUserRole = $derived(userRole.value || '');

	const totalQty = $derived(cart.reduce((sum, item) => sum + item.jumlah, 0));
	const cartTotalHarga = $derived(
		cart.reduce((sum, item) => {
			const isJumbo = item.porsi === 'jumbo';
			const basePrice = isJumbo
				? (item.product.harga_jumbo ?? item.product.harga ?? 0)
				: (item.product.harga ?? 0);
			let itemTotal = item.jumlah * basePrice;
			if (item.addOns) {
				itemTotal += item.addOns.reduce(
					(total, addOn) => total + (addOn.harga ?? 0) * item.jumlah,
					0
				);
			}
			return sum + itemTotal;
		}, 0)
	);
	const totalHarga = $derived(quotedTotal ?? cartTotalHarga);
	const kembalian = $derived(
		committedReceipt?.change ?? (parseInt(cashReceived) || 0) - totalHarga
	);
	const formattedCashReceived = $derived(cashReceived ? formatRupiah(parseInt(cashReceived)) : '');
	const canPay = $derived(
		Boolean(
			paymentMethod &&
			customerName.trim() &&
			cart.length > 0 &&
			(!isOffline || paymentMethod === 'tunai')
		)
	);

	function cartItemKey(item: CartItem): string {
		return [
			item.product.id,
			item.addOns
				.map((addOn) => addOn.id)
				.sort()
				.join(','),
			item.gula,
			item.es,
			item.catatan
		].join('|');
	}

	function showErrorNotif(message: string) {
		errorNotificationMessage = message;
		showErrorNotification = true;
		if (errorNotificationTimeout !== null) clearTimeout(errorNotificationTimeout);
		errorNotificationTimeout = window.setTimeout(() => {
			showErrorNotification = false;
		}, NOTIF.TOAST_MS);
	}

	function generateTransactionCode() {
		let lastNum = parseInt(localStorage.getItem('last_jus_id') || '0', 10);
		lastNum++;
		localStorage.setItem('last_jus_id', lastNum.toString());
		return `JUS${lastNum.toString().padStart(5, '0')}`;
	}

	async function cekSesiTokoAktif() {
		sesiAktif = await getSesiAktif();
	}

	async function fetchPengaturanStruk() {
		try {
			const data = (await transactionService.getOne(
				'pengaturan'
			)) as unknown as ReceiptSettings | null;
			if (data) {
				pengaturanStruk = data;
				localStorage.setItem('pengaturan_struk', JSON.stringify(data));
			} else {
				const local = localStorage.getItem('pengaturan_struk');
				if (local) pengaturanStruk = JSON.parse(local);
			}
		} catch {
			const local = localStorage.getItem('pengaturan_struk');
			if (local) pengaturanStruk = JSON.parse(local);
		}
	}

	function init() {
		cart = [...posCart.items];
		transactionId = uuidv4();
		transactionCode = generateTransactionCode();
		cekSesiTokoAktif();
		fetchPengaturanStruk();
	}

	function clearCartStorage(): void {
		cart = [];
		posCart.clearCart();
	}

	function handleCancel() {
		showCancelModal = true;
	}
	function confirmCancel() {
		showCancelModal = false;
		clearCartStorage();
		goto('/pos');
	}
	function closeModal() {
		showCancelModal = false;
	}

	function buildItemInputs() {
		return cart.map((item) => {
			const isCustom = item.product.id.toString().startsWith('custom-');
			return {
				product_id: isCustom ? null : item.product.id,
				nama_kustom: isCustom ? item.product.nama : null,
				custom_price: isCustom ? (item.product.harga ?? 0) : null,
				jumlah: item.jumlah,
				add_on_ids: (item.addOns || []).map((addOn) => addOn.id),
				porsi: item.porsi || 'reguler',
				gula: item.gula || null,
				es: item.es || null,
				catatan: item.catatan || null,
				product_price_token: isCustom ? null : item.product.price_token || null,
				add_on_price_tokens: (item.addOns || [])
					.map((addOn) => addOn.price_token)
					.filter((token): token is string => Boolean(token))
			};
		});
	}

	function hasValidOfflinePricing(): boolean {
		const expiresAt = Date.parse(localStorage.getItem('pos_catalog_expires_at') || '');
		if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
		return cart.every((item) => {
			const isCustom = item.product.id.toString().startsWith('custom-');
			return (
				(isCustom || Boolean(item.product.price_token)) &&
				(item.addOns || []).every((addOn) => Boolean(addOn.price_token))
			);
		});
	}

	async function prepareOnlineQuote(): Promise<'ready' | 'changed' | 'failed'> {
		const previousTotal = cartTotalHarga;
		try {
			const response = await fetchWithCsrfRetry('/api/pos/quote', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: buildItemInputs() })
			});
			if (!response.ok) {
				throw new Error(await parseApiError(response, `Quote gagal: HTTP ${response.status}`));
			}
			const quote = (await response.json()) as QuoteResponse;
			if (
				!quote.ok ||
				!quote.quote_token ||
				!Array.isArray(quote.items) ||
				!Number.isFinite(quote.total_amount) ||
				quote.items.length !== cart.length
			) {
				throw new Error('Respons quote POS tidak valid');
			}

			cart = cart.map((item, index) => {
				const quoted = quote.items[index];
				return {
					...item,
					product: {
						...item.product,
						nama: quoted.product_name,
						harga: quoted.product_price
					},
					addOns: quoted.add_ons.map((addOn) => ({
						...item.addOns.find((existing) => String(existing.id) === String(addOn.id)),
						...addOn,
						is_active: true
					}))
				};
			});
			posCart.items = cart;
			activeQuoteToken = quote.quote_token;
			quoteExpiresAt = quote.expires_at;
			quotedTotal = quote.total_amount;
			committedReceipt = null;

			if (previousTotal !== quote.total_amount) {
				notifModalMsg = `Harga berubah menjadi Rp ${formatRupiah(quote.total_amount)}. Periksa ulang pesanan lalu konfirmasi kembali.`;
				notifModalType = 'warning';
				showNotifModal = true;
				return 'changed';
			}
			return 'ready';
		} catch (error) {
			activeQuoteToken = '';
			quoteExpiresAt = '';
			quotedTotal = null;
			showErrorNotif(ErrorHandler.extractErrorMessage(error));
			return 'failed';
		}
	}

	async function handleBayar() {
		if (isStrictStockEnforcement()) {
			try {
				const catalog = await productService.getPosCatalog();
				for (const item of cart) {
					const avail = getProductStockAvailability(
						item.product,
						item.porsi || 'reguler',
						catalog.ingredients || [],
						catalog.recipes || []
					);
					if (avail.isOutOfStock) {
						showErrorNotif(
							`Stok menu "${item.product.nama}" habis (${avail.limitingReason || 'bahan baku tidak cukup'}). Transaksi tidak dapat dilanjutkan.`
						);
						return;
					}
				}
			} catch {
				const outOfStockItem = cart.find((item) => isProductOutOfStock(item.product));
				if (outOfStockItem) {
					showErrorNotif(
						`Stok menu "${outOfStockItem.product.nama}" habis. Transaksi tidak dapat dilanjutkan.`
					);
					return;
				}
			}
		}
		if (isOffline && paymentMethod !== 'tunai') {
			showErrorNotif('Saat offline, pembayaran hanya tersedia untuk tunai.');
			return;
		}
		if (isOffline && !hasValidOfflinePricing()) {
			showErrorNotif('Katalog harga offline tidak valid atau kedaluwarsa. Hubungkan perangkat.');
			return;
		}
		if (!isOffline) {
			const quoteStatus = await prepareOnlineQuote();
			if (quoteStatus !== 'ready') return;
		}
		if (paymentMethod === 'tunai') {
			showCashModal = true;
			cashReceived = '';
		} else {
			showQrisWarning = true;
		}
	}
	async function confirmQrisChecked() {
		if (!activeQuoteToken || Date.parse(quoteExpiresAt) <= Date.now()) {
			showQrisWarning = false;
			showErrorNotif('Quote harga kedaluwarsa. Konfirmasi pembayaran ulang.');
			return;
		}
		showQrisWarning = false;
		cashReceived = totalHarga.toString();
		const success = await catatTransaksiKeLaporan();
		if (success) {
			clearCartStorage();
			showSuccessModal = true;
		}
	}
	function addCashTemplate(nom: number) {
		cashReceived = ((parseInt(cashReceived) || 0) + nom).toString();
	}
	function closeCashModal() {
		showCashModal = false;
	}
	async function finishCash() {
		const cashValidation = validateNumber(cashReceived, { required: true, min: totalHarga });
		if (!cashValidation.isValid) {
			showErrorNotif(`Error: ${cashValidation.errors.join(', ')}`);
			return;
		}
		if (!securityUtils.checkFormRateLimit('payment_completion')) {
			showErrorNotif('Terlalu banyak transaksi. Silakan tunggu sebentar.');
			return;
		}
		const sanitizedCashReceived = sanitizeInput(cashReceived);
		const sanitizedPaymentMethod = sanitizeInput(paymentMethod);
		const allInputs = `${sanitizedCashReceived}${sanitizedPaymentMethod}${totalHarga}`;
		if (securityUtils.detectSuspiciousActivity('payment_completion', allInputs)) {
			showErrorNotif('Aktivitas pembayaran mencurigakan terdeteksi. Silakan coba lagi.');
			securityUtils.logSecurityEvent('suspicious_payment_activity', {
				cashReceived: sanitizedCashReceived,
				paymentMethod: sanitizedPaymentMethod,
				totalHarga
			});
			return;
		}
		if (await catatTransaksiKeLaporan()) {
			securityUtils.logSecurityEvent('payment_completed', {
				paymentMethod: sanitizedPaymentMethod,
				totalAmount: totalHarga,
				cashReceived: parseInt(sanitizedCashReceived),
				change: kembalian,
				itemsCount: cart.length,
				queuedOffline: transactionQueuedOffline
			});
			clearCartStorage();
			showCashModal = false;
			showSuccessModal = true;
		}
	}
	function handleKeypad(val: string | number) {
		if (val === '⌫') {
			cashReceived = cashReceived.slice(0, -1);
		} else {
			cashReceived = (cashReceived + val).replace(/^0+(?!$)/, '');
		}
	}

	async function catatTransaksiKeLaporan(): Promise<boolean> {
		transactionQueuedOffline = false;
		await cekSesiTokoAktif();
		if (!cart || cart.length === 0 || totalHarga <= 0) {
			notifModalMsg = 'Transaksi tidak valid: keranjang kosong atau total harga 0.';
			notifModalType = 'error';
			showNotifModal = true;
			return false;
		}
		const id_sesi_toko = sesiAktif?.id || null;
		if (!id_sesi_toko && currentUserRole === 'kasir') {
			notifModalMsg = 'Kasir tidak boleh melakukan transaksi saat toko tutup!';
			notifModalType = 'error';
			showNotifModal = true;
			return false;
		}
		if (!id_sesi_toko && currentUserRole === 'pemilik') {
			notifModalMsg =
				'PERINGATAN: Tidak ada sesi toko aktif! Transaksi akan dianggap di luar sesi dan tidak masuk ringkasan tutup toko.';
			notifModalType = 'warning';
			showNotifModal = true;
		}
		const payment = paymentMethod === 'qris' ? 'non-tunai' : paymentMethod;
		if (!payment) {
			notifModalMsg = 'Metode pembayaran tidak valid!';
			notifModalType = 'error';
			showNotifModal = true;
			return false;
		}
		const requestPayload = {
			idempotency_key: transactionId || uuidv4(),
			nama_pelanggan: customerName || null,
			metode_bayar: payment,
			cash_received: cashReceived ? Number(cashReceived) : null,
			items: buildItemInputs(),
			mode: 'online' as const,
			quote_token: activeQuoteToken,
			store_session_id: id_sesi_toko
		};
		if (navigator.onLine) {
			try {
				const response = await fetchWithCsrfRetry('/api/pos/transaction', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(requestPayload)
				});
				if (!response.ok) {
					throw new Error(await parseApiError(response, `HTTP ${response.status}`));
				}
				const result = (await response.json()) as CheckoutResponse;
				if (
					!result.ok ||
					!result.data ||
					!Number.isFinite(result.data.total_amount) ||
					!result.data.receipt
				) {
					throw new Error('Respons transaksi POS tidak valid');
				}
				committedReceipt = result.data.receipt;
				quotedTotal = result.data.total_amount;
			} catch (error) {
				if (error instanceof TypeError || !navigator.onLine) {
					try {
						await queueCurrentPosTransaction({
							...requestPayload,
							mode: 'offline_replay',
							queued_at: Date.now()
						});
					} catch (queueError) {
						notifModalMsg = ErrorHandler.extractErrorMessage(queueError);
						notifModalType = 'error';
						showNotifModal = true;
						return false;
					}
					notifModalMsg = 'Transaksi tersimpan lokal. Status: menunggu sinkronisasi.';
					notifModalType = 'success';
					showNotifModal = true;
					transactionQueuedOffline = true;
					return true;
				}
				notifModalMsg = 'Gagal mencatat transaksi: ' + ErrorHandler.extractErrorMessage(error);
				notifModalType = 'error';
				showNotifModal = true;
				return false;
			}
			await cacheOrchestrator.invalidateCacheOnChange('buku_kas');
			await cacheOrchestrator.invalidateCacheOnChange('transaksi_kasir');
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await cacheOrchestrator.invalidateCacheOnChange('produk');
			refreshBus.emit('dashboard');
			refreshBus.emit('stok');
		} else {
			try {
				committedReceipt = buildOfflineCommittedReceipt();
				await queueCurrentPosTransaction({
					...requestPayload,
					mode: 'offline_replay',
					quote_token: undefined,
					queued_at: Date.now()
				});
			} catch (queueError) {
				notifModalMsg = ErrorHandler.extractErrorMessage(queueError);
				notifModalType = 'error';
				showNotifModal = true;
				return false;
			}
			notifModalMsg = 'Transaksi tersimpan lokal. Status: menunggu sinkronisasi.';
			notifModalType = 'success';
			showNotifModal = true;
			transactionQueuedOffline = true;
		}
		return true;
	}

	function buildOfflineCommittedReceipt(): CommittedReceipt {
		const cash = Number(cashReceived) || 0;
		return {
			items: cart.map((item) => {
				const isJumbo = item.porsi === 'jumbo';
				const prod = item.product;
				const basePrice = isJumbo ? (prod.harga_jumbo ?? prod.harga ?? 0) : (prod.harga ?? 0);
				const addOnsTotal = (item.addOns || []).reduce((sum, a) => sum + (a.harga || 0), 0);
				const unitPrice = basePrice + addOnsTotal;
				return {
					product_id: item.product.id ? String(item.product.id) : null,
					nama: item.product.nama,
					jumlah: item.jumlah,
					harga: unitPrice,
					nominal: unitPrice * item.jumlah,
					tambahan: (item.addOns || []).map((a) => ({
						id: String(a.id),
						nama: a.nama,
						harga: a.harga
					})),
					gula: item.gula || null,
					es: item.es || null,
					catatan: item.catatan || null
				};
			}),
			total_amount: totalHarga,
			total_qty: totalQty,
			cash_received: cash,
			change: paymentMethod === 'tunai' && cash > totalHarga ? cash - totalHarga : 0,
			metode_bayar: paymentMethod === 'qris' ? 'non-tunai' : paymentMethod,
			committed_at: new Date().toISOString()
		};
	}

	async function queueCurrentPosTransaction(request: Record<string, unknown>): Promise<void> {
		if (!committedReceipt) {
			committedReceipt = buildOfflineCommittedReceipt();
		}
		await addPendingTransaction({
			type: 'pos_transaction',
			request,
			receipt: committedReceipt,
			summary: {
				transaction_code: transactionCode,
				total_amount: totalHarga,
				jumlah_item: totalQty,
				created_at: new Date().toISOString()
			}
		});
	}

	function closeNotifModal() {
		showNotifModal = false;
	}

	function printStrukViaEscPosService() {
		const receiptItems = committedReceipt
			? committedReceipt.items.map((item) => ({
					product: {
						id: item.product_id ?? '',
						nama: item.nama,
						harga: item.harga,
						harga_jumbo: undefined,
						tipe: 'produk' as const
					},
					jumlah: item.jumlah,
					porsi: undefined as 'reguler' | 'jumbo' | undefined,
					addOns: item.tambahan,
					gula: item.gula || '',
					es: item.es || '',
					catatan: item.catatan || ''
				}))
			: cart;

		const receiptInput = {
			settings: pengaturanStruk,
			items: receiptItems,
			customerName,
			total: committedReceipt?.total_amount ?? totalHarga,
			paymentMethod: committedReceipt?.metode_bayar ?? paymentMethod,
			cashReceived: committedReceipt?.cash_received ?? (parseInt(cashReceived) || 0),
			change: committedReceipt?.change ?? kembalian,
			queuedOffline: transactionQueuedOffline,
			printedAt: committedReceipt?.committed_at
				? new Date(committedReceipt.committed_at)
				: undefined
		};

		const html = buildSaleReceiptHtml(receiptInput);
		const escposData = {
			storeName: pengaturanStruk?.nama_toko || 'Zatiaras Juice',
			address: pengaturanStruk?.alamat,
			phone: pengaturanStruk?.telepon,
			instagram: pengaturanStruk?.instagram,
			customerName: customerName || 'Pelanggan',
			dateTime: (receiptInput.printedAt ?? new Date()).toLocaleString('id-ID'),
			items: receiptItems.map((item) => {
				const isJumbo = item.porsi === 'jumbo';
				const prod = item.product;
				const basePrice = isJumbo ? (prod.harga_jumbo ?? prod.harga ?? 0) : (prod.harga ?? 0);
				const porsiSuffix =
					isJumbo && !item.product.nama.toLowerCase().includes('jumbo') ? ' (Jumbo)' : '';
				return {
					name: `${item.product.nama}${porsiSuffix}`,
					qty: item.jumlah,
					price: basePrice * item.jumlah,
					addOns: (item.addOns || []).map((a) => ({
						name: a.nama,
						price: (a.harga ?? 0) * item.jumlah
					})),
					details: [item.gula, item.es, item.catatan].filter(Boolean).join(', ')
				};
			}),
			total: receiptInput.total,
			paymentMethod: receiptInput.paymentMethod,
			cashReceived: receiptInput.cashReceived,
			change: receiptInput.change,
			footerMessage: pengaturanStruk?.ucapan,
			queuedOffline: receiptInput.queuedOffline
		};

		void printReceiptUnified({ html, receiptData: escposData });
	}

	function handleAddCashTemplate(t: number) {
		addCashTemplate(t);
	}
	function handleKeypadButton(key: string | number) {
		if (key === 'C') cashReceived = '';
		else handleKeypad(key);
	}
	function handleSetPaymentMethod(id: string) {
		if (isOffline && id !== 'tunai') {
			showErrorNotif('QRIS membutuhkan koneksi internet.');
			return;
		}
		paymentMethod = id;
	}
	function handleBackToKasir() {
		showSuccessModal = false;
		clearCartStorage();
		goto('/pos');
	}
	function setOffline(value: boolean) {
		isOffline = value;
		if (isOffline) {
			activeQuoteToken = '';
			quoteExpiresAt = '';
			quotedTotal = null;
			if (paymentMethod && paymentMethod !== 'tunai') paymentMethod = 'tunai';
		}
	}

	return {
		get cart() {
			return cart;
		},
		set cart(v) {
			cart = v;
		},
		get customerName() {
			return customerName;
		},
		set customerName(v) {
			customerName = v;
		},
		get paymentMethod() {
			return paymentMethod;
		},
		set paymentMethod(v) {
			paymentMethod = v;
		},
		get isOffline() {
			return isOffline;
		},
		set isOffline(v) {
			isOffline = v;
		},
		get showCancelModal() {
			return showCancelModal;
		},
		get showCashModal() {
			return showCashModal;
		},
		get cashReceived() {
			return cashReceived;
		},
		set cashReceived(v) {
			cashReceived = v;
		},
		get showSuccessModal() {
			return showSuccessModal;
		},
		get showQrisWarning() {
			return showQrisWarning;
		},
		get transactionId() {
			return transactionId;
		},
		set transactionId(v) {
			transactionId = v;
		},
		get transactionCode() {
			return transactionCode;
		},
		set transactionCode(v) {
			transactionCode = v;
		},
		get transactionQueuedOffline() {
			return transactionQueuedOffline;
		},
		get showErrorNotification() {
			return showErrorNotification;
		},
		get errorNotificationMessage() {
			return errorNotificationMessage;
		},
		get showNotifModal() {
			return showNotifModal;
		},
		set showNotifModal(v) {
			showNotifModal = v;
		},
		get notifModalMsg() {
			return notifModalMsg;
		},
		get notifModalType() {
			return notifModalType;
		},
		get currentUserRole() {
			return currentUserRole;
		},
		get totalQty() {
			return totalQty;
		},
		get totalHarga() {
			return totalHarga;
		},
		get kembalian() {
			return kembalian;
		},
		get formattedCashReceived() {
			return formattedCashReceived;
		},
		get canPay() {
			return canPay;
		},
		cartItemKey,
		init,
		setOffline,
		cekSesiTokoAktif,
		fetchPengaturanStruk,
		generateTransactionCode,
		handleCancel,
		confirmCancel,
		closeModal,
		handleBayar,
		confirmQrisChecked,
		addCashTemplate,
		closeCashModal,
		finishCash,
		handleKeypad,
		closeNotifModal,
		printStrukViaEscPosService,
		handleAddCashTemplate,
		handleKeypadButton,
		handleSetPaymentMethod,
		handleBackToKasir,
		clearCartStorage
	};
}
