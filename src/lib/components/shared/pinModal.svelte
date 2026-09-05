<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		show = $bindable(false),
		title = 'Masukkan PIN',
		subtitle = 'Masukkan PIN untuk melanjutkan',
		onVerify,
		onSuccess,
		onError,
		onClose
	}: {
		show?: boolean;
		title?: string;
		subtitle?: string;
		onVerify: (pin: string) => Promise<{ ok: boolean; message?: string }>;
		onSuccess?: () => void;
		onError?: (detail: { message: string }) => void;
		onClose?: () => void;
	} = $props();

	let pinInput = $state('');
	let pinError = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | undefined;
	let isShaking = $state(false);
	let isVerifying = $state(false);

	function handlePinInput(num: number) {
		if (!isVerifying && pinInput.length < 6) {
			pinInput += num.toString();
		}
	}

	function handleDelete() {
		if (!isVerifying) pinInput = pinInput.slice(0, -1);
	}

	async function handleVerify() {
		if (isVerifying || pinInput.length < 4) return;
		const entered = pinInput;
		isVerifying = true;
		let result: { ok: boolean; message?: string };
		try {
			result = await onVerify(entered);
		} catch {
			result = { ok: false, message: 'Verifikasi PIN gagal' };
		}
		isVerifying = false;
		if (result.ok) {
			if (onSuccess) onSuccess();
			show = false;
			pinInput = '';
			pinError = '';
		} else {
			pinError = result.message || 'PIN salah';
			isShaking = true;
			pinInput = '';
			if (errorTimeout) clearTimeout(errorTimeout);
			errorTimeout = setTimeout(() => {
				pinError = '';
				isShaking = false;
			}, 2000);
			if (onError) onError({ message: pinError });
		}
	}

	// [CATATAN]: Cleanup on component destroy
	onDestroy(() => {
		if (errorTimeout) clearTimeout(errorTimeout);
	});
</script>

{#if show}
	<div
		class="z-modal fixed inset-0 flex items-center justify-center"
		style="top: 58px; bottom: 58px; background: linear-gradient(to bottom right, #f472b6, #ec4899, #a855f7);"
		transition:fade={{ duration: 200 }}
		role="dialog"
		aria-modal="true"
	>
		<div class="flex h-full w-full flex-col items-center justify-center p-4">
			<div
				class="w-full max-w-sm rounded-3xl border border-white/30 bg-white/20 p-6 shadow-2xl backdrop-blur-xl md:p-8"
				transition:scale={{ start: 0.94, duration: 220, easing: cubicOut }}
			>
				<div class="mb-4 text-center">
					<div
						class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 to-purple-600 shadow-lg"
					>
						<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
							/>
						</svg>
					</div>
					<h2 class="mb-2 text-xl font-bold text-white">{title}</h2>
					<p class="text-sm text-pink-100">{subtitle}</p>
				</div>

				<!-- PIN Display -->
				<div class="mb-2 flex justify-center gap-2 {isShaking ? 'animate-shake' : ''}">
					{#each Array(6) as _, i}
						<div
							class="h-4 w-4 rounded-full {pinInput.length > i
								? 'bg-white'
								: 'border border-white/50 bg-white/30'}"
						></div>
					{/each}
				</div>
				<!-- Reserve space for error to avoid layout shift -->
				<div
					class="mb-2 h-5 text-center text-sm font-semibold text-white/90 {pinError
						? 'visible opacity-100'
						: 'invisible opacity-0'}"
					aria-live="polite"
				>
					{pinError}
				</div>

				<!-- Numpad -->
				<div class="mb-3 grid grid-cols-3 justify-items-center gap-3">
					{#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as num}
						<button
							type="button"
							class="h-16 w-16 rounded-2xl border border-white/30 bg-white/20 text-2xl font-bold text-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:bg-white/30 active:bg-white/40 active:shadow-[0_0_20px_rgba(255,255,255,0.5)]"
							onclick={() => handlePinInput(num)}
						>
							{num}
						</button>
					{/each}
					<button
						type="button"
						class="h-16 w-16 rounded-2xl border border-white/30 bg-white/20 text-sm font-bold text-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:bg-white/30 active:scale-[0.98]"
						onclick={handleDelete}
						disabled={isVerifying || pinInput.length === 0}
					>
						Hapus
					</button>
					<button
						type="button"
						class="h-16 w-16 rounded-2xl border border-white/30 bg-white/20 text-2xl font-bold text-white shadow-lg backdrop-blur-sm transition-all duration-200 hover:bg-white/30 active:bg-white/40 active:shadow-[0_0_20px_rgba(255,255,255,0.5)]"
						onclick={() => handlePinInput(0)}
					>
						0
					</button>
					<button
						type="button"
						class="h-16 w-16 rounded-2xl border border-white/30 bg-white text-sm font-bold text-pink-600 shadow-lg transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
						onclick={handleVerify}
						disabled={isVerifying || pinInput.length < 4}
					>
						{isVerifying ? 'Proses' : 'Buka'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Animasi slideUp telah dihapus */
	@keyframes shake {
		0% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-6px);
		}
		40% {
			transform: translateX(6px);
		}
		60% {
			transform: translateX(-4px);
		}
		80% {
			transform: translateX(4px);
		}
		100% {
			transform: translateX(0);
		}
	}
	.animate-shake {
		animation: shake 320ms ease-in-out;
	}
</style>
