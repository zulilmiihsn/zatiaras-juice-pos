<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { AiChatMessage, AutoApplyResult, TransactionAnalysis } from '$lib/types/ai';
	import { AiAnalysisService } from '$lib/services/aiAnalysisService';
	import { AutoApplyService } from '$lib/services/autoApplyService';
	import { refreshBus } from '$lib/utils/refreshBus';
	import SendIcon from '$lib/components/shared/sendIcon.svelte';

	let {
		isOpen = $bindable(false),
		onClose,
		onRecommendationsApplied
	}: {
		isOpen?: boolean;
		onClose?: () => void;
		onRecommendationsApplied?: (detail: { result: AutoApplyResult }) => void;
	} = $props();

	let messages: AiChatMessage[] = $state([]);
	let currentMessage = $state('');
	let isLoading = $state(false);
	let currentAnalysis: TransactionAnalysis | null = $state(null);
	let showRecommendations = $state(false);
	let appliedSinceOpen = $state(false);

	const aiAnalysisService = AiAnalysisService.getInstance();
	const autoApplyService = AutoApplyService.getInstance();

	onMount(() => {
		if (isOpen) {
			addWelcomeMessage();
		}
	});

	// [CATATAN]: Reactive statement untuk mengontrol body scroll
	$effect(() => {
		if (isOpen && typeof document !== 'undefined') {
			document.body.classList.add('modal-open');
		} else if (typeof document !== 'undefined') {
			document.body.classList.remove('modal-open');
		}
	});

	function addWelcomeMessage() {
		const welcomeMessage: AiChatMessage = {
			id: `msg_${Date.now()}`,
			content:
				"Halo! Saya Asisten AI untuk membantu Anda mengelola transaksi. Ceritakan transaksi yang ingin Anda catat, misalnya: 'Tadi masukkan uang 2000, ambil 5000 buat beli jajan'",
			role: 'assistant',
			timestamp: new Date()
		};
		messages = [welcomeMessage];
	}

	async function sendMessage() {
		if (!currentMessage.trim() || isLoading) return;

		const userMessage: AiChatMessage = {
			id: `msg_${Date.now()}`,
			content: currentMessage.trim(),
			role: 'user',
			timestamp: new Date()
		};

		messages = [...messages, userMessage];
		const messageText = currentMessage.trim();
		currentMessage = '';
		isLoading = true;

		try {
			// [CATATAN]: Analisis transaksi
			const analysis = await aiAnalysisService.analyzeTransaction(messageText);
			currentAnalysis = analysis;

			// [CATATAN]: Generate response
			const responseText = aiAnalysisService.generateResponseText(analysis);

			const aiMessage: AiChatMessage = {
				id: `msg_${Date.now()}`,
				content: responseText,
				role: 'assistant',
				timestamp: new Date()
			};

			messages = [...messages, aiMessage];

			// [CATATAN]: Tampilkan rekomendasi jika ada
			if (analysis.recommendations.length > 0) {
				showRecommendations = true;
			}
		} catch (error) {
			const errorMessage: AiChatMessage = {
				id: `msg_${Date.now()}`,
				content: 'Maaf, terjadi kesalahan saat menganalisis pesan Anda. Silakan coba lagi.',
				role: 'assistant',
				timestamp: new Date()
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
		}
	}

	async function applyRecommendations() {
		if (!currentAnalysis || !currentAnalysis.recommendations.length) return;

		isLoading = true;
		// [CATATAN]: Tahan rekomendasi terlihat sampai selesai; jangan sembunyikan dulu agar UX jelas proses sedang berlangsung

		try {
			const result = await autoApplyService.applyRecommendations(currentAnalysis.recommendations);

			const resultMessage: AiChatMessage = {
				id: `msg_${Date.now()}`,
				content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`,
				role: 'assistant',
				timestamp: new Date()
			};

			messages = [...messages, resultMessage];
			// [CATATAN]: Jika sukses, barulah kosongkan analisis dan rekomendasi
			if (result.success) {
				currentAnalysis = null;
				showRecommendations = false;
				appliedSinceOpen = true;
			}

			// [CATATAN]: Dispatch event untuk refresh data di parent
			if (onRecommendationsApplied) onRecommendationsApplied({ result });

			// [CATATAN]: Broadcast global event agar halaman lain bisa dengar (laporan/riwayat)
			if (result.success && typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent('ai-recommendations-applied', { detail: result }));
				// [CATATAN]: Panggil API refresher global bila tersedia, agar update benar-benar segera
				refreshBus.emit('laporan');
				refreshBus.emit('riwayat');
			}
		} catch (error) {
			const errorMessage: AiChatMessage = {
				id: `msg_${Date.now()}`,
				content: 'Maaf, terjadi kesalahan saat menerapkan rekomendasi. Silakan coba lagi.',
				role: 'assistant',
				timestamp: new Date()
			};
			messages = [...messages, errorMessage];
		} finally {
			isLoading = false;
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	function closeModal() {
		// [CATATAN]: Reset chat state saat modal ditutup
		if (appliedSinceOpen && typeof window !== 'undefined') {
			// [CATATAN]: Pastikan broadcast sekali lagi saat ditutup jika sebelumnya berhasil menerapkan
			window.dispatchEvent(new CustomEvent('ai-recommendations-applied'));
			// [CATATAN]: Trigger refresh di background saat modal ditutup
			refreshBus.emit('laporan');
			refreshBus.emit('riwayat');
		}
		messages = [];
		currentAnalysis = null;
		showRecommendations = false;
		currentMessage = '';
		isLoading = false;
		appliedSinceOpen = false;
		onClose?.();
	}
</script>

{#if isOpen}
	<div
		class="modal-overlay fixed inset-0 z-[99999] flex items-center justify-center bg-black/30 px-2 py-2 backdrop-blur-xs sm:px-4 sm:py-4"
		transition:fade={{ duration: 180 }}
		onclick={closeModal}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="mx-auto flex h-[600px] w-full max-w-[500px] flex-col rounded-3xl bg-white shadow-2xl sm:mx-auto md:max-w-[720px]"
			transition:scale={{ start: 0.95, duration: 220, easing: cubicOut }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && closeModal()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between rounded-t-xl border-b border-gray-200 bg-gradient-to-r from-pink-50 to-rose-50 p-4"
			>
				<div class="flex items-center space-x-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-rose-600 shadow-lg"
					>
						<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
							/>
						</svg>
					</div>
					<h3 class="text-lg font-semibold text-gray-900">Asisten AI</h3>
				</div>
				<div class="flex items-center space-x-2">
					<button
						onclick={closeModal}
						class="rounded-lg p-2 text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Tutup modal"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							></path>
						</svg>
					</button>
				</div>
			</div>

			<!-- Messages -->
			<div class="flex-1 space-y-4 overflow-y-auto p-4">
				{#each messages as message (message.id)}
					<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
						<div
							class="max-w-xs rounded-lg px-4 py-2 lg:max-w-md {message.role === 'user'
								? 'bg-pink-500 text-white'
								: 'bg-gray-100 text-gray-900'}"
						>
							<p class="text-sm whitespace-pre-wrap">{message.content}</p>
							<p class="mt-1 text-xs opacity-70">
								{message.timestamp.toLocaleTimeString('id-ID')}
							</p>
						</div>
					</div>
				{/each}

				{#if isLoading}
					<div class="flex justify-start">
						<div class="max-w-xs rounded-lg bg-gray-100 px-4 py-2 text-gray-900 lg:max-w-md">
							<div class="flex items-center space-x-2">
								<div class="h-4 w-4 animate-spin rounded-full border-b-2 border-pink-500"></div>
								<span class="text-sm">Menganalisis...</span>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Recommendations -->
			{#if showRecommendations && currentAnalysis?.recommendations && currentAnalysis.recommendations.length > 0}
				<div class="border-t border-gray-200 bg-gradient-to-r from-pink-50 to-rose-50 p-4">
					<h4 class="mb-3 flex items-center text-sm font-medium text-gray-900">
						<svg
							class="mr-2 h-4 w-4 text-pink-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							></path>
						</svg>
						Rekomendasi:
					</h4>
					<div class="space-y-3">
						{#each currentAnalysis.recommendations as rec (rec.id)}
							<div
								class="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
							>
								<div class="flex-1">
									<p class="text-sm font-medium text-gray-900">{rec.title}</p>
									<p class="mt-1 text-xs text-gray-600">{rec.deskripsi}</p>
								</div>
								<div class="flex items-center space-x-2">
									<span
										class="rounded-full px-3 py-1 text-xs font-medium {rec.priority === 'high'
											? 'bg-red-100 text-red-800'
											: rec.priority === 'medium'
												? 'bg-yellow-100 text-yellow-800'
												: 'bg-pink-100 text-pink-800'}"
									>
										{rec.priority}
									</span>
								</div>
							</div>
						{/each}
					</div>
					{#if currentAnalysis?.recommendations && currentAnalysis.recommendations.length > 0}
						<div class="mt-4 flex space-x-3">
							<button
								onclick={applyRecommendations}
								disabled={isLoading}
								class="flex-1 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:from-pink-600 hover:to-rose-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
							>
								{isLoading ? 'Menerapkan...' : 'Terapkan Rekomendasi'}
							</button>
							<button
								onclick={() => (showRecommendations = false)}
								class="rounded-xl px-4 py-3 text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-800"
							>
								Batal
							</button>
						</div>
					{:else}
						<div class="mt-4">
							<button
								onclick={() => (showRecommendations = false)}
								class="w-full rounded-xl px-4 py-3 text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-800"
							>
								Tutup
							</button>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Input -->
			<div class="rounded-b-xl border-t border-gray-200 bg-gray-50 p-4">
				<div class="flex space-x-3">
					<textarea
						bind:value={currentMessage}
						onkeydown={handleKeyPress}
						placeholder="Ceritakan transaksi Anda..."
						disabled={isLoading}
						maxlength="2000"
						class="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-pink-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						rows="2"></textarea>
					<button
						onclick={sendMessage}
						disabled={!currentMessage.trim() || isLoading}
						class="rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 px-6 py-3 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:from-pink-600 hover:to-rose-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
						aria-label="Kirim pesan"
					>
						<SendIcon class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		/* Menggunakan background yang sama dengan modal buka/tutup toko */
		background: rgba(0, 0, 0, 0.18);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		z-index: 99999 !important;
		position: fixed !important;
		top: 0 !important;
		left: 0 !important;
		right: 0 !important;
		bottom: 0 !important;
		width: 100vw !important;
		height: 100vh !important;
		overflow: hidden;
		transition: background 0.2s;
		/* Memastikan modal overlay tidak ter-blur */
		filter: none !important;
		-webkit-filter: none !important;
	}

	/* Fallback untuk browser lama */
	@supports not (backdrop-filter: blur(8px)) {
		.modal-overlay {
			background: rgba(0, 0, 0, 0.4);
		}
	}

	/* Memastikan body tidak scroll saat modal terbuka */
	:global(body.modal-open) {
		overflow: hidden;
	}

	/* Memastikan bottomNav ter-blur saat modal terbuka */
	:global(body.modal-open .nav-transition) {
		filter: blur(8px);
		-webkit-filter: blur(8px);
	}
</style>
