<script lang="ts">
	export let open = false;
	export let isEdit = false;
	export let name = '';
	export let harga = '';

	export let onSubmit: (e: SubmitEvent) => void;
	export let onClose: () => void;
</script>

{#if open}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		tabindex="-1"
	>
		<div
			class="animate-slideUpModal relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
			role="document"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-4 text-center text-lg font-bold text-gray-800">
				{isEdit ? 'Edit Tambahan' : 'Tambah Tambahan'}
			</h2>
			<form class="flex flex-col gap-4" onsubmit={onSubmit} autocomplete="off">
				<div class="flex flex-col gap-2">
					<label for="ekstra-name" class="font-semibold text-gray-700">Nama Tambahan</label>
					<input
						id="ekstra-name"
						type="text"
						class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-green-500"
						bind:value={name}
						required
						placeholder="Contoh: Extra Cheese"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<label for="ekstra-harga" class="font-semibold text-gray-700">Harga Tambahan</label>
					<div class="relative">
						<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
							>Rp</span
						>
						<input
							id="ekstra-harga"
							type="text"
							class="w-full rounded-xl border border-gray-300 py-3 pr-4 pl-12 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-green-500"
							bind:value={harga}
							required
							placeholder="0"
						/>
					</div>
				</div>
				<div class="mt-4 flex gap-2">
					<button
						type="submit"
						class="flex-1 rounded-xl bg-green-500 py-3 font-semibold text-white shadow-lg shadow-green-200 transition-all duration-200 hover:bg-green-600 active:bg-green-700"
						>Simpan</button
					>
					<button
						type="button"
						class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
						onclick={onClose}>Batal</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
