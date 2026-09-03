<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Store from '@lucide/svelte/icons/store';
	import Lock from '@lucide/svelte/icons/lock';
	import X from '@lucide/svelte/icons/x';
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

		// [CATATAN]: Penjualan tunai (semua pemasukan tunai)
		const penjualanTunai = kas
			.filter((t) => t.tipe === 'in' && t.metode_bayar === 'tunai')
			.reduce((a, b) => a + (b.nominal || 0), 0);
		// [CATATAN]: Pengeluaran tunai
		const pengeluaranTunai = kas
			.filter((t) => t.tipe === 'out' && t.metode_bayar === 'tunai')
			.reduce((a, b) => a + (b.nominal || 0), 0);
		const modalAwalValue = sesiAktif.kas_awal || 0;
		// [CATATAN]: Total penjualan = semua pemasukan (in)
		const totalPenjualan = kas
			.filter((t) => t.tipe === 'in')
			.reduce((a, b) => a + (b.nominal || 0), 0);

		// [CATATAN]: Uang kasir = modal awal + pemasukan tunai - pengeluaran tunai
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
		pinErrorToko = '';
		const modalClean = modalAwalInput.replace(/\./g, '').replace(/[^0-9]/g, '');
		const modalAwal = parseInt(modalClean, 10);
		if (isNaN(modalAwal) || modalAwal < 0) {
			pinErrorToko = 'Masukkan modal awal kas yang valid';
			return;
		}
		try {
			const waktuBuka = witaToUtcISO(getTodayWita(), getNowWita().split('T')[1] || '08:00:00');
			await bukaToko(modalAwal, waktuBuka);
			show = false;
			onTokoStatusChanged();
		} catch (err: any) {
			pinErrorToko = err?.message || 'Gagal membuka toko';
		}
	}

	async function handleTutupToko() {
		pinErrorToko = '';
		if (!sesiAktif?.id) {
			pinErrorToko = 'Tidak ada sesi aktif yang ditemukan';
			return;
		}
		try {
			const waktuTutup = witaToUtcISO(getTodayWita(), getNowWita().split('T')[1] || '22:00:00');
			await tutupToko(sesiAktif.id, waktuTutup);
			show = false;
			onTokoStatusChanged();
		} catch (err: any) {
			pinErrorToko = err?.message || 'Gagal menutup toko';
		}
	}

	function formatModalAwalInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const raw = input.value.replace(/[^0-9]/g, '');
		if (!raw) {
			modalAwalInput = '';
			return;
		}
		const num = parseInt(raw, 10);
		modalAwalInput = isNaN(num) ? '' : formatRupiah(num);
	}
</script>

{#if show}
	<!-- Modal Backdrop Overlay -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
		transition:fade={{ duration: 180 }}
		onclick={(event) => event.target === event.currentTarget && (show = false)}
		onkeydown={(e) => e.key === 'Escape' && (show = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Modal status sesi toko"
		tabindex="-1"
	>
		<div
			class="relative mx-auto w-full max-w-md rounded-[28px] border border-pink-100 bg-white p-6 shadow-2xl md:p-8"
			transition:scale={{ start: 0.94, duration: 220, easing: cubicOut }}
			role="document"
		>
			<!-- Close Button -->
			<button
				type="button"
				onclick={() => (show = false)}
				class="absolute top-4 right-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all hover:bg-slate-200 active:scale-95"
				aria-label="Tutup dialog"
			>
				<X size={16} class="stroke-[2.2]" />
			</button>

			{#if isBukaToko}
				<div class="mb-5 flex flex-col items-center text-center">
					<div
						class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600"
					>
						<Store size={28} class="stroke-[2.2]" />
					</div>
					<h2 class="text-xl font-bold tracking-tight text-slate-900">Buka Sesi Toko</h2>
					<p class="mt-1 text-xs font-medium text-slate-500">
						Masukkan modal kas awal untuk memulai sesi kasir hari ini.
					</p>
				</div>

				<div class="mb-5">
					<label for="modal-kas-input" class="mb-1.5 block text-xs font-bold text-slate-700"
						>Modal Awal Kas</label
					>
					<div class="relative">
						<span
							class="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-bold text-pink-500 select-none"
							>Rp</span
						>
						<input
							id="modal-kas-input"
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							min="0"
							bind:value={modalAwalInput}
							oninput={formatModalAwalInput}
							class="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pr-4 pl-11 text-base font-bold text-slate-900 placeholder-slate-400 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
							placeholder="0"
						/>
					</div>
				</div>

				{#if pinErrorToko}
					<div
						class="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-600"
					>
						{pinErrorToko}
					</div>
				{/if}

				<button
					type="button"
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98]"
					onclick={handleBukaToko}
				>
					<Store size={18} class="stroke-[2.2]" />
					<span>Buka Toko Sekarang</span>
				</button>
			{:else}
				<div class="mb-5 flex flex-col items-center text-center">
					<div
						class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600"
					>
						<Lock size={26} class="stroke-[2.2]" />
					</div>
					<h2 class="text-xl font-bold tracking-tight text-slate-900">Tutup Sesi Toko</h2>
					<p class="mt-1 text-xs font-medium text-slate-500">
						Cek dan pastikan ringkasan uang kasir sebelum menutup sesi.
					</p>
				</div>

				<div class="mb-5 space-y-2 text-xs font-medium text-slate-600">
					<div class="flex items-center justify-between rounded-xl bg-slate-50 p-3">
						<span>Modal Awal Kas</span>
						<span class="font-bold text-slate-900">Rp {formatRupiah(ringkasanTutup.modalAwal)}</span
						>
					</div>
					<div class="flex items-center justify-between rounded-xl bg-slate-50 p-3">
						<span>Total Penjualan</span>
						<span class="font-bold text-slate-900"
							>Rp {formatRupiah(ringkasanTutup.totalPenjualan)}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl bg-emerald-50/70 p-3 text-emerald-800"
					>
						<span>Pemasukan Tunai</span>
						<span class="font-bold">Rp {formatRupiah(ringkasanTutup.pemasukanTunai)}</span>
					</div>
					<div class="flex items-center justify-between rounded-xl bg-rose-50/70 p-3 text-rose-800">
						<span>Pengeluaran Tunai</span>
						<span class="font-bold">Rp {formatRupiah(ringkasanTutup.pengeluaranTunai)}</span>
					</div>

					<div
						class="mt-3 flex flex-col items-center justify-center rounded-2xl border-2 border-pink-500/20 bg-pink-50/50 p-4 text-center"
					>
						<span class="text-xs font-bold text-pink-700">Uang Kasir Seharusnya (Fisik)</span>
						<span class="mt-1 text-2xl font-black tracking-tight text-pink-600">
							Rp {formatRupiah(ringkasanTutup.uangKasir)}
						</span>
						<span class="mt-1 text-[11px] text-slate-400"
							>Pastikan uang fisik di laci kasir sesuai</span
						>
					</div>
				</div>

				{#if pinErrorToko}
					<div
						class="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-600"
					>
						{pinErrorToko}
					</div>
				{/if}

				<button
					type="button"
					class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-rose-500/25 transition-all hover:opacity-95 active:scale-[0.98]"
					onclick={handleTutupToko}
				>
					<Lock size={18} class="stroke-[2.2]" />
					<span>Konfirmasi & Tutup Toko</span>
				</button>
			{/if}
		</div>
	</div>
{/if}
