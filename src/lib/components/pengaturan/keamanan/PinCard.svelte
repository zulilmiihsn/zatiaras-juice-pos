<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Check from '@lucide/svelte/icons/check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	import type { SecuritySettingsState } from '$lib/stores/securitySettingsState.svelte';

	let { s }: { s: SecuritySettingsState } = $props();
</script>

<!-- Card A: Ganti PIN Keamanan -->
<div class="soft-float-card p-5 md:p-6">
	<div class="mb-4 flex items-center justify-between border-b border-pink-100/80 pb-3.5">
		<div class="flex items-center gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
			>
				<KeyRound class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
			</div>
			<div>
				<h2 class="text-sm font-black text-slate-900 md:text-base">PIN Keamanan</h2>
				<p class="text-xs text-slate-500 md:text-sm">4 digit angka untuk proteksi</p>
			</div>
		</div>

		{#if s.pinConfigured}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 md:text-xs"
			>
				<Check class="h-3 w-3 stroke-[2.5]" /> Aktif
			</span>
		{:else}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 md:text-xs"
			>
				Belum Diatur
			</span>
		{/if}
	</div>

	<form onsubmit={s.savePinSettings} autocomplete="off" class="space-y-3.5">
		{#if s.pinConfigured}
			<div>
				<label for="old-pin" class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm">
					PIN Lama
				</label>
				<div class="relative">
					<input
						id="old-pin"
						type={s.showOldPin ? 'text' : 'password'}
						inputmode="numeric"
						maxlength="4"
						class="form-input-pink py-2.5 pr-11 pl-4 tracking-widest"
						placeholder="PIN lama (4 angka)"
						bind:value={s.oldPin}
						required
					/>
					<button
						type="button"
						onclick={() => (s.showOldPin = !s.showOldPin)}
						class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						aria-label={s.showOldPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
					>
						{#if s.showOldPin}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
			</div>
		{:else}
			<div
				class="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs font-medium text-amber-800"
			>
				Tetapkan PIN baru 4 digit sebelum mengaktifkan kunci halaman.
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
			<div>
				<label for="new-pin" class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm">
					PIN Baru
				</label>
				<div class="relative">
					<input
						id="new-pin"
						type={s.showNewPin ? 'text' : 'password'}
						inputmode="numeric"
						maxlength="4"
						class="form-input-pink py-2.5 pr-11 pl-4 tracking-widest"
						placeholder="PIN baru (4 angka)"
						bind:value={s.newPin}
						required
					/>
					<button
						type="button"
						onclick={() => (s.showNewPin = !s.showNewPin)}
						class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						aria-label={s.showNewPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
					>
						{#if s.showNewPin}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
			</div>

			<div>
				<label for="confirm-pin" class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm">
					Konfirmasi PIN
				</label>
				<div class="relative">
					<input
						id="confirm-pin"
						type={s.showConfirmPin ? 'text' : 'password'}
						inputmode="numeric"
						maxlength="4"
						class="form-input-pink py-2.5 pr-11 pl-4 tracking-widest"
						placeholder="Ulangi PIN (4 angka)"
						bind:value={s.confirmPin}
						required
					/>
					<button
						type="button"
						onclick={() => (s.showConfirmPin = !s.showConfirmPin)}
						class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						aria-label={s.showConfirmPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
					>
						{#if s.showConfirmPin}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
			</div>
		</div>

		{#if s.pinError}
			<div
				class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
			>
				<AlertCircle class="h-4 w-4 shrink-0" />
				<span>{s.pinError}</span>
			</div>
		{/if}

		<button
			type="submit"
			disabled={s.isSavingPin}
			class="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
		>
			{s.isSavingPin ? 'Menyimpan...' : 'Simpan PIN Keamanan'}
		</button>
	</form>
</div>
