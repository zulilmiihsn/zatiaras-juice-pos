<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Archive from '@lucide/svelte/icons/archive';
	import Download from '@lucide/svelte/icons/download';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import { userRole } from '$lib/stores/userRole.svelte';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';

	const currentYear = new Date().getFullYear();
	const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

	let beforeYear = $state(currentYear - 1);
	let loading = $state(false);
	let showConfirm = $state(false);
	let result = $state<{
		ok: boolean;
		count: number;
		message?: string;
		filename?: string;
	} | null>(null);

	onMount(() => {
		if (userRole.value !== 'pemilik') goto('/unauthorized');
	});

	async function doArchive() {
		showConfirm = false;
		loading = true;
		result = null;
		try {
			const res = await fetchWithCsrfRetry('/api/archive', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ before_year: beforeYear })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data?.message || 'Gagal mengarsipkan');

			// [CATATAN]: Unduh salinan ke perangkat owner (selain tersimpan di cloud).
			if (data.content) {
				const blob = new Blob([data.content], { type: 'application/json' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = data.filename || 'arsip.json';
				a.click();
				URL.revokeObjectURL(url);
			}
			result = data;
		} catch (e) {
			result = { ok: false, count: 0, message: e instanceof Error ? e.message : 'Gagal' };
		} finally {
			loading = false;
		}
	}
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<button
				onclick={() => goto('/pengaturan/pemilik')}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</button>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Arsip Data Transaksi
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
			<!-- Kartu penjelasan -->
			<div class="soft-float-card p-5">
				<div class="mb-3 flex items-center gap-3">
					<div
						class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"
					>
						<Archive class="h-6 w-6 stroke-[2.2]" />
					</div>
					<div>
						<h2 class="text-base font-bold text-slate-800">Arsipkan Transaksi Lama</h2>
						<p class="text-xs text-slate-400">Meringankan database, data tetap aman</p>
					</div>
				</div>
				<ul class="space-y-1.5 text-xs text-slate-600">
					<li class="flex gap-2">
						<span class="font-bold text-emerald-500">•</span> Transaksi lama diunduh sebagai file
						<b>.json</b> + disimpan ke cloud
					</li>
					<li class="flex gap-2">
						<span class="font-bold text-emerald-500">•</span> File bisa <b>dipulihkan</b> kapan saja (tidak
						hilang)
					</li>
					<li class="flex gap-2">
						<span class="font-bold text-emerald-500">•</span> Setelah itu dihapus dari database aktif
						agar ruang lega
					</li>
					<li class="flex gap-2">
						<span class="font-bold text-emerald-500">•</span> <b>Laporan & ringkasan</b> tetap utuh
					</li>
				</ul>
			</div>

			<!-- Pilih tahun + tombol -->
			<div class="soft-float-card p-5">
				<label for="thn" class="mb-2 block text-xs font-bold text-slate-700">
					Arsipkan semua transaksi <b>sebelum tahun:</b>
				</label>
				<select
					id="thn"
					bind:value={beforeYear}
					disabled={loading}
					class="mb-4 w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base focus:border-emerald-500 focus:outline-none disabled:opacity-60"
				>
					{#each years as y}
						<option value={y}>{y}</option>
					{/each}
				</select>

				{#if !showConfirm}
					<button
						onclick={() => (showConfirm = true)}
						disabled={loading}
						class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-98 disabled:opacity-50"
					>
						<Download class="h-4 w-4" />
						{#if loading}
							Mengarsipkan...
						{:else}
							Mulai Arsipkan
						{/if}
					</button>
				{:else}
					<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
						<p class="mb-3 text-xs text-amber-800">
							Yakin arsipkan transaksi <b>sebelum {beforeYear}</b>? File arsip akan otomatis
							diunduh.
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (showConfirm = false)}
								class="flex-1 cursor-pointer rounded-lg border border-gray-300 bg-white py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
							>
								Batal
							</button>
							<button
								onclick={doArchive}
								class="flex-1 cursor-pointer rounded-lg bg-red-600 py-2 text-xs font-semibold text-white hover:bg-red-700"
							>
								Ya, Lanjutkan
							</button>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Hasil -->
		{#if result}
			<div class="mt-4" transition:slide|local>
				{#if result.ok && result.count > 0}
					<div
						class="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
					>
						<CheckCircle2 class="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
						<div class="text-sm text-emerald-800">
							<b>{result.count} baris</b> berhasil diarsipkan & diunduh (<code class="text-xs"
								>{result.filename}</code
							>). Salinan juga tersimpan di cloud. Database kini lebih lega.
						</div>
					</div>
				{:else if result.ok}
					<div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
						{result.message || 'Tidak ada transaksi lama untuk diarsipkan.'}
					</div>
				{:else}
					<div class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
						Gagal: {result.message}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Modal konfirmasi -->
{#if showConfirm}
	<div
		class="z-alert fixed inset-0 flex items-end justify-center bg-black/30"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="mx-auto w-full max-w-md rounded-t-2xl bg-white p-6 pb-8 shadow-lg"
			transition:slide|local
		>
			<h3 class="mb-2 text-lg font-bold text-gray-800">Konfirmasi Arsip</h3>
			<p class="mb-5 text-sm text-gray-600">
				Semua transaksi <b>sebelum {beforeYear}</b> akan diunduh + disimpan ke cloud, lalu
				<b>dihapus dari database aktif</b>. Data bisa dipulihkan dari file arsip kapan saja.
			</p>
			<div class="flex gap-3">
				<button
					onclick={() => (showConfirm = false)}
					class="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-600 hover:bg-gray-200"
				>
					Batal
				</button>
				<button
					onclick={doArchive}
					class="flex-1 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-white hover:bg-emerald-600"
				>
					Ya, Arsipkan
				</button>
			</div>
		</div>
	</div>
{/if}
