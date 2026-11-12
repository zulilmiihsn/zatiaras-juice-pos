<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import Download from '@lucide/svelte/icons/download';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	import { formatDateYmdWita } from '$lib/utils/dateTime';

	const today = formatDateYmdWita(new Date());
	const currentYear = Number(today.slice(0, 4));
	const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	let period = $state(String(currentYear));
	let from = $state(`${currentYear}-01-01`);
	let through = $state(today);
	let preview = $state<{
		counts: { buku_kas: number; transaksi_kasir: number };
		pending_orders: number;
	} | null>(null);
	let previewError = $state('');
	let previewLoading = $state(false);
	const validRange = $derived(Boolean(from && through && from <= through && through <= today));
	function changePeriod() {
		preview = null;
		showConfirm = false;
		if (period !== 'custom') {
			from = `${period}-01-01`;
			through = Number(period) === currentYear ? today : `${period}-12-31`;
		}
	}
	async function reviewArchive() {
		if (!validRange || previewLoading) return;
		previewLoading = true;
		previewError = '';
		const selected = `${from}/${through}`;
		try {
			const response = await fetch(`/api/archive?${new URLSearchParams({ from, through })}`);
			const data = await response.json();
			if (!response.ok) throw new Error(data.message || 'Gagal memeriksa periode arsip');
			if (selected !== `${from}/${through}` || destroyed) return;
			preview = data;
			showConfirm = true;
		} catch (error) {
			previewError = error instanceof Error ? error.message : 'Gagal memeriksa periode arsip';
		} finally {
			previewLoading = false;
		}
	}
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
		if (!validRange || loading || !preview || preview.pending_orders > 0) return;
		const selectedRange = { from, through };
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
					body: JSON.stringify(selectedRange)
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

<div data-hydrated={hydrated} class="page-content bg-canvas flex min-h-dvh flex-col pb-12">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan/pemilik" label="Kembali ke Pengaturan Pemilik">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Arsip Data Transaksi
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</PageHeader>

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
				<h2 class="mb-1 text-base font-bold text-slate-800">Pilih Periode Arsip</h2>
				<p class="mb-5 text-xs leading-relaxed text-slate-500">
					Tentukan transaksi yang ingin dipindahkan. Tanggal awal dan akhir termasuk dalam periode,
					mengikuti waktu WITA.
				</p>
				<label for="thn" class="mb-2 block text-xs font-bold text-slate-700">Periode</label>
				<select
					id="thn"
					bind:value={period}
					onchange={changePeriod}
					disabled={!hydrated || loading || previewLoading}
					class="mb-4 w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base focus:border-emerald-500 focus:outline-none disabled:opacity-60"
				>
					{#each years as y}
						<option value={String(y)}
							>Sepanjang {y}{y === currentYear ? ' (sampai hari ini)' : ''}</option
						>
					{/each}
					<option value="custom">Rentang tanggal sendiri</option>
				</select>
				<fieldset
					disabled={loading || previewLoading}
					class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
				>
					<div>
						<label for="archive-from" class="mb-2 block text-xs font-bold text-slate-700"
							>Tanggal mulai</label
						>
						<input
							id="archive-from"
							type="date"
							min="2020-01-01"
							max={through || today}
							bind:value={from}
							onchange={() => {
								period = 'custom';
								preview = null;
								showConfirm = false;
							}}
							class="w-full min-w-0 rounded-xl border-2 border-pink-100 bg-pink-50/30 px-3 py-3 text-sm text-slate-800 outline-none focus:border-pink-500"
						/>
					</div>
					<div>
						<label for="archive-through" class="mb-2 block text-xs font-bold text-slate-700"
							>Tanggal akhir</label
						>
						<input
							id="archive-through"
							type="date"
							min={from || '2020-01-01'}
							max={today}
							bind:value={through}
							onchange={() => {
								period = 'custom';
								preview = null;
								showConfirm = false;
							}}
							class="w-full min-w-0 rounded-xl border-2 border-pink-100 bg-pink-50/30 px-3 py-3 text-sm text-slate-800 outline-none focus:border-pink-500"
						/>
					</div>
				</fieldset>
				<p class="mb-4 rounded-xl bg-pink-50 px-3 py-3 text-xs leading-relaxed text-pink-800">
					Tutup sesi toko dan pastikan antrean offline seluruh perangkat cabang sudah tersinkron
					sebelum mengarsipkan.
				</p>
				{#if !validRange}<p role="alert" class="mb-3 text-xs text-rose-600">
						Pilih tanggal awal dan akhir yang valid, paling lambat hari ini.
					</p>{/if}
				{#if previewError}<p role="alert" class="mb-3 text-xs text-rose-600">{previewError}</p>{/if}
				{#if !showConfirm}
					<button
						onclick={reviewArchive}
						disabled={!hydrated || loading || previewLoading || !validRange}
						class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-3 text-sm font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:brightness-105 active:scale-98 disabled:opacity-50"
					>
						<Download class="h-4 w-4" />
						{#if loading}
							Mengarsipkan...
						{:else}
							{previewLoading ? 'Memeriksa periode…' : 'Periksa Periode Arsip'}
						{/if}
					</button>
				{:else}
					<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
						<p class="mb-3 text-xs text-amber-800">
							Periode <b>{from} sampai {through} (WITA)</b>: {preview?.counts.buku_kas ?? 0} transaksi
							dan {preview?.counts.transaksi_kasir ?? 0} detail kasir. Salinan diverifikasi di cloud sebelum
							data aktif dihapus.
							{#if preview?.pending_orders}<span class="mt-2 block font-bold"
									>Selesaikan {preview.pending_orders} pesanan Antrean terlebih dahulu.</span
								>{/if}
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (showConfirm = false)}
								class="flex-1 cursor-pointer rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
							>
								Batal
							</button>
							<button
								onclick={doArchive}
								disabled={!preview || preview.pending_orders > 0}
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
					<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
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
