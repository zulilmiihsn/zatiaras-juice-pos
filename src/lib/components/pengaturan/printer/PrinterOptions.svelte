<script lang="ts" module>
	import type { PaperSize, PrintMode } from '$lib/utils/printerConfig';

	export const PAPER_OPTIONS: Array<{ value: PaperSize; label: string; hint: string }> = [
		{ value: '58mm', label: '58 mm', hint: 'Printer mini, area cetak 48 mm' },
		{ value: '80mm', label: '80 mm', hint: 'Printer kasir besar, area cetak 72 mm' }
	];

	export const MODE_OPTIONS: Array<{ value: PrintMode; label: string; hint: string }> = [
		{ value: 'image', label: 'Gambar', hint: 'Sama persis dengan pratinjau, data besar' },
		{ value: 'text', label: 'Teks printer', hint: 'Font bawaan printer, ±8× lebih cepat' }
	];
</script>

<script lang="ts">
	import ChoiceCards from './ChoiceCards.svelte';

	/** Ukuran kertas dan mode cetak: setelan yang sama di tab Koneksi dan Tampilan. */
	let {
		paperSize = $bindable(),
		printMode = $bindable(),
		htmlOnly,
		onchange
	}: {
		paperSize: PaperSize;
		printMode: PrintMode;
		htmlOnly: boolean;
		onchange: () => void;
	} = $props();
</script>

<ChoiceCards
	legend="Ukuran kertas"
	name="paper-size"
	options={PAPER_OPTIONS}
	bind:value={paperSize}
	{onchange}
/>
<!-- Helper print-intent hanya bisa mencetak gambar: yang ditampilkan adalah mode yang benar-benar
	dipakai, sedangkan pilihan teks yang tersimpan kembali berlaku saat metode lain dipilih. -->
<ChoiceCards
	legend="Mode cetak"
	name="print-mode"
	options={htmlOnly
		? MODE_OPTIONS.map((option) =>
				option.value === 'text'
					? { ...option, disabled: true, hint: 'Tidak tersedia untuk helper print-intent' }
					: option
			)
		: MODE_OPTIONS}
	bind:value={() => (htmlOnly ? 'image' : printMode), (mode) => (printMode = mode)}
	{onchange}
	note={htmlOnly
		? 'Helper print-intent selalu mencetak gambar. Pilih Bluetooth, USB, Server Lokal, atau RawBT untuk memakai mode teks.'
		: printMode === 'text'
			? 'Huruf beraksen dicetak tanpa aksen dan emoji menjadi "?".'
			: undefined}
/>
