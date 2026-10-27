<script lang="ts" module>
	export interface StoreReceiptFields {
		namaToko: string;
		alamat: string;
		telepon: string;
		instagram: string;
		ucapan: string;
	}

	export type SaveState =
		{ kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };
</script>

<script lang="ts">
	import Store from '@lucide/svelte/icons/store';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import InstagramIcon from '@lucide/svelte/icons/camera';
	import MessageSquareHeart from '@lucide/svelte/icons/message-square-heart';
	import Check from '@lucide/svelte/icons/check';
	import type { Component } from 'svelte';

	let {
		fields = $bindable(),
		saveState,
		nameError,
		onfieldblur,
		onretry
	}: {
		fields: StoreReceiptFields;
		saveState: SaveState;
		nameError: string;
		onfieldblur: () => void;
		onretry: () => void;
	} = $props();

	const FIELDS: Array<{
		key: keyof StoreReceiptFields;
		id: string;
		label: string;
		hint: string;
		icon: Component;
		maxlength: number;
		optional?: boolean;
		multiline?: boolean;
		wide?: boolean;
	}> = [
		{
			key: 'namaToko',
			id: 'nama-toko',
			label: 'Nama toko',
			hint: 'Dicetak besar di bagian paling atas struk.',
			icon: Store,
			maxlength: 50,
			wide: true
		},
		{
			key: 'alamat',
			id: 'alamat',
			label: 'Alamat',
			hint: 'Di bawah nama toko.',
			icon: MapPin,
			maxlength: 100,
			optional: true,
			wide: true
		},
		{
			key: 'telepon',
			id: 'telepon',
			label: 'Nomor telepon',
			hint: 'Di bawah alamat.',
			icon: Phone,
			maxlength: 20,
			optional: true
		},
		{
			key: 'instagram',
			id: 'instagram',
			label: 'Instagram',
			hint: 'Contoh: @zatiarasjuice',
			icon: InstagramIcon,
			maxlength: 30,
			optional: true
		},
		{
			key: 'ucapan',
			id: 'ucapan',
			label: 'Ucapan penutup',
			hint: 'Di bagian paling bawah struk.',
			icon: MessageSquareHeart,
			maxlength: 120,
			optional: true,
			multiline: true,
			wide: true
		}
	];
</script>

<section class="soft-float-card min-w-0 p-5 md:p-6" aria-labelledby="detail-struk-heading">
	<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 id="detail-struk-heading" class="text-base font-bold text-slate-900">
				Identitas toko di struk
			</h2>
			<p class="mt-1 text-sm leading-relaxed text-slate-600">
				Tersimpan otomatis saat pindah kolom dan berlaku untuk semua kasir di cabang ini.
			</p>
		</div>
		<p class="shrink-0 text-xs font-semibold" role="status" aria-live="polite">
			{#if saveState.kind === 'saving'}
				<span class="text-slate-500">Menyimpan…</span>
			{:else if saveState.kind === 'saved'}
				<span class="inline-flex items-center gap-1 text-emerald-700">
					<Check class="h-3.5 w-3.5" aria-hidden="true" />Tersimpan
				</span>
			{/if}
		</p>
	</div>

	{#if saveState.kind === 'error'}
		<div
			class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3"
			role="alert"
		>
			<p class="text-sm text-rose-700">{saveState.message}</p>
			<button
				type="button"
				onclick={onretry}
				class="btn-brand-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98]"
				>Simpan ulang</button
			>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
		{#each FIELDS as field (field.key)}
			{@const invalid = field.key === 'namaToko' && !!nameError}
			<div class="min-w-0 {field.wide ? 'md:col-span-2' : ''}">
				<div class="mb-1.5 flex items-center justify-between gap-2">
					<label
						for={field.id}
						class="flex items-center gap-2 text-sm font-semibold text-slate-800"
					>
						<field.icon class="h-4 w-4 text-pink-500" aria-hidden="true" />
						{field.label}
						{#if field.optional}
							<span class="text-xs font-normal text-slate-500">(opsional)</span>
						{/if}
					</label>
					<span class="text-xs text-slate-500 tabular-nums" aria-hidden="true"
						>{fields[field.key].length}/{field.maxlength}</span
					>
				</div>
				{#if field.multiline}
					<textarea
						id={field.id}
						rows="3"
						maxlength={field.maxlength}
						bind:value={fields[field.key]}
						onblur={onfieldblur}
						aria-describedby="{field.id}-hint"
						class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 placeholder:text-slate-400"
					></textarea>
				{:else}
					<input
						type="text"
						id={field.id}
						maxlength={field.maxlength}
						required={!field.optional}
						bind:value={fields[field.key]}
						onblur={onfieldblur}
						aria-invalid={invalid}
						aria-describedby="{field.id}-hint"
						class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 placeholder:text-slate-400"
					/>
				{/if}
				<p
					id="{field.id}-hint"
					class="mt-1.5 text-xs leading-relaxed {invalid ? 'text-rose-700' : 'text-slate-500'}"
				>
					{invalid ? nameError : field.hint}
				</p>
			</div>
		{/each}
	</div>
</section>
