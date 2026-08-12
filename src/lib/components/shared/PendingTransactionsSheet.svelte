<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import type { PendingFailureKind, PendingTransaction } from '$lib/utils/offlineQueue';
	import { buildPendingTransactionExport } from '$lib/utils/offlineQueue';
	import { formatRupiah } from '$lib/utils/currency';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Clock3 from 'lucide-svelte/icons/clock-3';
	import Download from 'lucide-svelte/icons/download';
	import FileWarning from 'lucide-svelte/icons/file-warning';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import ShieldAlert from 'lucide-svelte/icons/shield-alert';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	let {
		open = false,
		transactions = [],
		isOffline = false,
		isSyncing = false,
		canRemove = false,
		onClose,
		onRetry,
		onRetryAll,
		onRemove
	}: {
		open?: boolean;
		transactions?: PendingTransaction[];
		isOffline?: boolean;
		isSyncing?: boolean;
		canRemove?: boolean;
		onClose: () => void;
		onRetry: (queueId: string) => Promise<void>;
		onRetryAll: () => Promise<void>;
		onRemove: (queueId: string) => Promise<void>;
	} = $props();

	let pendingRemoval = $state<PendingTransaction | null>(null);
	let removalBusy = $state(false);

	function asRecord(value: unknown): Record<string, unknown> {
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	}

	function transactionSummary(item: PendingTransaction) {
		const summary = asRecord(item.summary);
		const request = asRecord(item.request);
		return {
			code:
				typeof summary.transaction_code === 'string'
					? summary.transaction_code
					: String(request.idempotency_key || item.queue_id).slice(0, 24),
			total: Number(summary.total_amount ?? request.cash_received ?? 0),
			payment: typeof request.metode_bayar === 'string' ? request.metode_bayar : 'tidak diketahui',
			createdAt: typeof summary.created_at === 'string' ? summary.created_at : item.created_at
		};
	}

	function formatDate(value: string): string {
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return 'Waktu tidak tersedia';
		return new Intl.DateTimeFormat('id-ID', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'Asia/Makassar'
		}).format(date);
	}

	function statusLabel(item: PendingTransaction): string {
		if (item.status === 'syncing') return 'Sedang dikirim';
		if (item.status === 'failed') return 'Gagal sinkron';
		return 'Menunggu sinkron';
	}

	function failureLabel(kind: PendingFailureKind): string {
		const labels: Record<Exclude<PendingFailureKind, null>, string> = {
			auth: 'Sesi login',
			conflict: 'Perlu pemeriksaan',
			network: 'Jaringan',
			rate_limit: 'Batas permintaan',
			server: 'Server'
		};
		return kind ? labels[kind] : 'Belum ada kegagalan';
	}

	function guidance(kind: PendingFailureKind): string {
		if (kind === 'auth') return 'Login ulang, lalu sistem akan mencoba kembali transaksi ini.';
		if (kind === 'conflict') {
			return 'Periksa detail dan export data sebelum retry. Harga bertanda tangan tidak boleh diedit.';
		}
		if (kind === 'rate_limit') return 'Tunggu sebentar. Sistem akan mencoba kembali otomatis.';
		if (kind === 'server') return 'Data tetap tersimpan. Coba lagi setelah layanan pulih.';
		if (kind === 'network') return 'Pastikan koneksi stabil. Sistem akan mencoba kembali otomatis.';
		return 'Transaksi aman di perangkat dan menunggu pengiriman.';
	}

	function exportTransactions(items: PendingTransaction[], suffix: string) {
		const payload = buildPendingTransactionExport(items);
		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: 'application/json;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `zatiaras-offline-${suffix}-${new Date().toISOString().replaceAll(':', '-')}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	async function confirmRemoval() {
		if (!pendingRemoval || removalBusy) return;
		removalBusy = true;
		try {
			await onRemove(pendingRemoval.queue_id);
			pendingRemoval = null;
		} finally {
			removalBusy = false;
		}
	}
</script>

