import { isOwnerRole, isKasirRole } from '$lib/utils/roles';
import { goto } from '$app/navigation';
import { validateNumber } from '$lib/utils/validation';
import { buildCartItemKey } from '$lib/utils/cartKey';
import { securityUtils } from '$lib/utils/security';
import { userRole } from '$lib/stores/userRole.svelte';
import { posCart } from '$lib/stores/posCart.svelte';
import {
	buildOfflineReceipt,
	buildSaleReceiptPrint,
	type CommittedReceipt
} from '$lib/utils/saleReceipt';
import { printReceiptUnified } from '$lib/services/printerEngine';
import { addPendingTransaction } from '$lib/utils/offline';
import { ErrorHandler, parseApiError } from '$lib/utils/errorHandling';
import { formatRupiah } from '$lib/utils/currency';
import { createToastManager } from '$lib/utils/ui';
import { transactionService } from '$lib/services/transactionService';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { refreshBus } from '$lib/utils/refreshBus';
import { getSesiAktif } from '$lib/services/sesiTokoService';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { productService } from '$lib/services/productService';
import { prepareCheckoutNotificationOrigin } from '$lib/services/orderNotificationService';
import { readCachedStockPolicy } from '$lib/utils/stockPolicyCache';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import {
	applyQuoteToCart,
	buildCheckoutItems,
	hasOfflinePriceTokens,
	parseCheckoutResponse,
	parseQuoteResponse
} from '$lib/utils/posCheckout';
import {
	isStrictStockEnforcement,
	isProductOutOfStock,
	getProductStockAvailability
} from '$lib/services/stockAlertService';
import type { ReceiptSettings } from '$lib/types/laporan';
import type { TokoSession } from '$lib/types/store';
import type { CartItem } from '$lib/types/cart';
import type { NotifModalType } from '$lib/types';

