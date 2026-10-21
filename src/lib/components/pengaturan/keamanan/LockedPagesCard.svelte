<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import Home from '@lucide/svelte/icons/home';
	import Receipt from '@lucide/svelte/icons/receipt';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';

	import type { SecuritySettingsState } from '$lib/stores/securitySettingsState.svelte';

	let { s }: { s: SecuritySettingsState } = $props();
</script>

<!-- Card B: Halaman Terkunci (Proteksi Akses) -->
<div class="soft-float-card p-5 md:p-6">
	<div class="mb-4 flex items-center justify-between border-b border-pink-100/80 pb-3.5">
		<div class="flex items-center gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
			>
				<Lock class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
			</div>
			<div>
				<h2 class="text-sm font-black text-slate-900 md:text-base">Proteksi Halaman</h2>
				<p class="text-xs text-slate-500 md:text-sm">Kunci menu tertentu dengan PIN</p>
			</div>
		</div>
	</div>

	<p class="mb-3.5 text-xs leading-relaxed text-slate-500 md:text-sm">
		Halaman yang diaktifkan di bawah ini akan mewajibkan verifikasi PIN saat dibuka oleh staf atau
		pengunjung kios.
	</p>

	<!-- List Toggle Switch Halaman -->
	<div class="mb-4 space-y-2.5">
		<!-- 1. Beranda -->
		<button
			type="button"
			class="flex w-full cursor-pointer items-center justify-between rounded-2xl border p-3.5 text-left transition-all duration-200 {s.lockedPages.includes(
				'beranda'
			)
				? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
				: 'border-slate-100 bg-white hover:border-pink-100'}"
			onclick={() => s.togglePageLock('beranda')}
			aria-pressed={s.lockedPages.includes('beranda')}
		>
			<span class="flex items-center gap-3">
				<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
					<Home class="h-4.5 w-4.5 stroke-[2.2]" />
				</span>
				<span class="block">
					<span class="block text-xs font-bold text-slate-900 md:text-sm">Beranda</span>
					<span class="block text-[11px] text-slate-400">Proteksi ringkasan & metrik dashboard</span
					>
				</span>
			</span>
			<span
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {s.lockedPages.includes(
					'beranda'
				)
					? 'bg-pink-600'
					: 'bg-slate-200'}"
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.lockedPages.includes(
						'beranda'
					)
						? 'translate-x-5'
						: 'translate-x-0'}"
				></span>
			</span></button
		>

		<!-- 2. Catat Transaksi -->
		<button
			type="button"
			class="flex w-full cursor-pointer items-center justify-between rounded-2xl border p-3.5 text-left transition-all duration-200 {s.lockedPages.includes(
				'catat'
			)
				? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
				: 'border-slate-100 bg-white hover:border-pink-100'}"
			onclick={() => s.togglePageLock('catat')}
			aria-pressed={s.lockedPages.includes('catat')}
		>
			<span class="flex items-center gap-3">
				<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
					<Receipt class="h-4.5 w-4.5 stroke-[2.2]" />
				</span>
				<span class="block">
					<span class="block text-xs font-bold text-slate-900 md:text-sm"
						>Catat Transaksi Manual</span
					>
					<span class="block text-[11px] text-slate-400">Proteksi input pengeluaran & kas</span>
				</span>
			</span>
			<span
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {s.lockedPages.includes(
					'catat'
				)
					? 'bg-pink-600'
					: 'bg-slate-200'}"
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.lockedPages.includes(
						'catat'
					)
						? 'translate-x-5'
						: 'translate-x-0'}"
				></span>
			</span></button
		>

		<!-- 3. Laporan Keuangan -->
		<button
			type="button"
			class="flex w-full cursor-pointer items-center justify-between rounded-2xl border p-3.5 text-left transition-all duration-200 {s.lockedPages.includes(
				'laporan'
			)
				? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
				: 'border-slate-100 bg-white hover:border-pink-100'}"
			onclick={() => s.togglePageLock('laporan')}
			aria-pressed={s.lockedPages.includes('laporan')}
		>
			<span class="flex items-center gap-3">
				<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600">
					<BarChart3 class="h-4.5 w-4.5 stroke-[2.2]" />
				</span>
				<span class="block">
					<span class="block text-xs font-bold text-slate-900 md:text-sm">Laporan Keuangan</span>
					<span class="block text-[11px] text-slate-400">Proteksi data omzet & laba bersih</span>
				</span>
			</span>
			<span
				class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {s.lockedPages.includes(
					'laporan'
				)
					? 'bg-pink-600'
					: 'bg-slate-200'}"
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.lockedPages.includes(
						'laporan'
					)
						? 'translate-x-5'
						: 'translate-x-0'}"
				></span>
			</span></button
		>
	</div>

	<button
		type="button"
		disabled={s.isSavingPages}
		onclick={s.saveLockedPages}
		class="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
	>
		{s.isSavingPages ? 'Menyimpan...' : 'Simpan Pengaturan Halaman'}
	</button>
</div>
