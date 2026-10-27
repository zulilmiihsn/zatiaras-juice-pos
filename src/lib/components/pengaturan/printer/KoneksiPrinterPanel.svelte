<script lang="ts">
	import Bluetooth from '@lucide/svelte/icons/bluetooth';
	import Usb from '@lucide/svelte/icons/cable';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Printer from '@lucide/svelte/icons/printer';
	import Check from '@lucide/svelte/icons/check';
	import type { Component } from 'svelte';
	import type {
		AndroidPrinterApp,
		PaperSize,
		PrinterMethod,
		PrintMode
	} from '$lib/utils/printerConfig';
	import ChoiceCards from './ChoiceCards.svelte';
	import PrinterOptions from './PrinterOptions.svelte';

	let {
		method = $bindable(),
		androidApp = $bindable(),
		paperSize = $bindable(),
		printMode = $bindable(),
		deviceName,
		connecting,
		bluetoothSupported,
		usbSupported,
		savedNotice,
		onchange,
		onpairbluetooth,
		onpairusb
	}: {
		method: PrinterMethod;
		androidApp: AndroidPrinterApp;
		paperSize: PaperSize;
		printMode: PrintMode;
		deviceName: string;
		connecting: boolean;
		bluetoothSupported: boolean;
		usbSupported: boolean;
		savedNotice: boolean;
		onchange: () => void;
		onpairbluetooth: () => void;
		onpairusb: () => void;
	} = $props();

	const METHODS: Array<{
		value: PrinterMethod;
		label: string;
		description: string;
		icon: Component;
	}> = [
		{
			value: 'bluetooth',
			label: 'Bluetooth langsung',
			description: 'Printer Bluetooth (BLE) dari Chrome atau Edge, tanpa aplikasi tambahan.',
			icon: Bluetooth
		},
		{
			value: 'usb',
			label: 'Kabel USB',
			description: 'Printer kasir dengan kabel USB di PC atau tablet (Epson, Xprinter, Panda).',
			icon: Usb
		},
		{
			value: 'intent',
			label: 'Aplikasi Android',
			description: 'Untuk printer Bluetooth lama di HP Android, lewat aplikasi RawBT atau helper.',
			icon: Smartphone
		},
		{
			value: 'server',
			label: 'Server Lokal (PC)',
			description:
				'Untuk PC kasir Windows. Struk dikirim ke RawBT Print Server yang berjalan di komputer ini.',
			icon: Monitor
		}
	];

	const ANDROID_APPS: Array<{ value: AndroidPrinterApp; label: string; hint: string }> = [
		{ value: 'rawbt', label: 'RawBT', hint: 'Mendukung mode teks printer' },
		{ value: 'print-intent', label: 'Helper print-intent', hint: 'Selalu mencetak gambar' }
	];
</script>

<div class="space-y-5">
	<section class="soft-float-card min-w-0 p-5 md:p-6" aria-labelledby="metode-heading">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<h2 id="metode-heading" class="flex items-center gap-2 text-base font-bold text-slate-900">
				<Printer class="h-5 w-5 text-pink-500" aria-hidden="true" />
				Cara struk sampai ke printer
			</h2>
			<p class="text-xs font-semibold" role="status" aria-live="polite">
				{#if savedNotice}
					<span class="inline-flex items-center gap-1 text-emerald-700">
						<Check class="h-3.5 w-3.5" aria-hidden="true" />Tersimpan di perangkat ini
					</span>
				{/if}
			</p>
		</div>

		<fieldset class="space-y-3">
			<legend class="sr-only">Metode printer</legend>
			{#each METHODS as option (option.value)}
				<label
					class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-colors has-focus-visible:ring-4 has-focus-visible:ring-pink-500/20 {method ===
					option.value
						? 'border-pink-500 bg-pink-50/40'
						: 'border-slate-200 bg-white hover:border-pink-200'}"
				>
					<input
						type="radio"
						name="printer-method"
						value={option.value}
						bind:group={method}
						{onchange}
						class="mt-1 h-4 w-4 shrink-0 accent-pink-500"
					/>
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-2 text-sm font-bold text-slate-800">
							<option.icon class="h-4 w-4 text-pink-500" aria-hidden="true" />
							{option.label}
						</span>
						<span class="mt-1 block text-xs leading-relaxed text-slate-500"
							>{option.description}</span
						>
					</span>
				</label>
			{/each}
		</fieldset>

		{#if method === 'bluetooth' || method === 'usb'}
			{@const supported = method === 'bluetooth' ? bluetoothSupported : usbSupported}
			<div class="mt-4 rounded-xl border border-pink-100 bg-pink-50/40 p-4">
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onclick={method === 'bluetooth' ? onpairbluetooth : onpairusb}
						disabled={connecting || !supported}
						class="btn-brand-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98]"
					>
						{#if connecting}
							Mencari printer…
						{:else}
							{method === 'bluetooth' ? 'Hubungkan printer Bluetooth' : 'Pilih printer USB'}
						{/if}
					</button>
					{#if deviceName}
						<span class="text-sm font-semibold text-pink-700">Terhubung: {deviceName}</span>
					{/if}
				</div>
				{#if !supported}
					<p class="mt-2 text-xs font-medium text-amber-700">
						Browser ini tidak mendukung {method === 'bluetooth' ? 'Web Bluetooth' : 'WebUSB'}. Buka
						lewat Chrome atau Edge.
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<section
		class="soft-float-card min-w-0 space-y-6 p-5 md:p-6"
		aria-label="Aplikasi, kertas, dan mode cetak"
	>
		{#if method === 'intent'}
			<ChoiceCards
				legend="Aplikasi cetak Android"
				name="android-print-app"
				options={ANDROID_APPS}
				bind:value={androidApp}
				{onchange}
			/>
		{/if}
		<PrinterOptions
			bind:paperSize
			bind:printMode
			htmlOnly={method === 'intent' && androidApp !== 'rawbt'}
			{onchange}
		/>
	</section>
</div>
