<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import Download from '@lucide/svelte/icons/download';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
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
		job_id?: string;
		parts?: Array<{ jobId: string; filename: string }>;
		notice?: string;
	} | null>(null);
	let downloadState = $state<'idle' | 'downloading' | 'downloaded' | 'failed'>('idle');
	let downloadMessage = $state('');
	// Arsip setahun butuh beberapa panggilan; halaman melanjutkan sendiri.
	let progress = $state('');
	const MAX_ARCHIVE_CALLS = 500;
	// Navigasi keluar menghentikan loop: tak ada POST/unduhan baru di halaman lain.
	let destroyed = false;
	onDestroy(() => (destroyed = true));

	function triggerBrowserDownload(content: string, filename: string) {
		const blob = new Blob([content], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function downloadJob(jobId: string, filename: string): Promise<boolean> {
		downloadState = 'downloading';
		downloadMessage = '';
		try {
			const csrf = await fetch('/api/csrf').then((r) => (r.ok ? r.json() : null));
			const res = await fetch(`/api/archive/download?job_id=${encodeURIComponent(jobId)}`, {
				headers: csrf?.token ? { 'X-CSRF-Token': csrf.token } : {}
			});
			if (!res.ok) throw new Error('Unduhan arsip gagal. Coba lagi.');
			triggerBrowserDownload(await res.text(), filename);
			downloadState = 'downloaded';
			return true;
		} catch {
			downloadState = 'failed';
			downloadMessage = 'Unduhan arsip gagal. Coba lagi.';
			return false;
		}
	}

	async function doArchive() {
		showConfirm = false;
		loading = true;
		result = null;
		progress = '';
		downloadState = 'idle';
		downloadMessage = '';
		let archivedCount = 0;
		const archivedParts: Array<{ jobId: string; filename: string }> = [];
		let last: Record<string, unknown> = {};
		// Satu sumber hasil: total & daftar bagian seluruh panggilan sesi ini.
		const finish = (notice?: string) => {
			const only = archivedParts.length === 1 ? archivedParts[0] : null;
			const multiPart = archivedParts.length > 1;
			result = {
				ok: true,
				message: archivedCount ? undefined : (last.message as string | undefined),
				count: archivedCount || Number(last.count) || 0,
				parts: archivedParts.length
					? [...archivedParts]
					: (last.parts as Array<{ jobId: string; filename: string }> | undefined),
				filename: multiPart ? undefined : (only?.filename ?? (last.filename as string | undefined)),
				job_id: multiPart ? undefined : (only?.jobId ?? (last.job_id as string | undefined)),
				notice
			};
		};
		try {
			// Server memproses beberapa bagian per panggilan ('partial' bila masih ada sisa).
			// Halaman memanggil ulang sampai selesai; tiap bagian baru diunduh dulu
			// sebelum lanjut, dan unduhan gagal menghentikan loop (data aman di cloud).
			for (let call = 0; call < MAX_ARCHIVE_CALLS && !destroyed; call++) {
				const res = await fetchWithCsrfRetry('/api/archive', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ before_year: beforeYear })
				});
				const data = await res.json();
				if (!res.ok) throw new Error(data?.message || 'Gagal mengarsipkan');
				last = data;
				// 'resumed' = tak ada sisa; job lama sudah terhitung bila sesi ini mengarsipkan.
				if (data.resumed) return finish();

				const parts = Array.isArray(data.parts)
					? (data.parts as Array<{ jobId: string; filename: string }>)
					: [];
				archivedCount += data.count || 0;
				archivedParts.push(...parts);
				// A body error must not turn a valid archive commit into a false download success.
				for (const part of parts) {
					if (destroyed) return;
					if (!(await downloadJob(part.jobId, part.filename || 'arsip.json'))) {
						return finish(
							data.partial
								? 'Pengarsipan dijeda karena unduhan bagian gagal. Bagian yang sudah diarsipkan aman di cloud; unduh ulang lewat tombol di atas, lalu tekan Arsipkan lagi untuk melanjutkan sisanya.'
								: 'Unduhan bagian gagal. Semua transaksi sudah diarsipkan dan aman di cloud; unduh ulang lewat tombol di atas.'
						);
					}
				}
				if (!data.partial) return finish();
				// Server berhenti karena satu bagian gagal: tampilkan alasannya; ulang langsung
				// bisa menabrak lease job gagal dan menutupi penyebab aslinya.
				if (data.interrupted)
					return finish(
						`Pengarsipan dijeda: ${data.interrupted} Bagian di atas aman di cloud; tekan Arsipkan lagi nanti untuk melanjutkan.`
					);
				progress = `${archivedCount} baris diarsipkan (${archivedParts.length} bagian). Melanjutkan…`;
			}
			if (destroyed) return;
			throw new Error('Pengarsipan belum selesai.');
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Gagal';
			// Baris yang sudah terarsip tetap dilaporkan, lengkap dengan tombol unduh per bagian.
			if (archivedCount > 0)
				finish(
					`Pengarsipan berhenti: ${message} Bagian yang sudah diarsipkan di atas aman di cloud.`
				);
			else result = { ok: false, count: 0, message };
		} finally {
			loading = false;
			progress = '';
		}
	}
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div class="page-header relative w-full px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<HeaderBackButton onclick={() => goto('/pengaturan/pemilik')}>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
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
							Yakin arsipkan transaksi <b>sebelum {beforeYear}</b>? Salinan arsip dapat diunduh
							setelah tersimpan di cloud.
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
		{#if loading && progress}
			<p class="mt-3 text-center text-sm font-semibold text-slate-600" role="status">{progress}</p>
		{/if}
		{#if result}
			<div class="mt-4" transition:slide|local>
				{#if result.ok && result.count > 0}
					<div
						class="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
					>
						<CheckCircle2 class="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
						<div class="text-sm text-emerald-800">
							<b>{result.count} baris</b> berhasil diarsipkan{#if result.filename && downloadState === 'downloaded'}
								& diunduh (<code class="text-xs">{result.filename}</code>)
							{:else if result.parts && result.parts.length > 1 && downloadState === 'downloaded'}
								({result.parts.length} bagian, dikirim ke unduhan browser)
							{/if}. Salinan juga tersimpan di cloud. Database kini lebih lega.
							{#if result.parts && result.parts.length > 1}
								<p class="mt-1 text-xs text-emerald-700">
									Jika browser meminta izin mengunduh banyak file, pilih Izinkan. Bagian yang belum
									tersimpan bisa diunduh ulang di bawah.
								</p>
							{/if}
							{#if result.notice}
								<p class="mt-2 text-xs font-bold text-amber-700" role="alert">{result.notice}</p>
							{/if}
							{#if result.job_id}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<button
										type="button"
										onclick={() =>
											downloadJob(result?.job_id as string, result?.filename || 'arsip.json')}
										disabled={downloadState === 'downloading'}
										class="cursor-pointer rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
									>
										{downloadState === 'downloading'
											? 'Mengunduh…'
											: downloadState === 'downloaded'
												? 'Unduh ulang arsip'
												: 'Unduh arsip'}
									</button>
									{#if downloadState === 'downloaded'}
										<span class="text-xs font-bold text-emerald-700">Unduhan selesai.</span>
									{:else if downloadState === 'failed'}
										<span class="text-xs font-bold text-rose-600">{downloadMessage}</span>
									{/if}
								</div>
							{/if}
							{#if result.parts && result.parts.length > 1}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									{#each result.parts as part}
										<button
											type="button"
											onclick={() => downloadJob(part.jobId, part.filename)}
											disabled={downloadState === 'downloading'}
											class="cursor-pointer rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 transition-all hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
										>
											Unduh {part.filename}
										</button>
									{/each}
								</div>
							{/if}
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