<ModalSheet {open} title="Antrean transaksi offline" {onClose}>
	<div
		class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-2 pb-24"
		data-testid="pending-transaction-sheet"
	>
		<div class="grid grid-cols-[1.3fr_0.7fr] gap-3">
			<div class="rounded-2xl border border-stone-200 bg-stone-50 p-4">
				<div class="mb-1 text-xs font-bold tracking-[0.14em] text-stone-500 uppercase">
					Tersimpan lokal
				</div>
				<div class="text-3xl font-black text-stone-950">{transactions.length}</div>
				<div class="mt-1 text-xs leading-5 text-stone-600">
					Data tetap berada di perangkat sampai server menerima transaksi.
				</div>
			</div>
			<div class="rounded-2xl border border-pink-100 bg-pink-50 p-4">
				<div class="mb-1 text-xs font-bold tracking-[0.14em] text-pink-500 uppercase">Gagal</div>
				<div class="text-3xl font-black text-stone-950">
					{transactions.filter((item) => item.status === 'failed').length}
				</div>
				<div class="mt-1 text-xs leading-5 text-stone-600">Perlu retry atau pemeriksaan.</div>
			</div>
		</div>

		<div class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
			<ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
			<div class="text-xs leading-5 text-amber-950">
				Export sebelum menghapus transaksi bermasalah. Penghapusan lokal tidak mencatat penjualan ke
				server.
			</div>
		</div>

		{#if transactions.length === 0}
			<div
				class="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-6 text-center"
			>
				<FileWarning class="mb-3 h-10 w-10 text-stone-400" />
				<div class="text-base font-bold text-stone-900">Tidak ada antrean</div>
				<div class="mt-1 text-sm text-stone-500">Semua transaksi sudah tersinkron.</div>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each transactions as item (item.queue_id)}
					{@const summary = transactionSummary(item)}
					<section
						class="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_8px_24px_-18px_rgba(41,37,36,0.45)]"
						data-testid="pending-transaction-item"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<div class="truncate text-base font-black text-stone-950">{summary.code}</div>
								<div class="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
									<Clock3 class="h-3.5 w-3.5" />
									{formatDate(summary.createdAt)}
								</div>
							</div>
							<span
								class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold {item.status ===
								'failed'
									? 'bg-red-50 text-red-700'
									: item.status === 'syncing'
										? 'bg-blue-50 text-blue-700'
										: 'bg-amber-50 text-amber-700'}"
							>
								{statusLabel(item)}
							</span>
						</div>

						<div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-stone-100 py-3">
							<div>
								<div class="text-[11px] font-bold tracking-wide text-stone-400 uppercase">
									Total
								</div>
								<div class="mt-0.5 text-sm font-black text-stone-900">
									Rp {formatRupiah(summary.total)}
								</div>
							</div>
							<div>
								<div class="text-[11px] font-bold tracking-wide text-stone-400 uppercase">
									Pembayaran
								</div>
								<div class="mt-0.5 text-sm font-bold text-stone-900 capitalize">
									{summary.payment}
								</div>
							</div>
							<div>
								<div class="text-[11px] font-bold tracking-wide text-stone-400 uppercase">
									Jenis masalah
								</div>
								<div class="mt-0.5 text-sm font-bold text-stone-900">
									{failureLabel(item.failure_kind)}
								</div>
							</div>
							<div>
								<div class="text-[11px] font-bold tracking-wide text-stone-400 uppercase">
									Percobaan
								</div>
								<div class="mt-0.5 text-sm font-bold text-stone-900">{item.attempt_count}</div>
							</div>
						</div>

						{#if item.last_error}
							<div class="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5">
								<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
								<div class="min-w-0 text-xs leading-5 text-red-900">{item.last_error}</div>
							</div>
						{/if}
						<div class="mt-3 text-xs leading-5 text-stone-600">{guidance(item.failure_kind)}</div>

						<div class="mt-4 flex flex-wrap gap-2">
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white transition-transform duration-200 active:scale-[0.98] disabled:opacity-45"
								disabled={isOffline || isSyncing}
								onclick={() => onRetry(item.queue_id)}
							>
								<RefreshCw class="h-3.5 w-3.5" />
								Retry
							</button>
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 transition-transform duration-200 active:scale-[0.98]"
								onclick={() => exportTransactions([item], summary.code)}
							>
								<Download class="h-3.5 w-3.5" />
								Export
							</button>
							{#if canRemove}
								<button
									type="button"
									class="ml-auto inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition-transform duration-200 active:scale-[0.98]"
									onclick={() => (pendingRemoval = item)}
								>
									<Trash2 class="h-3.5 w-3.5" />
									Hapus lokal
								</button>
							{/if}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-800 transition-transform duration-200 active:scale-[0.98] disabled:opacity-45"
				disabled={transactions.length === 0}
				onclick={() => exportTransactions(transactions, 'semua')}
			>
				Export semua
			</button>
			<button
				type="button"
				class="rounded-xl bg-pink-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-pink-500/15 transition-transform duration-200 active:scale-[0.98] disabled:opacity-45"
				disabled={isOffline || isSyncing || transactions.length === 0}
				onclick={onRetryAll}
			>
				{isSyncing ? 'Mengirim' : 'Sinkronkan aman'}
			</button>
		</div>
	{/snippet}
</ModalSheet>

{#if pendingRemoval}
	<div
		class="fixed inset-0 z-[130] flex items-end justify-center bg-stone-950/40 p-4 backdrop-blur-[2px] sm:items-center"
		role="dialog"
		aria-modal="true"
		aria-labelledby="remove-pending-title"
		data-testid="pending-removal-confirmation"
	>
		<div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
			<div id="remove-pending-title" class="text-lg font-black text-stone-950">
				Hapus transaksi lokal?
			</div>
			<p class="mt-2 text-sm leading-6 text-stone-600">
				Data ini belum tercatat di server. Export dahulu bila transaksi sudah dibayar pelanggan.
			</p>
			<div class="mt-5 grid grid-cols-2 gap-3">
				<button
					type="button"
					class="rounded-xl border border-stone-200 px-4 py-3 text-sm font-bold text-stone-800 transition-transform duration-200 active:scale-[0.98]"
					onclick={() => (pendingRemoval = null)}
				>
					Batal
				</button>
				<button
					type="button"
					class="rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white transition-transform duration-200 active:scale-[0.98] disabled:opacity-45"
					disabled={removalBusy}
					onclick={confirmRemoval}
				>
					{removalBusy ? 'Menghapus' : 'Hapus lokal'}
				</button>
			</div>
		</div>
	</div>
{/if}
