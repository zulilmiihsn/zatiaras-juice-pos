<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { createOrderQueueState } from '$lib/stores/orderQueueState.svelte';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import { isTodayWita } from '$lib/utils/dateTime';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Check from '@lucide/svelte/icons/check';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import type { UiOrder } from '$lib/utils/orderQueueLocal';
	import { formatNomorHarian } from '$lib/utils/orderNumber';
	import NomorPesananLabel from '$lib/components/shared/NomorPesananLabel.svelte';
	import OrderItemsList from '$lib/components/antrean/OrderItemsList.svelte';

	const s = createOrderQueueState();
	let selectedKey = $state<string | null>(null);
	let now = $state<Date | null>(null);
	let searchOpen = $state(false);
	let searchInput: HTMLInputElement | undefined = $state();
	const selectedCard = $derived(s.items.find((card) => card.idempotency_key === selectedKey));

	/**
	 * Buka/tutup pencarian. Menutup = selesai mencari: kata kunci ikut
	 * dihapus agar daftar kembali penuh.
	 */
	function toggleSearch(force?: boolean) {
		const next = force ?? !searchOpen;
		searchOpen = next;
		if (!next) s.searchKeyword = '';
	}

	$effect(() => {
		if (searchOpen) {
			const timer = window.setTimeout(() => searchInput?.focus(), 60);
			return () => window.clearTimeout(timer);
		}
	});

	onMount(() => {
		s.start();
		now = new Date();
		const clock = window.setInterval(() => (now = new Date()), 60_000);
		return () => window.clearInterval(clock);
	});
	onDestroy(() => {
		s.dispose();
	});

	function formatWaktu(iso: string): string {
		const date = new Date(iso);
		if (!Number.isFinite(date.getTime())) return '--:--';
		try {
			return new Intl.DateTimeFormat('id-ID', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Makassar'
			}).format(date);
		} catch {
			return '--:--';
		}
	}

	function formatTanggal(iso: string): string {
		const date = new Date(iso);
		if (!Number.isFinite(date.getTime())) return '--';
		return new Intl.DateTimeFormat('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Makassar'
		}).format(date);
	}

	function isSyncing(card: UiOrder): boolean {
		return Boolean(s.syncing[card.idempotency_key]);
	}
</script>

<svelte:window
	onkeydown={(event) => {
		// Fokus sheet dipasang setelah animasi; Escape tetap harus bekerja sebelum fokus berpindah.
		if (event.key === 'Escape' && selectedCard && s.activeTab === 'done') selectedKey = null;
		// Tutup panel cari bila dialog detail tidak terbuka.
		if (event.key === 'Escape' && searchOpen && !selectedCard) toggleSearch(false);
	}}
/>

<svelte:head>
	<title>Antrean Pesanan - Zatiaras POS</title>
</svelte:head>

