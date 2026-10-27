<script lang="ts">
	import Printer from '@lucide/svelte/icons/printer';
	import type { PaperSize, PrintMode } from '$lib/utils/printerConfig';
	import type { RenderedReceipt } from '$lib/utils/receiptRaster';
	import PrinterOptions from './PrinterOptions.svelte';
	import ReceiptPreview from './ReceiptPreview.svelte';

	let {
		paperSize = $bindable(),
		printMode = $bindable(),
		htmlOnly,
		preview,
		loading,
		error,
		printing,
		onchange,
		onretry,
		ontestprint
	}: {
		paperSize: PaperSize;
		printMode: PrintMode;
		htmlOnly: boolean;
		preview: RenderedReceipt | null;
		loading: boolean;
		error: string;
		printing: boolean;
		onchange: () => void;
		onretry: () => void;
		ontestprint: () => void;
	} = $props();
</script>

<section
	aria-label="Tampilan struk"
	class="grid min-w-0 grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_320px]"
>
	<ReceiptPreview
		{preview}
		{loading}
		{error}
		{onretry}
		paperLabel={paperSize === '80mm' ? '80 mm' : '58 mm'}
	/>
	<aside class="soft-float-card min-w-0 space-y-6 p-5">
		<p class="text-sm leading-relaxed text-slate-600">
			{printMode === 'text' && !htmlOnly
				? 'Huruf di pratinjau adalah perkiraan font printer. Ukuran, posisi, dan baris sama dengan hasil cetak.'
				: 'Pratinjau ini sama dengan gambar yang dikirim ke printer.'}
		</p>
		<PrinterOptions bind:paperSize bind:printMode {htmlOnly} {onchange} />
		<div class="space-y-2">
			<button
				type="button"
				onclick={ontestprint}
				disabled={printing || loading || !!error}
				aria-busy={printing}
				class="btn-brand-primary w-full gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98]"
			>
				<Printer class="h-4 w-4" aria-hidden="true" />
				{printing ? 'Mengirim struk…' : 'Cetak contoh ini'}
			</button>
			<p class="text-xs leading-relaxed text-slate-500">
				Dicetak lewat printer yang dipilih di tab Koneksi Printer POS.
			</p>
		</div>
	</aside>
</section>
