<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { transactionService } from '$lib/services/transactionService';
	import { bukaToko, tutupToko } from '$lib/services/sesiTokoService';
	import { getNowWita, getTodayWita, witaToUtcISO } from '$lib/utils/dateTime';
	import { formatRupiah } from '$lib/utils/currency';
	import type { BukuKasRecord, TokoSession } from '$lib/types';

	let {
		show = $bindable(false),
		isBukaToko = false,
		sesiAktif = null as TokoSession | null,
		onTokoStatusChanged
	} = $props<{
		show: boolean;
		isBukaToko: boolean;
		sesiAktif: TokoSession | null;
		onTokoStatusChanged: () => void;
	}>();

	let modalAwalInput = $state('');
	let pinErrorToko = $state('');

	let ringkasanTutup = $state({
		modalAwal: 0,
		totalPenjualan: 0,
		pemasukanTunai: 0,
		pengeluaranTunai: 0,
		uangKasir: 0
	});

	$effect(() => {
		if (show && !isBukaToko) {
			hitungRingkasanTutup();
		} else if (show && isBukaToko) {
			modalAwalInput = '';
			pinErrorToko = '';
		}
	});

	async function hitungRingkasanTutup() {
		if (!sesiAktif) return;
		const kasRaw = (await transactionService.getRows('buku_kas', {
			id_sesi_toko: sesiAktif.id
		})) as unknown as BukuKasRecord[];

		let kas: BukuKasRecord[] = Array.isArray(kasRaw) ? kasRaw : [];

		// Penjualan tunai (semua pemasukan tunai)
		const penjualanTunai = kas
			.filter((t) => t.tipe === 'in' && t.metode_bayar === 'tunai')
			.reduce((a, b) => a + (b.nominal || 0), 0);
		// Pengeluaran tunai
		const pengeluaranTunai = kas
			.filter((t) => t.tipe === 'out' && t.metode_bayar === 'tunai')
			.reduce((a, b) => a + (b.nominal || 0), 0);
		const modalAwalValue = sesiAktif.kas_awal || 0;
		// Total penjualan = semua pemasukan (in) dari sumber pos
		const totalPenjualan = kas
			.filter((t) => t.tipe === 'in' && t.sumber === 'pos')
			.reduce((a, b) => a + (b.nominal || 0), 0);
		// Uang kasir seharusnya
		const uangKasir = modalAwalValue + penjualanTunai - pengeluaranTunai;
		ringkasanTutup = {
			modalAwal: modalAwalValue,
			totalPenjualan,
			pemasukanTunai: penjualanTunai,
			pengeluaranTunai,
			uangKasir
		};
	}

	async function handleBukaToko() {
		const modalAwalRaw = Number((modalAwalInput || '').replace(/\D/g, ''));
		if (!modalAwalRaw || isNaN(modalAwalRaw) || modalAwalRaw < 0) {
			pinErrorToko = 'Modal awal wajib diisi dan valid';
			return;
		}
		await bukaToko(modalAwalRaw, witaToUtcISO(getTodayWita(), getNowWita().split('T')[1]));
		show = false;
		onTokoStatusChanged();
	}

	async function handleTutupToko() {
		if (!sesiAktif) return;
		await tutupToko(sesiAktif.id, witaToUtcISO(getTodayWita(), getNowWita().split('T')[1]));
		show = false;
		onTokoStatusChanged();
	}

	function formatModalAwalInput(e: Event) {
		let value = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''); // Remove non-numeric characters
		if (value.length > 0) {
			value = formatRupiah(value); // Format as Rupiah
		}
		modalAwalInput = value;
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
		onclick={(event) => event.target === event.currentTarget && (show = false)}
		onkeydown={(e) => e.key === 'Escape' && (show = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Modal buka tutup toko"
		onkeyup={(e) => e.key === 'Enter' && (show = false)}
		tabindex="-1"
		onkeypress={(e) => e.key === 'Enter' && (show = false)}
	>
		<div
			class="modal-slideup mx-auto box-border w-full max-w-[95vw] rounded-2xl bg-white p-8 shadow-2xl md:p-12 lg:max-w-lg lg:p-10 xl:max-w-xl xl:p-12 2xl:max-w-2xl 2xl:p-16"
			role="document"
		>
			{#if isBukaToko}
				<div class="mb-4 flex flex-col items-center">
					<div class="mb-2 text-4xl">🍹</div>
					<h2 class="mb-1 text-xl font-bold text-pink-500">Buka Toko</h2>
					<div class="mb-2 text-sm text-gray-400">Yuk, buka toko dan mulai hari ini.</div>
				</div>
				<div class="mb-4">
					<div class="relative">
						<span
							class="absolute top-1/2 left-4 -translate-y-1/2 font-semibold text-pink-400 select-none"
							>Rp</span
						>
						<input
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							min="0"
							bind:value={modalAwalInput}
							oninput={formatModalAwalInput}
							class="w-full rounded-xl border-2 border-pink-200 bg-pink-50 py-3 pr-4 pl-12 text-lg font-bold text-gray-800 placeholder-pink-300 shadow-sm transition outline-none focus:ring-2 focus:ring-pink-300"
							placeholder="Modal awal kas hari ini"
						/>
					</div>
				</div>
				{#if pinErrorToko}
					<div
						class="fixed top-20 left-1/2 z-50 rounded-xl bg-red-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out"
						style="transform: translateX(-50%);"
						in:fly={{ y: -32, duration: 300, easing: cubicOut }}
						out:fade={{ duration: 200 }}
					>
						{pinErrorToko}
					</div>
				{/if}
				<button
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 py-3 text-lg font-extrabold text-white shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-100"
					onclick={handleBukaToko}
				>
					<span class="text-2xl">🍹</span>
					<span>Buka Toko Sekarang</span>
				</button>
			{:else}
				<div class="mb-4 flex flex-col items-center">
					<div class="mb-2 text-4xl">🔒</div>
					<h2 class="mb-1 text-xl font-bold text-pink-500">Tutup Toko</h2>
					<div class="mb-2 text-center text-sm text-gray-400">
						Terima kasih atas kerja keras hari ini! Cek ringkasan sebelum tutup toko.
					</div>
				</div>
				<div class="mb-4 space-y-3 text-base text-gray-700">
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Modal Awal</span><span>Rp {formatRupiah(ringkasanTutup.modalAwal)}</span>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Total Penjualan</span><span>Rp {formatRupiah(ringkasanTutup.totalPenjualan)}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Pemasukan Tunai</span><span>Rp {formatRupiah(ringkasanTutup.pemasukanTunai)}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Pengeluaran Tunai</span><span
							>Rp {formatRupiah(ringkasanTutup.pengeluaranTunai)}</span
						>
					</div>
					<div class="mb-1 flex flex-col items-center">
						<div class="mb-1 text-center text-base font-bold text-pink-600 md:text-lg">
							Uang Kasir Seharusnya
						</div>
						<div
							class="mx-8 flex w-full max-w-xs flex-col items-center justify-center rounded-xl border-2 border-pink-400 bg-white px-2 py-5 shadow-sm md:mx-16"
						>
							<div class="mb-1 text-4xl">💸</div>
							<span
								class="animate-glow text-2xl font-extrabold whitespace-nowrap text-pink-600 md:text-3xl"
								>Rp {formatRupiah(ringkasanTutup.uangKasir)}</span
							>
							<div class="mt-2 text-center text-xs text-gray-400">
								Pastikan uang kasir sesuai sebelum tutup toko
							</div>
						</div>
					</div>
				</div>
				<button
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 py-3 text-lg font-extrabold text-white shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-100"
					onclick={handleTutupToko}
				>
					<span class="text-2xl">🔒</span>
					<span>Tutup Toko Sekarang</span>
				</button>
			{/if}
		</div>
	</div>
{/if}