<div class="flex min-h-[calc(100dvh-64px)] w-full flex-col bg-[#faf7f8]">
	<div class="page-header relative px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>
		<div class="mx-auto w-full max-w-5xl">
			<div class="relative z-10 mb-3 text-center md:mb-4">
				<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs md:text-xl">
					Antrean Pesanan
				</h1>
				<p class="text-xs font-medium text-white/85 md:text-sm">
					{s.pendingCount > 0 ? `${s.pendingCount} pesanan belum selesai` : 'Semua pesanan beres'}
				</p>
			</div>

			<div class="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-center gap-2">
				<button
					type="button"
					class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-xs backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
					onclick={() => s.load(s.activeTab)}
					aria-label="Muat ulang Antrean"
				>
					<RefreshCw class="h-4.5 w-4.5 stroke-[2.2]" />
				</button>

				<div
					class="relative flex min-w-0 flex-1 rounded-full border border-white/40 bg-white/25 p-1 backdrop-blur-xl sm:max-w-sm sm:flex-none sm:basis-96"
					role="tablist"
					aria-label="Status pesanan"
				>
					<div
						class="absolute top-1 bottom-1 left-1 z-0 w-[calc(50%-4px)] rounded-full bg-white shadow-md transition-transform duration-200 ease-out"
						style="transform: translateX({s.activeTab === 'done' ? '100%' : '0'});"
					></div>
					<button
						type="button"
						role="tab"
						aria-selected={s.activeTab === 'pending'}
						aria-current={s.activeTab === 'pending' ? 'page' : undefined}
						class="z-10 h-9 min-h-0 min-w-0 flex-1 cursor-pointer truncate rounded-full px-2 text-xs font-bold transition-all duration-200 focus:outline-none md:h-10 md:text-sm {s.activeTab ===
						'pending'
							? 'text-pink-700'
							: 'text-white'}"
						onclick={() => s.setTab('pending')}
					>
						Belum selesai
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={s.activeTab === 'done'}
						aria-current={s.activeTab === 'done' ? 'page' : undefined}
						class="z-10 h-9 min-h-0 min-w-0 flex-1 cursor-pointer truncate rounded-full px-2 text-xs font-bold transition-all duration-200 focus:outline-none md:h-10 md:text-sm {s.activeTab ===
						'done'
							? 'text-pink-700'
							: 'text-white'}"
						onclick={() => s.setTab('done')}
					>
						Selesai
					</button>
				</div>
				<!-- Tombol cari: ganti spacer penyeimbang agar pil tetap tengah -->
				<button
					type="button"
					class="relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-xs backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => toggleSearch()}
					aria-label="Cari pesanan"
					aria-expanded={searchOpen}
				>
					<Search class="h-4.5 w-4.5 stroke-[2.2]" />
				</button>
			</div>
		</div>
	</div>

	<style>
		/* Satu tombol hapus kustom; sembunyikan bawaan browser agar tak ganda. */
		.cari-antrean::-webkit-search-cancel-button {
			display: none;
		}
	</style>

	<main
		class="relative z-20 mx-auto -mt-4 w-full max-w-5xl flex-1 px-4 pb-24 md:px-6"
		aria-live="polite"
	>
		{#if searchOpen}
			<!-- Kartu cari inline: ikut alur layout, tak pernah menutupi daftar -->
			<div
				class="mb-3 rounded-[24px] border border-white/60 bg-white/90 p-3 shadow-xl"
				role="search"
				aria-label="Cari pesanan"
				transition:fly={{ y: -28, duration: 260, easing: cubicOut }}
				onfocusout={(e) => {
					// Fokus pindah ke luar kartu (ketuk daftar/luar) = selesai mencari.
					const next = e.relatedTarget as Node | null;
					if (next && e.currentTarget.contains(next)) return;
					toggleSearch(false);
				}}
			>
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-pink-400"
					/>
					<input
						type="search"
						placeholder="Cari nama / nomor, misal 001 haura..."
						aria-label="Cari pesanan berdasarkan nama, nomor, atau gabungan keduanya"
						value={s.searchKeyword}
						oninput={(e) => (s.searchKeyword = e.currentTarget.value)}
						onkeydown={(e) => {
							if (e.key === 'Escape') toggleSearch(false);
						}}
						bind:this={searchInput}
						class="cari-antrean w-full rounded-2xl bg-slate-50/70 py-3 pr-11 pl-11 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-pink-200"
					/>
					{#if s.searchKeyword}
						<button
							type="button"
							aria-label="Bersihkan pencarian"
							onclick={() => {
								s.searchKeyword = '';
								searchInput?.focus();
							}}
							class="absolute top-1/2 right-3 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-pink-50 hover:text-pink-700"
						>
							<X class="h-4 w-4" />
						</button>
					{/if}
				</div>
				{#if s.searchKeyword.trim()}
					<p class="px-3 py-2 text-xs text-slate-500">
						{s.filteredItems.length > 0
							? `${s.filteredItems.length} pesanan cocok dengan “${s.searchKeyword.trim()}”.`
							: `Tidak ada yang cocok dengan “${s.searchKeyword.trim()}”.`}
					</p>
				{:else}
					<p class="px-3 py-2 text-xs text-slate-400">
						Ketik nama, nomor, atau gabung misal 001 haura
					</p>
				{/if}
			</div>
		{/if}
		{#if s.error}
			<div
				class="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
			>
				{s.error}
			</div>
		{/if}
		{#if s.loading && s.items.length === 0}
			<div class="space-y-3">
				{#each [1, 2, 3] as i}
					<div class="animate-pulse rounded-[24px] border border-white/60 bg-white/80 p-4 md:p-5">
						<div class="h-4 w-1/3 rounded-full bg-slate-200"></div>
						<div class="mt-3 h-3 w-2/3 rounded-full bg-slate-100"></div>
						<div class="mt-2 h-3 w-1/2 rounded-full bg-slate-100"></div>
					</div>
				{/each}
			</div>
		{:else if s.filteredItems.length === 0}
			{#if s.searchKeyword.trim() && s.items.length > 0}
				<div
					class="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-pink-200/80 bg-white/80 px-6 py-14 text-center"
				>
					<Search class="mb-3 h-10 w-10 text-pink-300" />
					<div class="text-base font-extrabold text-slate-800">Tidak ada yang cocok</div>
					<div class="mt-1 max-w-xs text-xs text-slate-500">
						Tidak ada pesanan dengan nama atau nomor “{s.searchKeyword.trim()}” di daftar yang
						dimuat.
					</div>
					<button
						type="button"
						onclick={() => toggleSearch(false)}
						class="mt-4 min-h-[44px] cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-6 text-sm font-bold text-white shadow-md transition-all active:scale-95"
					>
						Hapus pencarian
					</button>
				</div>
			{:else}
				<div
					class="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-pink-200/80 bg-white/80 px-6 py-14 text-center"
				>
					<ClipboardList class="mb-3 h-10 w-10 text-pink-300" />
					<div class="text-base font-extrabold text-slate-800">
						{s.activeTab === 'pending' ? 'Antrean kosong' : 'Belum ada yang selesai'}
					</div>
					<div class="mt-1 max-w-xs text-xs text-slate-500">
						{s.activeTab === 'pending'
							? 'Pesanan baru dari Kasir akan muncul di sini.'
							: 'Pesanan yang ditandai selesai akan tampil di sini.'}
					</div>
				</div>
			{/if}
		{:else}
			<div class="space-y-3">
				{#each s.filteredItems as card (card.idempotency_key)}
					<article
						class="rounded-[24px] border border-white/60 bg-white/90 p-4 shadow-xl backdrop-blur-lg md:p-5"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<NomorPesananLabel
									nomor={card.nomor_harian}
									menunggu={card.unsynced}
									kelas="text-3xl font-extrabold tabular-nums leading-none tracking-tight text-pink-700"
									kelasMenunggu="text-3xl font-extrabold tabular-nums leading-none tracking-tight text-amber-600"
								/>
								<div class="mt-1 truncate text-base font-extrabold text-slate-900">
									{card.nama_pelanggan || 'Tanpa nama'}
								</div>
								<div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
									<span
										>{s.activeTab === 'pending' && now && isTodayWita(card.waktu, now)
											? 'Hari ini'
											: formatTanggal(card.waktu)}</span
									>
									<span aria-hidden="true">·</span>
									<span>{formatWaktu(card.waktu)} WITA</span>
									<span aria-hidden="true">·</span>
									<span>{card.items.reduce((n, i) => n + i.jumlah, 0)} gelas</span>
									{#if card.unsynced}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"
										>
											<WifiOff class="h-3 w-3" />
											Belum tersinkron
										</span>
									{/if}
								</div>
							</div>
							{#if s.activeTab === 'pending'}
								<button
									type="button"
									disabled={isSyncing(card)}
									class="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 text-sm font-bold text-white shadow-md transition-all active:scale-95 disabled:cursor-wait disabled:opacity-60"
									onclick={() => s.setStatus(card, 'done')}
									aria-label={`Tandai selesai pesanan ${card.nama_pelanggan || card.idempotency_key}`}
								>
									<Check class="h-4 w-4 stroke-[2.5]" />
									{isSyncing(card) ? 'Menyimpan' : 'Selesai'}
								</button>
							{:else}
								<button
									type="button"
									disabled={isSyncing(card)}
									class="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 shadow-2xs transition-all active:scale-95 disabled:cursor-wait disabled:opacity-60"
									onclick={() => s.setStatus(card, 'pending')}
									aria-label={`Buka lagi pesanan ${card.nama_pelanggan || card.idempotency_key}`}
								>
									<Undo2 class="h-4 w-4" />
									{isSyncing(card) ? 'Menyimpan' : 'Buka lagi'}
								</button>
							{/if}
						</div>
						{#if s.activeTab === 'done'}
							<div
								class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"
							>
								<span class="text-sm font-bold text-slate-800">
									{card.nominal !== null
										? `Total Rp${formatRupiah(card.nominal)}`
										: 'Total belum tersedia'}
								</span>
								<button
									type="button"
									class="min-h-[44px] cursor-pointer rounded-full px-4 text-sm font-bold text-pink-700 hover:bg-pink-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600"
									onclick={() => (selectedKey = card.idempotency_key)}
									aria-label={`Lihat detail pesanan ${card.nama_pelanggan || formatNomorHarian(card.nomor_harian) || 'tanpa nama'}`}
								>
									Lihat detail
								</button>
							</div>
						{:else}
							<OrderItemsList items={card.items} />
						{/if}
					</article>
				{/each}
			</div>
			{#if s.hasMore}
				<button
					type="button"
					class="mx-auto mt-4 flex min-h-[44px] cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-bold text-slate-700 shadow-2xs transition-all active:scale-95"
					onclick={() => s.loadMore()}
				>
					Muat lebih banyak
				</button>
			{/if}
		{/if}
	</main>
</div>

<AppModal
	open={Boolean(selectedCard) && s.activeTab === 'done'}
	label="Detail pesanan"
	size="sm"
	align="center"
	panelClass="bg-white"
	onClose={() => (selectedKey = null)}
>
	{#if selectedCard}
		<div class="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
			<h2 class="truncate text-base font-extrabold text-slate-900" id="antrean-detail-title">
				Detail pesanan {selectedCard.nama_pelanggan || 'Tanpa nama'}
			</h2>
			<button
				type="button"
				onclick={() => (selectedKey = null)}
				aria-label="Tutup detail pesanan"
				class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-800 active:scale-90"
			>
				<X class="h-4 w-4 stroke-[2.2]" />
			</button>
		</div>
		<div class="max-h-[70dvh] min-h-0 overflow-y-auto px-5 py-4">
			<NomorPesananLabel
				nomor={selectedCard.nomor_harian}
				menunggu={selectedCard.unsynced}
				kelas="text-3xl font-extrabold tabular-nums leading-none tracking-tight text-pink-700"
				kelasMenunggu="text-3xl font-extrabold tabular-nums leading-none tracking-tight text-amber-600"
			/>
			<p class="mt-1 text-xs text-slate-500">
				{formatTanggal(selectedCard.waktu)} · {formatWaktu(selectedCard.waktu)} WITA · {selectedCard.items.reduce(
					(n, i) => n + i.jumlah,
					0
				)} gelas
			</p>
			{#if selectedCard.unsynced}
				<p class="mt-2 text-xs font-bold text-amber-800">Belum tersinkron</p>
			{/if}
			<OrderItemsList items={selectedCard.items} varian="dialog" />
			<p class="border-t border-slate-100 pt-3 text-right text-sm font-extrabold text-slate-900">
				{selectedCard.nominal !== null
					? `Total Rp${formatRupiah(selectedCard.nominal)}`
					: 'Total belum tersedia'}
			</p>
		</div>
	{/if}
</AppModal>
