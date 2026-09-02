import {
	validateNumber,
	validateText,
	validateTime,
	sanitizeInput,
	validateIncomeExpense
} from '$lib/utils/validation';
import { securityUtils } from '$lib/utils/security';
import { witaToUtcISO } from '$lib/utils/dateTime';
import { formatRupiah } from '$lib/utils/currency';
import { userRole, setUserRole } from '$lib/stores/userRole.svelte';
import { addPendingTransaction } from '$lib/utils/offline';
import { transactionService } from '$lib/services/transactionService';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { createToastManager } from '$lib/utils/ui';
import { getSesiAktif } from '$lib/services/sesiTokoService';
import type { TokoSession } from '$lib/types';
import type { NotifModalType } from '$lib/components/shared/NotifModal.svelte';

export function createCatatState() {
	let mode = $state<'pemasukan' | 'pengeluaran'>('pemasukan');
	let paymentMethod = $state<'tunai' | 'non-tunai'>('tunai');
	let date = $state('');
	let time = $state('');
	let rawNominal = $state('');
	let nominal = $state('');
	let jenis = $state('');
	let namaJenis = $state('');
	let nama = $state('');
	let error = $state('');
	let showDropdown = $state(false);
	let showSnackbar = $state(false);
	let snackbarMsg = $state('');
	let showNotifModal = $state(false);
	let notifModalMsg = $state('');
	let notifModalType = $state<NotifModalType>('warning');
	let currentUserRole = $state('');
	let sesiAktif = $state<TokoSession | null>(null);
	let recentTransactions = $state<any[]>([]);
	let isLoadingRecent = $state(false);

	const toastManager = createToastManager();

	const jenisPemasukan = [
		{ value: 'pendapatan_usaha', label: 'Pendapatan Usaha' },
		{ value: 'lainnya', label: 'Lainnya' }
	];
	const jenisPengeluaran = [
		{ value: 'beban_usaha', label: 'Beban Usaha' },
		{ value: 'lainnya', label: 'Lainnya' }
	];

	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	$effect(() => {
		if (mode === 'pemasukan') {
			if (!jenis || (jenis !== 'pendapatan_usaha' && jenis !== 'lainnya')) {
				jenis = 'pendapatan_usaha';
			}
		} else if (mode === 'pengeluaran') {
			if (!jenis || (jenis !== 'beban_usaha' && jenis !== 'lainnya')) {
				jenis = 'beban_usaha';
			}
		}
	});

	function getLocalDateString() {
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	async function cekSesiTokoAktif() {
		sesiAktif = await getSesiAktif();
	}

	async function loadRecentTransactions() {
		try {
			isLoadingRecent = true;
			const rows = (await transactionService.getRows('buku_kas', {
				sumber: 'catat',
				limit: '5'
			})) as any[];
			recentTransactions = Array.isArray(rows) ? rows : [];
		} catch {
			recentTransactions = [];
		} finally {
			isLoadingRecent = false;
		}
	}

	async function init() {
		import('$lib/utils/iconLoader').then(({ loadRouteIcons }) => {
			loadRouteIcons('catat');
		});
		if (!currentUserRole) {
			const res = await fetch('/api/session');
			if (res.ok) {
				const session = await res.json();
				if (session?.user) setUserRole(session.user.role, session.user);
			}
		}
		date = getLocalDateString();
		time = new Date().toTimeString().slice(0, 5);
		jenis = mode === 'pemasukan' ? 'pendapatan_usaha' : 'beban_usaha';
		await Promise.all([cekSesiTokoAktif(), loadRecentTransactions()]);
	}

	function closeNotifModal() {
		showNotifModal = false;
	}

	async function saveTransaksi(form: {
		nominal: number;
		deskripsi: string;
		transaction_date: string;
		transaction_time: string;
		metode_bayar: string;
		jenis: string;
	}) {
		await cekSesiTokoAktif();
		const id_sesi_toko = sesiAktif?.id || null;
		if (!id_sesi_toko && currentUserRole === 'kasir') {
			notifModalMsg = 'Kasir tidak boleh melakukan transaksi saat toko tutup!';
			notifModalType = 'error';
			showNotifModal = true;
			return;
		}
		if (!id_sesi_toko && currentUserRole !== 'kasir') {
			notifModalMsg =
				'PERINGATAN: Tidak ada sesi toko aktif! Transaksi akan dianggap di luar sesi dan tidak masuk ringkasan tutup toko.';
			notifModalType = 'warning';
			showNotifModal = true;
		}
		const utcTime = witaToUtcISO(form.transaction_date, form.transaction_time || '00:00');
		const trx = {
			id: crypto.randomUUID(),
			tipe: mode === 'pemasukan' ? 'in' : 'out',
			sumber: 'catat',
			metode_bayar: form.metode_bayar,
			nominal: form.nominal,
			deskripsi: form.deskripsi,
			id_sesi_toko,
			waktu: utcTime,
			jenis: form.jenis
		};
		if (navigator.onLine) {
			try {
				await transactionService.insertRows('buku_kas', trx);
			} catch (err) {
				if (err instanceof TypeError || !navigator.onLine) {
					await addPendingTransaction(trx);
					notifModalMsg = 'Koneksi terputus. Transaksi disimpan dan akan dikirim saat online.';
					notifModalType = 'success';
					showNotifModal = true;
					return;
				}
				notifModalMsg =
					'Gagal menyimpan transaksi ke database: ' +
					(err instanceof Error ? err.message : 'Unknown error');
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
			await cacheOrchestrator.invalidateCacheOnChange('buku_kas');
			await cacheOrchestrator.invalidateCacheOnChange('transaksi_kasir');
		} else {
			await addPendingTransaction(trx);
			notifModalMsg = 'Transaksi disimpan offline dan akan otomatis sync saat online.';
			notifModalType = 'success';
			showNotifModal = true;
		}
	}

	function handleNominalInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const val = target.value.replace(/\D/g, '');
		rawNominal = val;
		nominal = formatRupiah(val);
	}

	function setTemplateNominal(val: number) {
		const current = parseInt(rawNominal || '0', 10);
		const next = current + val;
		rawNominal = next.toString();
		nominal = formatRupiah(next);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (!securityUtils.checkFormRateLimit('catat_form')) {
			error = 'Terlalu banyak submission. Silakan tunggu sebentar.';
			return;
		}
		const sanitizedDate = sanitizeInput(date);
		const sanitizedTime = sanitizeInput(time);
		const sanitizedNominal = sanitizeInput(nominal);
		let sanitizedJenis = sanitizeInput(jenis);
		if (!sanitizedJenis) {
			sanitizedJenis = mode === 'pemasukan' ? 'pendapatan_usaha' : 'beban_usaha';
		}
		const sanitizedNamaJenis = sanitizeInput(namaJenis);
		const sanitizedNama = sanitizeInput(nama);
		const sanitizedPaymentMethod = sanitizeInput(paymentMethod);
		const timeValidation = validateTime(sanitizedTime);
		const nominalValidation = validateNumber(sanitizedNominal, { required: true, min: 0 });
		const jenisValidation = validateText(sanitizedJenis, { required: true });
		const namaValidation = validateText(sanitizedNama, {
			required: true,
			minLength: 2,
			maxLength: 100
		});
		const paymentMethodValidation = validateText(sanitizedPaymentMethod, { required: true });
		const allInputs = `${sanitizedDate}${sanitizedTime}${sanitizedNominal}${sanitizedJenis}${sanitizedNamaJenis}${sanitizedNama}${sanitizedPaymentMethod}`;
		if (securityUtils.detectSuspiciousActivity('catat_form', allInputs)) {
			error = 'Input mencurigakan terdeteksi. Silakan coba lagi.';
			securityUtils.logSecurityEvent('suspicious_input_blocked', {
				form: 'catat',
				inputs: { date: sanitizedDate, time: sanitizedTime, nominal: sanitizedNominal }
			});
			return;
		}
		const errors = [];
		if (!timeValidation.isValid) errors.push(`Waktu: ${timeValidation.errors.join(', ')}`);
		if (!nominalValidation.isValid) errors.push(`Nominal: ${nominalValidation.errors.join(', ')}`);
		if (!jenisValidation.isValid) errors.push(`Jenis: ${jenisValidation.errors.join(', ')}`);
		if (!namaValidation.isValid) errors.push(`Nama: ${namaValidation.errors.join(', ')}`);
		if (!paymentMethodValidation.isValid)
			errors.push(`Metode Pembayaran: ${paymentMethodValidation.errors.join(', ')}`);
		if (sanitizedJenis === 'lainnya') {
			const namaJenisValidation = validateText(sanitizedNamaJenis, {
				required: true,
				minLength: 2,
				maxLength: 50
			});
			if (!namaJenisValidation.isValid) {
				errors.push(`Nama Jenis: ${namaJenisValidation.errors.join(', ')}`);
			}
		}
		if (errors.length > 0) {
			error = errors.join('\n');
			return;
		}
		const dataToValidate = {
			nominal: parseFloat(sanitizedNominal.replace(/\D/g, '')),
			deskripsi: sanitizedNama,
			transaction_date: sanitizedDate,
			transaction_time: sanitizedTime,
			metode_bayar: sanitizedPaymentMethod,
			jenis: sanitizedJenis
		};
		const completeValidation = validateIncomeExpense(dataToValidate);
		if (!completeValidation.isValid) {
			error = completeValidation.errors.join('\n');
			return;
		}
		await saveTransaksi(dataToValidate);
		await loadRecentTransactions();
		snackbarMsg = 'Transaksi berhasil dicatat!';
		showSnackbar = true;
		setTimeout(() => {
			showSnackbar = false;
		}, 1800);
		rawNominal = '';
		nominal = '';
		namaJenis = '';
		nama = '';
	}

	function getJenisLabel(val: string): string {
		if (mode === 'pemasukan') {
			if (val === 'pendapatan_usaha') return 'Pendapatan Usaha';
			if (val === 'lainnya') return 'Lainnya';
		} else {
			if (val === 'beban_usaha') return 'Beban Usaha';
			if (val === 'lainnya') return 'Lainnya';
		}
		return '';
	}

	function handleSetPemasukan() {
		if (mode !== 'pemasukan') {
			mode = 'pemasukan';
			if (jenis !== 'pendapatan_usaha' && jenis !== 'lainnya') {
				jenis = 'pendapatan_usaha';
			}
			if (jenis === 'lainnya') namaJenis = '';
			nama = '';
		}
	}
	function handleSetPengeluaran() {
		if (mode !== 'pengeluaran') {
			mode = 'pengeluaran';
			if (jenis !== 'beban_usaha' && jenis !== 'lainnya') {
				jenis = 'beban_usaha';
			}
			if (jenis === 'lainnya') namaJenis = '';
			nama = '';
		}
	}
	function handleSetTemplateNominal(val: number) {
		return () => setTemplateNominal(val);
	}

	return {
		get mode() {
			return mode;
		},
		get paymentMethod() {
			return paymentMethod;
		},
		set paymentMethod(v) {
			paymentMethod = v;
		},
		get date() {
			return date;
		},
		set date(v) {
			date = v;
		},
		get time() {
			return time;
		},
		set time(v) {
			time = v;
		},
		get rawNominal() {
			return rawNominal;
		},
		get nominal() {
			return nominal;
		},
		get jenis() {
			return jenis;
		},
		set jenis(v) {
			jenis = v;
		},
		get namaJenis() {
			return namaJenis;
		},
		set namaJenis(v) {
			namaJenis = v;
		},
		get nama() {
			return nama;
		},
		set nama(v) {
			nama = v;
		},
		get error() {
			return error;
		},
		get showDropdown() {
			return showDropdown;
		},
		set showDropdown(v) {
			showDropdown = v;
		},
		get showSnackbar() {
			return showSnackbar;
		},
		get snackbarMsg() {
			return snackbarMsg;
		},
		get showNotifModal() {
			return showNotifModal;
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
		get recentTransactions() {
			return recentTransactions;
		},
		get isLoadingRecent() {
			return isLoadingRecent;
		},
		loadRecentTransactions,
		toastManager,
		jenisPemasukan,
		jenisPengeluaran,
		init,
		closeNotifModal,
		handleNominalInput,
		handleSubmit,
		getJenisLabel,
		handleSetPemasukan,
		handleSetPengeluaran,
		handleSetTemplateNominal
	};
}
