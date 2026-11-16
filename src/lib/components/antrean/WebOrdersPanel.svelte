<script lang="ts">
	import { onMount } from 'svelte';
	import Globe from '@lucide/svelte/icons/globe';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	import { parseApiError } from '$lib/utils/errorHandling';
	import { formatRupiah } from '$lib/utils/currency';

	interface WebItem {
		menuItemId: string;
		name?: string;
		qty: number;
		size?: 'REG' | 'JUMBO';
		sweet?: string;
		ice?: string;
	}
	interface WebOrder {
		id: string;
		name: string;
		pickupNote: string | null;
		note: string | null;
		total: number;
		uniqueCode: number;
		payTotal: number;
		items: WebItem[];
		createdAt: number;
	}

	/** Dipanggil setelah Terima berhasil agar daftar Diproses memuat kartu barunya. */
	let { onAccepted }: { onAccepted?: () => void } = $props();

	const POLL_MS = 15000;
	const LEVEL: Record<string, string> = { NORMAL: 'normal', LESS: 'sedikit', NONE: 'tanpa' };

	let enabled = $state(false);
	let unavailable = $state(false);
	let orders = $state<WebOrder[]>([]);
	let busyId = $state<string | null>(null);
	let message = $state<string | null>(null);
	let lastCount = 0;

	function beep() {
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			osc.frequency.value = 880;
			osc.connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + 0.25);
			osc.onended = () => void ctx.close();
		} catch (error) {
			console.warn('[antrean-web] bunyi pemberitahuan tidak tersedia', error);
		}
	}

	async function load() {
		try {
			const response = await fetch('/api/antrean/web', { cache: 'no-store' });
			if (!response.ok) {
				unavailable = true;
				return;
			}
			const body = (await response.json()) as {
				data: { enabled: boolean; unavailable: boolean; orders: WebOrder[] };
			};
			enabled = body.data.enabled;
			unavailable = body.data.unavailable;
			if (!body.data.unavailable) {
				if (body.data.orders.length > lastCount) beep();
				lastCount = body.data.orders.length;
				orders = body.data.orders;
			}
		} catch (error) {
			console.warn('[antrean-web] gagal memuat pesanan web', error);
			unavailable = true;
		}
	}

	async function act(order: WebOrder, action: 'terima' | 'tolak') {
		if (busyId) return;
		busyId = order.id;
		message = null;
		try {
			const response = await fetchWithCsrfRetry(`/api/antrean/web/${order.id}/${action}`, {
				method: 'POST'
			});
			if (!response.ok) {
				message = await parseApiError(response, 'Gagal memproses pesanan web');
				return;
			}
			orders = orders.filter((candidate) => candidate.id !== order.id);
			lastCount = orders.length;
			if (action === 'terima') onAccepted?.();
		} catch (error) {
			console.warn('[antrean-web] aksi gagal', error);
			message = 'Tidak bisa menghubungi server. Coba lagi.';
		} finally {
			busyId = null;
		}
	}

	function describe(item: WebItem): string {
		const options = [
			item.size === 'JUMBO' ? 'Jumbo' : null,
			item.sweet && item.sweet !== 'NORMAL' ? `gula ${LEVEL[item.sweet] ?? item.sweet}` : null,
			item.ice && item.ice !== 'NORMAL' ? `es ${LEVEL[item.ice] ?? item.ice}` : null
		].filter(Boolean);
		return `${item.qty}× ${item.name ?? item.menuItemId}${options.length ? ` (${options.join(', ')})` : ''}`;
	}

	onMount(() => {
		void load();
		const timer = window.setInterval(() => {
			if (document.visibilityState === 'visible') void load();
		}, POLL_MS);
		return () => window.clearInterval(timer);
	});
</script>

{#if enabled}
	<section class="mb-4 space-y-3" aria-label="Pesanan web menunggu cek QRIS">
		<div class="flex items-center gap-2 px-1 text-sm font-extrabold text-pink-800">
			<Globe class="h-4 w-4" />
			Pesanan web menunggu cek QRIS
			{#if orders.length > 0}
				<span class="rounded-full bg-pink-600 px-2 py-0.5 text-xs text-white">{orders.length}</span>
			{/if}
		</div>
		{#if unavailable}
			<p class="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
				Pesanan web belum bisa dimuat. Daftar ini diperbarui otomatis; pesanan kasir tidak
				terganggu.
			</p>
		{/if}
		{#if message}
			<p class="rounded-2xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{message}</p>
		{/if}
		{#each orders as order (order.id)}
			<article
				class="rounded-[24px] border-2 border-dashed border-pink-300 bg-pink-50/80 p-4 shadow-md md:p-5"
				data-testid="web-order-card"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div class="text-xs font-bold text-pink-700">{order.id}</div>
						<div class="truncate text-base font-extrabold text-slate-900">{order.name}</div>
						{#if order.pickupNote}
							<div class="text-xs text-slate-500">Ambil: {order.pickupNote}</div>
						{/if}
					</div>
					<div class="shrink-0 text-right">
						<div class="text-[11px] font-bold text-slate-500">Cocokkan dengan QRIS masuk</div>
						<div class="text-2xl font-extrabold text-pink-700 tabular-nums">
							{formatRupiah(order.payTotal)}
						</div>
					</div>
				</div>
				<ul class="mt-2 space-y-0.5 text-sm text-slate-700">
					{#each order.items as item, index (index)}
						<li>{describe(item)}</li>
					{/each}
				</ul>
				{#if order.note}
					<p class="mt-1 text-xs text-slate-500">Catatan: {order.note}</p>
				{/if}
				<p class="mt-1 text-[11px] text-slate-500">
					Harga menu {formatRupiah(order.total)} + kode unik {order.uniqueCode}. Omzet tercatat
					sebesar harga menu.
				</p>
				<div class="mt-3 flex gap-2">
					<button
						type="button"
						disabled={busyId !== null}
						onclick={() => act(order, 'tolak')}
						class="min-h-[44px] flex-1 cursor-pointer rounded-full border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 disabled:opacity-50"
					>
						Tolak
					</button>
					<button
						type="button"
						disabled={busyId !== null}
						onclick={() => act(order, 'terima')}
						class="min-h-[44px] flex-[2] cursor-pointer rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 text-sm font-bold text-white shadow-md disabled:opacity-50"
					>
						{busyId === order.id ? 'Memproses' : 'Uang masuk, terima'}
					</button>
				</div>
			</article>
		{/each}
		{#if orders.length === 0 && !unavailable}
			<p class="px-1 text-xs text-slate-400">Belum ada pesanan web.</p>
		{/if}
	</section>
{/if}
