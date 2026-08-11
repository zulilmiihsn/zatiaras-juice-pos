<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import { validateNumber, validateText, sanitizeInput } from '$lib/utils/validation';
	import { securityUtils } from '$lib/utils/security';
	import { getSupabaseClient } from '$lib/database/supabaseClient';
	import { v4 as uuidv4 } from 'uuid';
	import { formatWitaDateTime, getNowWita, witaToUtcISO } from '$lib/utils/dateTime';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { userRole } from '$lib/stores/userRole';
	import { get as storeGet } from 'svelte/store';
	import { selectedBranch } from '$lib/stores/selectedBranch';
	import * as pako from 'pako';
	import { Base64 } from 'js-base64';
	import { executePrint } from '$lib/utils/printHelper';
	import { memoize } from '$lib/utils/performance';
	import { addPendingTransaction } from '$lib/utils/offline';
	import { ErrorHandler } from '$lib/utils/errorHandling';
	import { dataService } from '$lib/services/dataService';
	import type { CartItem } from '$lib/types/product';
	import KeypadModal from '$lib/components/pos/keypadModal.svelte';

	let cart: CartItem[] = [];
	let customerName = '';
	let paymentMethod = '';
	const paymentOptions = [
		{ id: 'tunai', label: 'Tunai' },
		{ id: 'qris', label: 'QRIS' }
	];
	let showCancelModal = false;
	let showCashModal = false;
	let cashReceived = '';
	const cashTemplates = [5000, 10000, 20000, 50000, 100000];
	let keypad = [
		[1, 2, 3],
		[4, 5, 6],
		[7, 8, 9],
		['⌫', 0, 'C']
	];
	let showSuccessModal = false;
	let showQrisWarning = false;
	let transactionId = '';
	let transactionCode = '';

	let showErrorNotification = false;
	let errorNotificationMessage = '';
	let errorNotificationTimeout: any = null;
	let showSuccessNotification = false;
	let successNotificationMessage = '';
	let successNotificationTimeout: any = null;

	let showNoSessionModal = false;
	let noSessionModalMsg = '';

	let currentUserRole = '';
	userRole.subscribe((val) => (currentUserRole = val || ''));

	let showNotifModal = false;
	let notifModalMsg = '';
	let notifModalType = 'warning'; // 'warning' | 'success' | 'error'

	let pengaturanStruk: any = null;

	function showErrorNotif(message: string) {
		errorNotificationMessage = message;
		showErrorNotification = true;
		clearTimeout(errorNotificationTimeout);
		errorNotificationTimeout = setTimeout(() => {
			showErrorNotification = false;
		}, 3000);
	}

	function showSuccessNotif(message: string) {
		successNotificationMessage = message;
		showSuccessNotification = true;
		clearTimeout(successNotificationTimeout);
		successNotificationTimeout = setTimeout(() => {
			showSuccessNotification = false;
		}, 3000);
	}

	function generateTransactionCode() {
		// Ambil nomor urut terakhir dari localStorage
		let lastNum = parseInt(localStorage.getItem('last_jus_id') || '0', 10);
		lastNum++;
		localStorage.setItem('last_jus_id', lastNum.toString());
		return `JUS${lastNum.toString().padStart(5, '0')}`;
	}

	let sesiAktif: any = null;
	async function cekSesiTokoAktif() {
		const { data } = await getSupabaseClient(storeGet(selectedBranch))
			.from('sesi_toko')
			.select('*')
			.eq('is_active', true)
			.order('opening_time', { ascending: false })
			.limit(1)
			.maybeSingle();
		sesiAktif = data || null;
	}

	async function fetchPengaturanStruk() {
		try {
			const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('pengaturan')
				.select('*')
				.eq('id', 1)
				.single();
			if (data) {
				pengaturanStruk = data;
			} else if (error) {
				// fallback ke localStorage
				const local = localStorage.getItem('pengaturan_struk');
				if (local) pengaturanStruk = JSON.parse(local);
			}
		} catch {
			const local = localStorage.getItem('pengaturan_struk');
			if (local) pengaturanStruk = JSON.parse(local);
		}
	}

	onMount(() => {
		cekSesiTokoAktif();
		fetchPengaturanStruk();
		const saved = localStorage.getItem('pos_cart');
		if (saved) {
			try {
				cart = JSON.parse(saved);
			} catch {}
		}
		transactionId = uuidv4(); // UUID untuk database
		transactionCode = generateTransactionCode(); // Untuk tampilan/struk
	});

	const calculateCartSummary = memoize((cart: any) => {
		let totalQty = 0;
		let totalHarga = 0;
		for (const item of cart) {
			totalQty += item.qty;
			totalHarga += item.qty * (item.product.price ?? item.product.harga ?? 0);
			if (item.addOns) {
				totalHarga += item.addOns.reduce(
					(a: any, b: any) => a + (b.price ?? b.harga ?? 0) * item.qty,
					0
				);
			}
		}
		return { totalQty, totalHarga };
	});

	$: ({ totalQty, totalHarga } = calculateCartSummary(cart));
	$: kembalian = (parseInt(cashReceived) || 0) - totalHarga;
	$: formattedCashReceived = cashReceived ? parseInt(cashReceived).toLocaleString('id-ID') : '';

	function handleCancel() {
		showCancelModal = true;
	}
	function confirmCancel() {
		showCancelModal = false;
		goto('/pos');
	}
	function closeModal() {
		showCancelModal = false;
	}
	function handleBayar() {
		if (paymentMethod === 'tunai') {
			showCashModal = true;
			cashReceived = '';
		} else {
			// Non-tunai: tampilkan modal warning dulu
			showQrisWarning = true;
		}
	}
	function confirmQrisChecked() {
		showQrisWarning = false;
		showSuccessModal = true;
		cashReceived = totalHarga.toString(); // QRIS = dibayar pas
		kembalian = 0;
		// Catat ke laporan
		catatTransaksiKeLaporan();
	}
	function addCashTemplate(nom: any) {
		cashReceived = ((parseInt(cashReceived) || 0) + nom).toString();
	}
	function closeCashModal() {
		showCashModal = false;
	}
	function finishCash() {
		// Validate cash received
		const cashValidation = validateNumber(cashReceived, { required: true, min: totalHarga });
		if (!cashValidation.isValid) {
			showErrorNotif(`Error: ${cashValidation.errors.join(', ')}`);
			return;
		}

		// Check rate limiting
		if (!securityUtils.checkFormRateLimit('payment_completion')) {
			showErrorNotif('Terlalu banyak transaksi. Silakan tunggu sebentar.');
			return;
		}

		// Sanitize inputs
		const sanitizedCashReceived = sanitizeInput(cashReceived);
		const sanitizedPaymentMethod = sanitizeInput(paymentMethod);

		// Check for suspicious activity
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

		// Log successful payment
		securityUtils.logSecurityEvent('payment_completed', {
			paymentMethod: sanitizedPaymentMethod,
			totalAmount: totalHarga,
			cashReceived: parseInt(sanitizedCashReceived),
			change: kembalian,
			itemsCount: cart.length
		});

		// Proses pembayaran tunai selesai
		showCashModal = false;
		showSuccessModal = true;
		// Catat ke laporan
		catatTransaksiKeLaporan();
	}
	function handleKeypad(val: any) {
		if (val === '⌫') {
			cashReceived = cashReceived.slice(0, -1);
		} else {
			cashReceived = (cashReceived + val).replace(/^0+(?!$)/, '');
		}
	}

	function getLocalOffsetString() {
		const offset = -new Date().getTimezoneOffset();
		const sign = offset >= 0 ? '+' : '-';
		const pad = (n: any) => n.toString().padStart(2, '0');
		const hours = pad(Math.floor(Math.abs(offset) / 60));
		const minutes = pad(Math.abs(offset) % 60);
		return `${sign}${hours}:${minutes}`;
	}

	async function catatTransaksiKeLaporan() {
		await cekSesiTokoAktif();
		if (!cart || cart.length === 0 || totalHarga <= 0) {
			notifModalMsg = 'Transaksi tidak valid: keranjang kosong atau total harga 0.';
			notifModalType = 'error';
			showNotifModal = true;
			return;
		}
		const id_sesi_toko = sesiAktif?.id || null;
		if (!id_sesi_toko && currentUserRole === 'kasir') {
			notifModalMsg = 'Kasir tidak boleh melakukan transaksi saat toko tutup!';
			notifModalType = 'error';
			showNotifModal = true;
			return;
		}
		if (!id_sesi_toko && currentUserRole === 'pemilik') {
			notifModalMsg =
				'PERINGATAN: Tidak ada sesi toko aktif! Transaksi akan dianggap di luar sesi dan tidak masuk ringkasan tutup toko.';
			notifModalType = 'warning';
			showNotifModal = true;
		}
		// Gunakan WITA timezone yang konsisten
		const nowWita = getNowWita();
		const waktu = witaToUtcISO(nowWita.split('T')[0], nowWita.split('T')[1]);
		const payment = paymentMethod === 'qris' ? 'non-tunai' : paymentMethod;
		// Generate transaction_id sekali per transaksi
		const transactionId =
			typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uuidv4();
		// Satu row summary untuk buku_kas
		const totalAmount = cart.reduce(
			(sum: any, item: any) =>
				sum +
				item.qty *
					((item.product.price ?? item.product.harga ?? 0) +
						(item.addOns
							? item.addOns.reduce((a: any, b: any) => a + (b.price ?? b.harga ?? 0), 0)
							: 0)),
			0
		);
		const description = 'Penjualan ' + cart.map((item: any) => item.product.name).join(', ');
		const totalQty = cart.reduce((sum: any, item: any) => sum + item.qty, 0);
		const insert = {
			tipe: 'in',
			sumber: 'pos',
			payment_method: payment,
			amount: totalAmount,
			description,
			customer_name: customerName || null,
			id_sesi_toko,
			waktu,
			jenis: 'pendapatan_usaha',
			qty: totalQty,
			transaction_id: transactionId
		};
		// Detail transaksi untuk transaksi_kasir
		const transaksiKasirInserts = cart.map((item: any) => {
			const addOnTotal = item.addOns
				? item.addOns.reduce((a: any, b: any) => a + (b.price ?? b.harga ?? 0), 0)
				: 0;
			const unitPrice = (item.product.price ?? item.product.harga ?? 0) + addOnTotal;
			return {
				// buku_kas_id: diisi saat online, biarkan null saat offline
				// Untuk custom item, set produk_id ke null dan simpan nama di custom_name
				produk_id: item.product.id.toString().startsWith('custom-') ? null : item.product.id,
				qty: item.qty,
				amount: unitPrice * item.qty,
				price: unitPrice,
				transaction_id: transactionId,
				// Tambahkan nama custom item jika ini adalah custom item
				custom_name: item.product.id.toString().startsWith('custom-') ? item.product.name : null
			};
		});
		if (!payment) {
			notifModalMsg = 'Metode pembayaran tidak valid!';
			notifModalType = 'error';
			showNotifModal = true;
			return;
		}
		if (navigator.onLine) {
			const { error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('buku_kas')
				.insert(insert);
			if (error) {
				notifModalMsg = 'Gagal mencatat transaksi: ' + ErrorHandler.extractErrorMessage(error);
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
			const { data: lastBukuKas, error: lastBukuKasError } = await getSupabaseClient(
				storeGet(selectedBranch)
			)
				.from('buku_kas')
				.select('id, transaction_id, sumber, waktu')
				.eq('customer_name', customerName || null)
				.eq('transaction_id', transactionId)
				.order('waktu', { ascending: false })
				.limit(1)
				.maybeSingle();
			if (lastBukuKas && lastBukuKas.id) {
				const transaksiKasirInserts = cart.map((item: any) => {
					const addOnTotal = item.addOns
						? item.addOns.reduce((a: any, b: any) => a + (b.price ?? b.harga ?? 0), 0)
						: 0;
					const unitPrice = (item.product.price ?? item.product.harga ?? 0) + addOnTotal;
					return {
						buku_kas_id: lastBukuKas.id,
						// Untuk custom item, set produk_id ke null dan simpan nama di custom_name
						produk_id: item.product.id.toString().startsWith('custom-') ? null : item.product.id,
						qty: item.qty,
						amount: unitPrice * item.qty,
						price: unitPrice,
						transaction_id: transactionId,
						// Tambahkan nama custom item jika ini adalah custom item
						custom_name: item.product.id.toString().startsWith('custom-') ? item.product.name : null
					};
				});
				if (transaksiKasirInserts.length) {
					const { error: errorKasir } = await getSupabaseClient(storeGet(selectedBranch))
						.from('transaksi_kasir')
						.insert(transaksiKasirInserts);
				}
			}
			// Setelah transaksi berhasil, invalidate cache dashboard/laporan dan fetch ulang data
			await dataService.invalidateCacheOnChange('buku_kas');
			await dataService.invalidateCacheOnChange('transaksi_kasir');
			if (typeof window !== 'undefined' && (window as any).refreshDashboardData) {
				await (window as any).refreshDashboardData();
			}
		} else {
			// Offline mode: simpan summary dan detail ke pending
			addPendingTransaction({ bukuKas: insert, transaksiKasir: transaksiKasirInserts });
			notifModalMsg = 'Transaksi disimpan offline dan akan otomatis sync saat online.';
			notifModalType = 'success';
			showNotifModal = true;
		}
		// Hapus proses insert ke transaksi dan item_transaksi, karena sudah tidak digunakan
	}

	function closeNotifModal() {
		showNotifModal = false;
	}

	function printStrukViaEscPosService() {
		// Gunakan pengaturanStruk jika ada, fallback default
		const pengaturan = pengaturanStruk || {
			nama_toko: 'Zatiaras Juice',
			alamat: 'Jl. Contoh Alamat No. 123, Kota',
			telepon: '0812-3456-7890',
			instagram: '@zatiarasjuice',
			ucapan: 'Terima kasih sudah ngejus di\nZatiaras Juice!'
		};
		let html = `<html><body style='width:384px;font-family:monospace;color:#000;font-size:22px;line-height:1.5;margin:0;padding:0;'>`;
		// Header
		html += `<div style='text-align:center;margin-bottom:16px;'>`;
		html += `<div style='font-weight:bold;font-size:26px;text-transform:uppercase;'>${pengaturan.nama_toko}</div>`;
		html += `<div style='font-size:18px;margin-top:4px;'>${pengaturan.alamat}</div>`;
		if (pengaturan.instagram || pengaturan.telepon) {
			html += `<div style='font-size:18px;margin-top:2px;'>${pengaturan.instagram ? pengaturan.instagram : ''}${pengaturan.instagram && pengaturan.telepon ? ' | ' : ''}${pengaturan.telepon ? pengaturan.telepon : ''}</div>`;
		}
		html += `</div>`;
		html += `<div style='border-bottom:1px dashed #333;margin-bottom:12px;'></div>`;
		// Info pelanggan & waktu
		html += `<div style='font-size:18px;margin-bottom:12px;display:flex;justify-content:space-between;'>`;
		html += `<div>${customerName || ''}</div>`;
		html += `<div>${new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</div>`;
		html += `</div>`;
		// Daftar pesanan
		html += `<table style='width:100%;font-size:22px;margin-bottom:12px;border-collapse:collapse;'><tbody>`;
		cart.forEach((item: any, idx: any) => {
			html += `<tr><td style='text-align:left;padding-bottom:4px;font-weight:bold;'>${item.product.name} <span style='font-size:16px;font-weight:normal;'>x${item.qty}</span></td><td style='text-align:right;padding-bottom:4px;'>Rp${(item.product.price ?? item.product.harga ?? 0).toLocaleString('id-ID')}</td></tr>`;
			if (item.addOns && item.addOns.length > 0) {
				item.addOns.forEach((a: any) => {
					html += `<tr><td style='font-size:16px;padding-left:8px;color:#333;'>+ ${a.name}</td><td style='font-size:16px;text-align:right;color:#333;'>Rp${((a.price ?? a.harga ?? 0) * item.qty).toLocaleString('id-ID')}</td></tr>`;
				});
			}
			const detail = [
				item.sugar && item.sugar !== 'normal'
					? item.sugar === 'no'
						? 'Tanpa Gula'
						: item.sugar === 'less'
							? 'Sedikit Gula'
							: item.sugar
					: null,
				item.ice && item.ice !== 'normal'
					? item.ice === 'no'
						? 'Tanpa Es'
						: item.ice === 'less'
							? 'Sedikit Es'
							: item.ice
					: null,
				item.note && item.note.trim() ? item.note : null
			]
				.filter(Boolean)
				.join(', ');
			if (detail)
				html += `<tr><td colspan='2' style='font-size:16px;padding-left:8px;padding-bottom:8px;color:#333;font-style:italic;'>${detail}</td></tr>`;
		});
		html += `</tbody></table>`;
		html += `<div style='border-bottom:1px dashed #333;margin-bottom:12px;'></div>`;
		// Ringkasan
		html += `<table style='width:100%;font-size:22px;margin-bottom:24px;border-collapse:collapse;'><tbody>`;
		html += `<tr><td style='text-align:left;padding-bottom:4px;'>Total:</td><td style='text-align:right;font-weight:bold;font-size:26px;'>Rp${totalHarga.toLocaleString('id-ID')}</td></tr>`;
		const methodLabels: Record<string, string> = {
			tunai: 'Tunai',
			qris: 'QRIS',
			transfer: 'Transfer',
			'e-wallet': 'E-Wallet',
			card: 'Kartu',
			'non-tunai': 'QRIS/Non-Tunai'
		};
		html += `<tr><td style='text-align:left;font-size:18px;padding-top:4px;'>Metode:</td><td style='text-align:right;font-size:18px;padding-top:4px;'>${methodLabels[paymentMethod] || paymentMethod}</td></tr>`;
		if (paymentMethod === 'tunai') {
			html += `<tr><td style='text-align:left;font-size:18px;'>Dibayar:</td><td style='text-align:right;font-size:18px;'>Rp${(parseInt(cashReceived) || 0).toLocaleString('id-ID')}</td></tr>`;
			html += `<tr><td style='text-align:left;font-size:18px;'>Kembalian:</td><td style='text-align:right;font-size:18px;'>Rp${kembalian >= 0 ? kembalian.toLocaleString('id-ID') : '0'}</td></tr>`;
		}
		html += `</tbody></table>`;
		// Ucapan
		html += `<div style='text-align:center;font-size:18px;white-space:pre-line;'>${pengaturan.ucapan}</div>`;
		html += `</body></html>`;

		// 2. Gzip + base64 encode
		const gzip = pako.gzip(JSON.stringify([html]));
		const base64 = Base64.fromUint8Array(gzip);
		// 3. Intent URL
		const intentUrl = `intent://#Intent;scheme=print-intent;S.content=${base64};end`;
		executePrint(intentUrl);
	}

	function handleAddCashTemplate(t: any) {
		addCashTemplate(t);
	}
	function handleKeypadButton(key: any) {
		if (key === 'C') cashReceived = '';
		else handleKeypad(key);
	}
	function handleSetPaymentMethod(id: any) {
		paymentMethod = id;
	}
	function handleBackToKasir() {
		showSuccessModal = false;
		goto('/pos');
	}
	function handleCloseNoSessionModal() {
		showNoSessionModal = false;
	}
</script>

<main class="page-content flex-1 overflow-y-auto px-2 pt-2">
	<div class="px-2 py-4">
		<div class="mb-3 text-sm font-semibold text-gray-700">Pembayaran: #{transactionCode}</div>
		<!-- Input Nama Pelanggan -->
		<div class="mb-4">
			<div class="mb-2 block text-sm text-gray-500">Nama Pelanggan</div>
			<input
				type="text"
				class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
				placeholder="Masukkan nama pelanggan..."
				bind:value={customerName}
				maxlength="50"
			/>
		</div>
		<!-- Info Pesanan -->
		<div class="mb-4 rounded-xl bg-pink-50 p-4">
			<div class="mb-2 font-semibold text-pink-500">Pesanan</div>
			<ul class="divide-y divide-pink-100">
				{#each cart as item}
					<li class="flex flex-col gap-0.5 py-2">
						<div class="flex items-center justify-between">
							<div class="flex min-w-0 items-center gap-2">
								<span class="truncate font-medium text-gray-900">{item.product.name}</span>
								<span class="flex-shrink-0 text-sm text-gray-500">x{item.qty}</span>
							</div>
							<span class="font-bold text-pink-500"
								>Rp {((item.product.price ?? item.product.harga ?? 0) * item.qty).toLocaleString(
									'id-ID'
								)}</span
							>
						</div>
						{#if item.addOns && item.addOns.length > 0}
							<div class="mt-1 ml-1 flex flex-col gap-0.5">
								{#each item.addOns as ekstra}
									<div class="flex justify-between text-xs font-medium text-gray-500">
										<span>+ {ekstra.name}</span>
										<span
											>Rp {((ekstra.price ?? ekstra.harga ?? 0) * item.qty).toLocaleString(
												'id-ID'
											)}</span
										>
									</div>
								{/each}
							</div>
						{/if}
						{#if (item.sugar && item.sugar !== 'normal') || (item.ice && item.ice !== 'normal') || (item.note && item.note.trim())}
							<div class="ml-1 text-xs font-medium text-gray-400">
								{[
									item.sugar && item.sugar !== 'normal'
										? item.sugar === 'no'
											? 'Tanpa Gula'
											: item.sugar === 'less'
												? 'Sedikit Gula'
												: item.sugar
										: null,
									item.ice && item.ice !== 'normal'
										? item.ice === 'no'
											? 'Tanpa Es'
											: item.ice === 'less'
												? 'Sedikit Es'
												: item.ice
										: null,
									item.note && item.note.trim() ? item.note : null
								]
									.filter(Boolean)
									.join(', ')}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
		<!-- Metode Pembayaran -->
		<div class="mb-4">
			<div class="mb-2 block text-sm text-gray-500">Metode Pembayaran</div>
			<div class="grid grid-cols-2 gap-3">
				{#each paymentOptions as opt}
					<button
						type="button"
						class="rounded-lg border-2 px-4 py-3 text-base font-semibold transition-all
            {paymentMethod === opt.id
							? 'border-pink-500 bg-pink-50 text-pink-500'
							: 'border-pink-200 bg-white text-gray-700'}"
						onclick={() => handleSetPaymentMethod(opt.id)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</div>
		<!-- Summary Total -->
		<div class="mt-6 mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow">
			<div class="font-semibold text-gray-700">Total</div>
			<div class="text-2xl font-bold text-pink-500">Rp {totalHarga.toLocaleString('id-ID')}</div>
		</div>
		<!-- Tombol Konfirmasi -->
		<button
			class="mt-2 w-full rounded-xl bg-pink-500 py-4 text-lg font-bold text-white shadow-lg transition-all active:bg-pink-600 disabled:opacity-50"
			onclick={handleBayar}
			disabled={!paymentMethod || !customerName.trim()}
		>
			Konfirmasi & Bayar
		</button>
		{#if !paymentMethod || !customerName.trim()}
			<div class="mt-2 text-center text-xs text-red-400">
				{#if !paymentMethod && !customerName.trim()}
					Isi nama pelanggan & pilih metode pembayaran dulu
				{:else if !paymentMethod}
					Pilih metode pembayaran dulu
				{:else}
					Isi nama pelanggan dulu
				{/if}
			</div>
		{/if}
		<button
			class="mx-auto mt-4 block text-sm text-gray-400 underline hover:text-pink-400"
			type="button"
			onclick={handleCancel}
		>
			Batalkan
		</button>
	</div>
</main>

{#if showCancelModal}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal mx-auto w-full max-w-sm rounded-t-2xl bg-white p-6 pb-4 shadow-lg"
		>
			<div class="mb-2 text-center text-lg font-bold text-gray-800">Batalkan Pembayaran?</div>
			<div class="mb-6 text-center text-gray-500">
				Apakah Anda yakin ingin membatalkan pembayaran dan kembali ke kasir?
			</div>
			<div class="flex flex-col gap-2">
				<button
					class="w-full rounded-lg bg-red-500 py-3 text-base font-bold text-white active:bg-red-600"
					onclick={confirmCancel}>Ya, batalkan</button
				>
				<button
					class="w-full rounded-lg bg-gray-100 py-3 text-base font-semibold text-gray-500"
					onclick={closeModal}>Tutup</button
				>
			</div>
		</div>
	</div>
{/if}

<KeypadModal
	open={showCashModal}
	{cashReceived}
	{formattedCashReceived}
	{totalHarga}
	{kembalian}
	{cashTemplates}
	{keypad}
	onAddCashTemplate={handleAddCashTemplate}
	onKeypadButton={handleKeypadButton}
	onFinishCash={finishCash}
	onClose={closeCashModal}
	onInputRaw={(raw) => (cashReceived = raw)}
/>

{#if showQrisWarning}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal qris-warning-modal mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-t-2xl bg-white p-8 pb-6 shadow-lg"
		>
			<div
				class="animate-bounceIn warning-icon mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100"
			>
				<svg width="40" height="40" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#fde047" opacity="0.18" /><path
						d="M12 8v4m0 4h.01"
						stroke="#f59e42"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="warning-title mb-1 text-center text-xl font-bold text-yellow-600">
				Periksa Pembayaran QRIS
			</div>
			<div class="mb-2 text-center text-gray-700">
				Pastikan kasir sudah <span class="font-semibold text-pink-500">memeriksa nama merchant</span
				>
				dan <span class="font-semibold text-pink-500">nominal pembayaran</span> di aplikasi konsumen
				sebelum melanjutkan.
			</div>
			<button
				class="warning-btn mt-2 w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white transition-all active:bg-pink-600"
				onclick={confirmQrisChecked}>Sudah Diperiksa</button
			>
		</div>
	</div>
{/if}

{#if showSuccessModal}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-t-2xl bg-white p-8 pb-6 shadow-lg"
		>
			<div
				class="animate-bounceIn mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-green-100"
			>
				<svg width="48" height="48" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#4ade80" opacity="0.18" /><path
						d="M7 13l3 3 7-7"
						stroke="#22c55e"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="mb-1 text-center text-2xl font-bold text-green-600">Transaksi Berhasil!</div>
			<div class="mb-2 text-center text-gray-700">
				Pembayaran {paymentMethod === 'tunai' ? 'tunai' : paymentMethod.toUpperCase()} telah diterima.<br
				/>
				{#if customerName.trim()}
					<span class="font-semibold text-pink-500">{customerName.trim()}</span><br />
				{/if}
				Kembalian:
				<span class="font-bold text-pink-500"
					>Rp {kembalian >= 0 ? kembalian.toLocaleString('id-ID') : '0'}</span
				>
			</div>
			<div class="mb-2 flex w-full flex-col gap-1 rounded-lg bg-pink-50 p-3">
				<div class="flex justify-between text-sm text-gray-500">
					<span>Total</span><span class="font-bold text-pink-500"
						>Rp {totalHarga.toLocaleString('id-ID')}</span
					>
				</div>
				<div class="flex justify-between text-sm text-gray-500">
					<span>Dibayar</span><span class="font-bold text-green-600"
						>Rp {cashReceived ? parseInt(cashReceived).toLocaleString('id-ID') : '0'}</span
					>
				</div>
				<div class="flex justify-between text-sm text-gray-500">
					<span>Kembalian</span><span class="font-bold text-green-600"
						>Rp {kembalian >= 0 ? kembalian.toLocaleString('id-ID') : '0'}</span
					>
				</div>
			</div>
			<div class="flex w-full flex-col gap-2">
				<button
					class="w-full rounded-lg bg-green-500 py-3 text-base font-bold text-white transition-all active:bg-green-600"
					onclick={printStrukViaEscPosService}>Cetak Struk</button
				>
				<button
					class="w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white transition-all active:bg-pink-600"
					onclick={handleBackToKasir}>Kembali ke Kasir</button
				>
			</div>
		</div>
	</div>
{/if}

{#if showErrorNotification}
	<div
		class="fixed top-20 left-1/2 z-50 rounded-xl bg-red-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out"
		style="transform: translateX(-50%);"
		in:fly={{ y: -32, duration: 300, easing: cubicOut }}
		out:fade={{ duration: 200 }}
	>
		{errorNotificationMessage}
	</div>
{/if}

{#if showSuccessNotification}
	<div
		class="fixed top-20 left-1/2 z-50 rounded-xl bg-green-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out"
		style="transform: translateX(-50%);"
		in:fly={{ y: -32, duration: 300, easing: cubicOut }}
		out:fade={{ duration: 200 }}
	>
		{successNotificationMessage}
	</div>
{/if}

{#if showNoSessionModal}
	<ModalSheet open={showNoSessionModal} title="Peringatan" on:close={handleCloseNoSessionModal}>
		<div class="py-6 text-center text-base text-gray-700">{noSessionModalMsg}</div>
		<div slot="footer" class="flex flex-col gap-2">
			<button
				class="w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white active:bg-pink-600"
				onclick={handleCloseNoSessionModal}>Tutup</button
			>
		</div>
	</ModalSheet>
{/if}

{#if showNotifModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
		<div
			class="animate-slideUpModal flex w-full max-w-xs flex-col items-center rounded-2xl border-2 bg-white px-8 py-7 shadow-2xl"
			style="border-color: {notifModalType === 'success'
				? '#facc15'
				: notifModalType === 'error'
					? '#ef4444'
					: '#facc15'};"
		>
			<div
				class="mb-3 flex h-16 w-16 items-center justify-center rounded-full"
				style="background: {notifModalType === 'success'
					? '#fef9c3'
					: notifModalType === 'error'
						? '#fee2e2'
						: '#fef9c3'};"
			>
				{#if notifModalType === 'success'}
					<svg
						class="h-10 w-10 text-yellow-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="12" r="10" fill="#fef9c3" />
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12l2 2 4-4"
							stroke="#facc15"
							stroke-width="2"
						/>
					</svg>
				{:else if notifModalType === 'error'}
					<svg
						class="h-10 w-10 text-red-500"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="12" r="10" fill="#fee2e2" />
						<line
							x1="9"
							y1="9"
							x2="15"
							y2="15"
							stroke="#ef4444"
							stroke-width="2"
							stroke-linecap="round"
						/>
						<line
							x1="15"
							y1="9"
							x2="9"
							y2="15"
							stroke="#ef4444"
							stroke-width="2"
							stroke-linecap="round"
						/>
					</svg>
				{:else}
					<svg
						class="h-10 w-10 text-yellow-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<circle cx="12" cy="12" r="10" fill="#fef9c3" />
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 8v4m0 4h.01"
							stroke="#facc15"
							stroke-width="2"
						/>
					</svg>
				{/if}
			</div>
			<div class="mb-4 text-center text-base font-medium text-gray-700">{notifModalMsg}</div>
			<button
				class="mt-2 rounded-xl bg-pink-500 px-6 py-2 font-bold text-white shadow transition-colors hover:bg-pink-600"
				onclick={closeNotifModal}>Tutup</button
			>
		</div>
	</div>
{/if}

<style>
	@keyframes slideUpModal {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@keyframes bounceIn {
		0% {
			transform: scale(0.7);
			opacity: 0;
		}
		60% {
			transform: scale(1.1);
			opacity: 1;
		}
		100% {
			transform: scale(1);
		}
	}
	.animate-bounceIn {
		animation: bounceIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* Tambahan untuk modal warning QRIS di tablet */
	@media (min-width: 768px) {
		.qris-warning-modal {
			padding: 3rem 2.5rem 2.5rem 2.5rem !important;
		}
		.qris-warning-modal .warning-icon {
			width: 88px !important;
			height: 88px !important;
			min-width: 88px;
			min-height: 88px;
		}
		.qris-warning-modal .warning-title {
			font-size: 2rem !important;
		}
		.qris-warning-modal .warning-btn {
			font-size: 1.25rem !important;
			padding-top: 1.25rem !important;
			padding-bottom: 1.25rem !important;
		}
	}
</style>
