<script lang="ts" generics="T extends string">
	/** Satu gaya pilihan kartu untuk semua setelan printer: ukuran, mode, dan aplikasi Android. */
	interface Option {
		value: T;
		label: string;
		hint?: string;
		/** Pilihan terlihat tetapi tidak bisa dipilih; `hint` menjelaskan alasannya. */
		disabled?: boolean;
	}

	let {
		legend,
		name,
		options,
		value = $bindable(),
		onchange,
		note
	}: {
		legend: string;
		name: string;
		options: Option[];
		value: T;
		onchange?: (value: T) => void;
		note?: string;
	} = $props();
</script>

<!-- Lebar wadah, bukan layar, yang menentukan kolom: kartu tetap lega di panel samping. -->
<fieldset class="@container min-w-0">
	<legend class="mb-3 text-sm font-bold text-slate-800">{legend}</legend>
	<div class="grid gap-3 @md:grid-cols-2">
		{#each options as option (option.value)}
			<label
				class="flex min-h-14 items-center justify-between gap-3 rounded-xl border-[1.5px] p-3.5 transition-colors has-focus-visible:ring-4 has-focus-visible:ring-pink-500/20 {option.disabled
					? 'cursor-not-allowed border-dashed border-slate-200 bg-slate-50 text-slate-400'
					: value === option.value
						? 'cursor-pointer border-pink-500 bg-pink-50/40 text-pink-700'
						: 'cursor-pointer border-slate-200 text-slate-700 hover:border-pink-200'}"
			>
				<span class="min-w-0">
					<span class="block text-sm font-bold">{option.label}</span>
					{#if option.hint}
						<span class="mt-0.5 block text-xs font-normal text-slate-500">{option.hint}</span>
					{/if}
				</span>
				<input
					type="radio"
					{name}
					value={option.value}
					bind:group={value}
					disabled={option.disabled}
					onchange={() => onchange?.(option.value)}
					class="h-4 w-4 shrink-0 accent-pink-500 disabled:cursor-not-allowed"
				/>
			</label>
		{/each}
	</div>
	{#if note}
		<p class="mt-3 text-xs leading-relaxed text-slate-500">{note}</p>
	{/if}
</fieldset>
