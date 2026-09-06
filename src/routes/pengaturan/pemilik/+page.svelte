<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Shield from '@lucide/svelte/icons/shield';
	import History from '@lucide/svelte/icons/history';
	import Archive from '@lucide/svelte/icons/archive';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import { userRole } from '$lib/stores/userRole.svelte';

	onMount(() => {
		if (userRole.value !== 'pemilik' && userRole.value !== 'admin') {
			goto('/unauthorized');
		}
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<a
				href="/pengaturan"
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali ke Pengaturan"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</a>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Pemilik</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col px-4 md:px-6">
		<div class="grid w-full grid-cols-2 gap-3.5 md:grid-cols-3 md:gap-5">
			<!-- 1. Manajemen Menu -->
			<a
				href="/pengaturan/pemilik/manajemenmenu"
				class="soft-float-card group flex flex-col justify-between p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
			>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-50 text-pink-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<Utensils class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Manajemen Menu</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						Kelola daftar produk, kategori, varian es/gula & ekstra
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-pink-600 md:text-xs">
					<span>Buka Menu &rarr;</span>
				</div>
			</a>

			<!-- 2. Manajemen & Alarm Stok -->
			<a
				href="/pengaturan/pemilik/stok"
				class="soft-float-card group relative flex flex-col justify-between border-pink-200/80 bg-gradient-to-b from-pink-50/40 to-white p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] md:p-6"
			>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<Boxes class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Pengaturan Stok</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						Kebijakan kunci checkout stok habis & alarm notifikasi
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-rose-600 md:text-xs">
					<span>Kelola Stok &rarr;</span>
				</div>
			</a>

			<!-- 3. Pengaturan Pajak (BARU) -->
			<a
				href="/pengaturan/pemilik/pajak"
				class="soft-float-card group relative flex flex-col justify-between border-pink-200/80 bg-gradient-to-b from-pink-50/40 to-white p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] md:p-6"
			>
				<span
					class="absolute top-3.5 right-3.5 rounded-full bg-pink-600 px-2 py-0.5 text-[9px] font-black text-white shadow-xs md:text-[10px]"
				>
					Baru
				</span>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-pink-100 text-pink-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<ReceiptText class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Pengaturan Pajak</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						PPh Final 0,5%, PBJT Restoran 10%, PPN & Pajak Kustom
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-pink-600 md:text-xs">
					<span>Atur Pajak &rarr;</span>
				</div>
			</a>

			<!-- 4. Ganti Keamanan -->
			<a
				href="/pengaturan/pemilik/gantikeamanan"
				class="soft-float-card group flex flex-col justify-between p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] md:p-6"
			>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<Shield class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Ganti Keamanan</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						Ubah password akun pemilik & otorisasi PIN kasir
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-blue-600 md:text-xs">
					<span>Atur Sandi &rarr;</span>
				</div>
			</a>

			<!-- 5. Riwayat Transaksi -->
			<a
				href="/pengaturan/pemilik/riwayat"
				class="soft-float-card group flex flex-col justify-between p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] md:p-6"
			>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<History class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Riwayat Transaksi</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						Pantau dan hapus transaksi hari ini jika ada koreksi
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-amber-600 md:text-xs">
					<span>Buka Riwayat &rarr;</span>
				</div>
			</a>

			<!-- 6. Arsip Data -->
			<a
				href="/pengaturan/pemilik/arsip"
				class="soft-float-card group flex flex-col justify-between p-5 text-left transition-all duration-200 hover:shadow-lg active:scale-[0.98] md:p-6"
			>
				<div>
					<div
						class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-2xs transition-transform group-hover:scale-105 md:h-12 md:w-12"
					>
						<Archive class="h-6 w-6 stroke-[2.2]" />
					</div>
					<h2 class="text-sm font-black text-slate-900 md:text-base">Arsip Data</h2>
					<p class="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 md:text-sm">
						Arsipkan rekaman lama agar memori database tetap ringan
					</p>
				</div>
				<div class="mt-3 flex items-center text-[11px] font-bold text-emerald-600 md:text-xs">
					<span>Kelola Arsip &rarr;</span>
				</div>
			</a>
		</div>
	</div>
</div>
