<script lang="ts">
	import type { RenderedReceipt } from '$lib/utils/receiptRaster';

	let {
		preview,
		loading,
		error,
		paperLabel,
		onretry
	}: {
		preview: RenderedReceipt | null;
		loading: boolean;
		error: string;
		paperLabel: string;
		onretry: () => void;
	} = $props();
</script>

<div
	class="min-w-0 overflow-hidden rounded-2xl border border-pink-100 bg-pink-50/40 p-4 sm:p-6"
	aria-busy={loading}
>
	<div class="mb-4 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
		<span>Contoh hasil cetak</span><span>{paperLabel}</span>
	</div>
	{#if loading}
		<div
			class="mx-auto h-96 w-full max-w-xs animate-pulse rounded-lg bg-white"
			role="status"
			aria-label="Menyiapkan pratinjau struk"
		></div>
	{:else if error}
		<div class="rounded-lg bg-white p-5" role="alert">
			<p class="text-sm text-slate-700">{error}</p>
			<button
				type="button"
				onclick={onretry}
				class="btn-brand-secondary mt-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98]"
				>Coba lagi</button
			>
		</div>
	{:else if preview}
		<div class="mx-auto w-fit max-w-full bg-white shadow-md">
			<img
				data-testid="receipt-preview"
				src={preview.imageUrl}
				width={preview.bitmap.width}
				height={preview.bitmap.height}
				alt="Contoh struk transaksi"
				aria-describedby="receipt-preview-text"
				class="block h-auto max-w-full"
			/>
		</div>
		<!-- Pembaca layar tetap mendapat isi struk walau tampilannya berupa gambar. -->
		<ul id="receipt-preview-text" class="sr-only" data-testid="receipt-text">
			{#each preview.lines as line, index (index)}
				<li>{line}</li>
			{/each}
		</ul>
	{:else}
		<p class="p-5 text-sm text-slate-600">Pratinjau belum tersedia.</p>
	{/if}
</div>