export function createBayarState() {
	const toastManager = createToastManager();
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
	/** Nomor antrean harian resmi; null = offline menunggu sinkron. */
	let nomorPesanan = $state<number | null>(null);
	let transactionQueuedOffline = $state(false);
	let showNotifModal = $state(false);
	let notifModalMsg = $state('');
	let notifModalType = $state<NotifModalType>('warning');
	let activeQuoteToken = $state('');
	let quoteExpiresAt = $state('');
	let quotedTotal = $state<number | null>(null);
	let committedReceipt = $state<CommittedReceipt | null>(null);

	let pengaturanStruk: ReceiptSettings | null = null;
	let sesiAktif: TokoSession | null = null;

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
		return buildCartItemKey({
			productId: item.product.id,
			porsi: item.porsi || 'reguler',
			addOnIds: item.addOns.map((addOn) => addOn.id),
			gula: item.gula,
			es: item.es,
			catatan: item.catatan
		});
	}

	function notify(message: string, type: NotifModalType) {
		notifModalMsg = message;
		notifModalType = type;
		showNotifModal = true;
	}

	function showErrorNotif(message: string) {
		toastManager.showToastNotification(message, 'error');
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
		transactionId = crypto.randomUUID();
		transactionCode = generateTransactionCode();
		nomorPesanan = null;
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

	async function prepareOnlineQuote(): Promise<'ready' | 'changed' | 'failed'> {
		const previousTotal = cartTotalHarga;
		try {
			const response = await fetchWithCsrfRetry('/api/pos/quote', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items: buildCheckoutItems(cart) })
			});
			if (!response.ok) {
				throw new Error(await parseApiError(response, `Quote gagal: HTTP ${response.status}`));
			}
			const quote = parseQuoteResponse(await response.json(), cart.length);
			cart = applyQuoteToCart(cart, quote);
			posCart.items = cart;
			activeQuoteToken = quote.quote_token;
			quoteExpiresAt = quote.expires_at;
			quotedTotal = quote.total_amount;
			committedReceipt = null;

			if (previousTotal !== quote.total_amount) {
				notify(
					`Harga berubah menjadi Rp ${formatRupiah(quote.total_amount)}. Periksa ulang pesanan lalu konfirmasi kembali.`,
					'warning'
				);
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
		if (
			isStrictStockEnforcement() &&
			readCachedStockPolicy(selectedBranch.value)?.mode !== 'ignored'
		) {
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
		if (isOffline && !hasOfflinePriceTokens(cart, localStorage.getItem('pos_catalog_expires_at'))) {
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
	function setExactCash() {
		cashReceived = (totalHarga > 0 ? totalHarga : 0).toString();
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
		if (await catatTransaksiKeLaporan()) {
			securityUtils.logSecurityEvent('payment_completed', {
				paymentMethod,
				totalAmount: totalHarga,
				cashReceived: parseInt(cashReceived.trim()),
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
			notify('Transaksi tidak valid: keranjang kosong atau total harga 0.', 'error');
			return false;
		}
		const id_sesi_toko = sesiAktif?.id || null;
		if (!id_sesi_toko && isKasirRole(currentUserRole)) {
			notify('Kasir tidak boleh melakukan transaksi saat toko tutup!', 'error');
			return false;
		}
		if (!id_sesi_toko && isOwnerRole(currentUserRole)) {
			notify(
				'PERINGATAN: Tidak ada sesi toko aktif! Transaksi akan dianggap di luar sesi dan tidak masuk ringkasan tutup toko.',
				'warning'
			);
		}
		const payment = paymentMethod === 'qris' ? 'non-tunai' : paymentMethod;
		if (!payment) {
			notify('Metode pembayaran tidak valid!', 'error');
			return false;
		}
		const requestPayload = {
			...(await prepareCheckoutNotificationOrigin()),
			idempotency_key: transactionId || crypto.randomUUID(),
			nama_pelanggan: customerName || null,
			metode_bayar: payment,
			cash_received: cashReceived ? Number(cashReceived) : null,
			items: buildCheckoutItems(cart),
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
				const result = parseCheckoutResponse(await response.json());
				committedReceipt = result.receipt;
				quotedTotal = result.total_amount;
				nomorPesanan = result.nomor_harian ?? null;
			} catch (error) {
				if (error instanceof TypeError || !navigator.onLine) {
					try {
						await queueCurrentPosTransaction({
							...requestPayload,
							mode: 'offline_replay',
							queued_at: Date.now()
						});
					} catch (queueError) {
						notify(ErrorHandler.extractErrorMessage(queueError), 'error');
						return false;
					}
					notify('Transaksi tersimpan lokal. Status: menunggu sinkronisasi.', 'success');
					transactionQueuedOffline = true;
					return true;
				}
				notify('Gagal mencatat transaksi: ' + ErrorHandler.extractErrorMessage(error), 'error');
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
				notify(ErrorHandler.extractErrorMessage(queueError), 'error');
				return false;
			}
			notify('Transaksi tersimpan lokal. Status: menunggu sinkronisasi.', 'success');
			transactionQueuedOffline = true;
		}
		return true;
	}

	function buildOfflineCommittedReceipt(): CommittedReceipt {
		return buildOfflineReceipt(cart, {
			totalAmount: totalHarga,
			totalQty,
			cashReceived: Number(cashReceived) || 0,
			paymentMethod
		});
	}

	function readQueuedStockPolicy() {
		const cached = readCachedStockPolicy(selectedBranch.value);
		return {
			epoch_token: cached?.epoch_token || undefined,
			mode: cached?.mode,
			revision: cached?.revision
		};
	}

	async function queueCurrentPosTransaction(request: Record<string, unknown>): Promise<void> {
		if (!committedReceipt) {
			committedReceipt = buildOfflineCommittedReceipt();
		}
		const queuedPolicy = readQueuedStockPolicy();
		// IndexedDB structured cloning cannot persist Svelte's reactive receipt proxies.
		await addPendingTransaction(
			$state.snapshot({
				type: 'pos_transaction',
				request: {
					...request,
					stock_policy_epoch_token: queuedPolicy.epoch_token ?? undefined,
					stock_policy_mode_at_queue: queuedPolicy.mode ?? undefined,
					stock_policy_revision_at_queue: queuedPolicy.revision ?? undefined
				},
				receipt: committedReceipt,
				summary: {
					transaction_code: transactionCode,
					total_amount: totalHarga,
					jumlah_item: totalQty,
					created_at: new Date().toISOString()
				}
			})
		);
	}

	function closeNotifModal() {
		showNotifModal = false;
	}

	function printStrukViaEscPosService() {
		void printReceiptUnified(
			buildSaleReceiptPrint({
				receipt: committedReceipt,
				cart,
				settings: pengaturanStruk,
				nomorHarian: nomorPesanan,
				customerName,
				total: totalHarga,
				paymentMethod,
				cashReceived: parseInt(cashReceived) || 0,
				change: kembalian,
				queuedOffline: transactionQueuedOffline
			})
		);
	}

	function handleAddCashTemplate(t: number) {
		addCashTemplate(t);
	}
	function handleSetExactCash() {
		setExactCash();
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
	function handleGoToAntrean() {
		showSuccessModal = false;
		clearCartStorage();
		goto('/antrean');
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
		get nomorPesanan() {
			return nomorPesanan;
		},
		get transactionQueuedOffline() {
			return transactionQueuedOffline;
		},
		toastManager,
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
		handleSetExactCash,
		setExactCash,
		handleKeypadButton,
		handleSetPaymentMethod,
		handleBackToKasir,
		handleGoToAntrean,
		clearCartStorage
	};
}
