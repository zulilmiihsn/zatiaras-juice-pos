<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';

	import type { OwnerStockState } from '$lib/stores/ownerStockState.svelte';

	let { s }: { s: OwnerStockState } = $props();
</script>

<AppModal
	open={s.showReconModal && s.reconJob !== null}
	labelledby="recon-title"
	size="lg"
	panelClass="bg-slate-50"
	onClose={() => {
		if (!s.reconLoading) s.showReconModal = false;
	}}
>
	{#if s.reconJob}
		<div
			class="flex items-start justify-between gap-2 border-b border-slate-200 px-5 pt-4 pb-3 md:px-6"
		>
			<div>
				<p id="recon-title" class="text-sm font-bold text-slate-900 md:text-base">
					Hitung fisik stok
				</p>
				<p class="text-[11px] text-slate-500">
					{s.reconCounted}/{s.reconTotal} item • Saldo lama dianggap basi
				</p>
			</div>
			<button
				type="button"
				aria-label="Tutup hitung fisik"
				disabled={s.reconLoading}
				onclick={() => (s.showReconModal = false)}
				class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 disabled:opacity-50"
			>
				✕
			</button>
		</div>
		{#if s.reconError}
			<p class="px-5 pt-2 text-xs font-bold text-rose-600 md:px-6">{s.reconError}</p>
		{/if}
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
			{#if s.reconReviews.length > 0}
				<div class="mb-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
					<p class="text-xs font-bold text-slate-900">Antrean offline perlu tinjauan</p>
					<p class="mt-0.5 text-[11px] text-slate-500">
						Setujui replay agar bisa finalisasi, atau biarkan menunggu.
					</p>
					<div class="mt-2 flex flex-col gap-2">
						{#each s.reconReviews as review (review.idempotency_key)}
							<div class="rounded-xl border border-amber-200/70 bg-white px-3 py-2">
								<div class="flex items-center justify-between gap-2">
									<span
										class="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-slate-700"
									>
										{review.idempotency_key.slice(0, 18)}…
									</span>
									<span
										class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black {review.status ===
										'pending'
											? 'bg-amber-100 text-amber-700'
											: review.status === 'approved_current'
												? 'bg-emerald-100 text-emerald-700'
												: 'bg-slate-100 text-slate-600'}"
									>
										{review.status === 'pending'
											? 'Menunggu'
											: review.status === 'approved_current'
												? 'Disetujui'
												: review.status}
									</span>
								</div>
								<div class="mt-0.5 text-[11px] text-slate-400">
									Antre {s.formatQueuedAt(review.queued_at)}
								</div>
								{#if review.status === 'pending'}
									<button
										type="button"
										disabled={s.reconReviewActing === review.idempotency_key}
										onclick={() =>
											s.resolveReview(review.idempotency_key, review.revision, 'approve_current')}
										class="mt-1.5 cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-3.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
									>
										{s.reconReviewActing === review.idempotency_key
											? 'Memproses…'
											: 'Setujui replay'}
									</button>
								{:else if review.status === 'approved_current'}
									<button
										type="button"
										disabled={s.reconReviewActing === review.idempotency_key}
										onclick={() =>
											s.resolveReview(review.idempotency_key, review.revision, 'withdraw')}
										class="mt-1.5 cursor-pointer rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-50"
									>
										Tarik persetujuan
									</button>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<div class="rounded-2xl border border-pink-100 bg-white p-4">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-xs font-bold text-slate-900 md:text-sm">Hitung fisik stok</span>
						{#if s.reconComplete}
							<span
								class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700"
							>
								Siap difinalisasi
							</span>
						{:else}
							<span
								class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700"
							>
								Kurang {s.reconTotal - s.reconCounted} lagi
							</span>
						{/if}
					</div>
					<span class="shrink-0 text-[11px] font-bold text-slate-500">
						{s.reconCounted}/{s.reconTotal}
					</span>
				</div>
				<div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
					<div
						class="h-full rounded-full bg-gradient-to-r from-pink-500 to-rose-400 transition-all"
						style="width: {s.reconTotal === 0
							? 100
							: Math.round((s.reconCounted / s.reconTotal) * 100)}%"
					></div>
				</div>
				{#if s.reconPendingReviews > 0}
					<p class="mt-2 text-[11px] font-bold text-amber-600">
						{s.reconPendingReviews} antrean offline menunggu tinjauan di bawah — selesaikan dulu sebelum
						finalisasi.
					</p>
				{/if}
				<p class="mt-2 text-[11px] text-slate-500">
					Isi angka sesuai <span class="font-bold text-slate-700">satuan tiap baris</span>
					(mis. gram, ml, pcs). Boleh dicicil — progres tersimpan aman.
				</p>
				<div class="relative mt-2">
					<input
						type="search"
						placeholder="Cari nama bahan atau produk…"
						bind:value={s.reconSearch}
						aria-label="Cari item rekonsiliasi"
						class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-pink-300 focus:outline-none"
					/>
				</div>
				{#if s.reconFilterOptions.length > 2}
					<div class="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter kategori">
						{#each s.reconFilterOptions as option (option.value)}
							<button
								type="button"
								onclick={() => (s.reconFilter = option.value)}
								aria-pressed={s.reconFilter === option.value}
								class="cursor-pointer rounded-full border px-3 py-1 text-[11px] font-bold transition-colors {s.reconFilter ===
								option.value
									? 'border-pink-500 bg-pink-600 text-white'
									: 'border-slate-200 bg-white text-slate-500 hover:border-pink-200 hover:text-pink-600'}"
							>
								{option.label}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			{#if s.reconGroups.length === 0}
				<p class="mt-2 text-center text-[11px] text-slate-400">
					{s.reconSearch
						? 'Tidak ada item yang cocok.'
						: s.reconTotal === 0
							? 'Tidak ada stok untuk dihitung. Finalisasi untuk mengaktifkan monitoring.'
							: 'Tidak ada item untuk dihitung.'}
				</p>
			{/if}
			{#each s.reconGroups as group (`${group.type}:${group.title}`)}
				<div class="mt-3">
					<p class="mb-1.5 px-1 text-[11px] font-black tracking-wider text-slate-400 uppercase">
						{group.title} • {group.items.length}
					</p>
					<div class="flex flex-col gap-2">
						{#each group.items as item (item.entity_type + ':' + item.entity_id)}
							{@const key = `${item.entity_type}:${item.entity_id}`}
							{@const meta = s.entityMeta[key]}
							{@const satuan = meta?.satuan || (item.entity_type === 'produk' ? 'pcs' : '')}
							<div
								class="rounded-2xl border bg-white px-3 py-2.5 transition-colors {item.counted_quantity !==
								null
									? 'border-emerald-200 bg-emerald-50/40'
									: 'border-slate-200'}"
							>
								<div class="flex items-center gap-3">
									<span
										class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black {item.counted_quantity !==
										null
											? 'bg-emerald-100 text-emerald-700'
											: 'bg-slate-100 text-slate-400'}"
									>
										{item.counted_quantity !== null ? '✓' : group.type === 'produk' ? 'P' : 'B'}
									</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-bold text-slate-800">
											{meta?.nama || item.entity_id}
										</span>
										<span class="block truncate text-[11px] text-slate-400">
											{#if meta?.sistem !== null && meta?.sistem !== undefined}
												Stok sistem: {meta.sistem}{#if satuan}
													{' ' + satuan}{/if}
											{:else}
												{item.entity_id}
											{/if}
										</span>
									</span>
									{#if meta?.sistem !== null && meta?.sistem !== undefined && item.counted_quantity === null && !s.reconDraft[key]}
										<button
											type="button"
											title="Isi sama dengan stok sistem"
											onclick={() => (s.reconDraft[key] = String(meta.sistem))}
											class="min-h-9 shrink-0 cursor-pointer rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-xs font-bold text-pink-700 hover:border-pink-300 hover:bg-pink-100 active:scale-95"
										>
											≈ sistem
										</button>
									{/if}
								</div>
								<div class="mt-2 flex items-center gap-2">
									<label
										for="recon-{item.entity_type}-{item.entity_id}"
										class="shrink-0 text-[11px] font-bold text-slate-500"
									>
										Hitung{#if satuan}
											({satuan}){/if}:
									</label>
									<input
										id="recon-{item.entity_type}-{item.entity_id}"
										type="number"
										min="0"
										step={item.entity_type === 'produk' ? '1' : 'any'}
										inputmode="decimal"
										placeholder={item.counted_quantity !== null
											? String(item.counted_quantity)
											: '0'}
										bind:value={s.reconDraft[key]}
										class="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-right text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-pink-300 focus:bg-white focus:outline-none"
									/>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
			<p class="mt-2 text-[11px] text-slate-400">
				<span class="font-bold text-slate-600">Simpan progres</span> mengunggah hitungan ke server —
				boleh dicicil, aman ditutup dan dilanjut nanti.
				<span class="font-bold text-slate-600">Finalisasi</span> mengunci angka dan mengaktifkan monitoring.
			</p>
		</div>
		<div
			class="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 md:px-6"
		>
			<div class="flex flex-col gap-2 sm:flex-row">
				<button
					type="button"
					disabled={s.reconLoading}
					onclick={s.saveReconCounts}
					class="btn-brand-secondary flex-1"
				>
					{s.reconLoading ? 'Menyimpan…' : 'Simpan progres'}
				</button>
				<button
					type="button"
					disabled={s.reconLoading || !s.reconComplete}
					title={s.reconComplete
						? 'Terapkan saldo dan aktifkan monitoring'
						: 'Lengkapi semua hitungan dulu'}
					onclick={s.finalizeReconciliation}
					class="btn-brand-primary flex-1"
				>
					{s.reconLoading ? 'Memproses…' : 'Finalisasi & aktifkan'}
				</button>
			</div>
			<button
				type="button"
				disabled={s.reconLoading}
				onclick={s.cancelReconciliation}
				class="btn-brand-ghost"
			>
				Batalkan
			</button>
		</div>
	{/if}
</AppModal>
