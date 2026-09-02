<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';
	import Send from '@lucide/svelte/icons/send';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import Trophy from '@lucide/svelte/icons/trophy';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	let aiQuestion = $state('');
	let showAiModal = $state(false);
	let isAiLoading = $state(false);
	let aiAnswer = $state('');
	let lastQuestion = $state('');
	let chatContainer = $state<HTMLDivElement | null>(null);

	const quickSuggestions = [
		{
			id: 'performa',
			label: 'Performa Penjualan',
			query: 'Bagaimana performa penjualan toko hari ini?',
			icon: BarChart3
		},
		{
			id: 'terlaris',
			label: 'Menu Terlaris',
			query: 'Produk apa saja yang paling laris dan banyak terjual?',
			icon: Trophy
		},
		{
			id: 'laba',
			label: 'Keuntungan Bersih',
			query: 'Berapa laba kotor, potongan biaya dan keuntungan bersih periode ini?',
			icon: DollarSign
		},
		{
			id: 'tren',
			label: 'Tren Penjualan',
			query: 'Bagaimana tren dan pola penjualan dalam seminggu terakhir?',
			icon: TrendingUp
		}
	];

	// Renderer Markdown sederhana & aman untuk respons AI
	function renderMarkdown(md: string): string {
		if (!md) return '';
		const escapeHtml = (s: string) =>
			s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		let text = escapeHtml(md.trim());

		// Heading markdown (###, ##, #)
		text = text.replace(
			/^(?:\s*)###\s+(.+)$/gm,
			'<h4 class="text-slate-900 font-bold text-sm mt-3 mb-1">$1</h4>'
		);
		text = text.replace(
			/^(?:\s*)##\s+(.+)$/gm,
			'<h3 class="text-slate-900 font-black text-sm mt-3.5 mb-1.5">$1</h3>'
		);
		text = text.replace(
			/^(?:\s*)#\s+(.+)$/gm,
			'<h3 class="text-slate-900 font-black text-base mt-4 mb-2">$1</h3>'
		);

		// Bold **teks**
		text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900 font-bold">$1</strong>');
		// Italic *teks*
		text = text.replace(/\*(.*?)\*/g, '<em class="text-slate-600">$1</em>');

		// List items
		const lines = text.split(/\n/);
		let html = '';
		let inList = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (/^-\s+/.test(trimmed)) {
				if (!inList) {
					html += '<ul class="list-disc pl-4 space-y-1 my-1.5 text-xs sm:text-sm text-slate-700">';
					inList = true;
				}
				html += `<li>${trimmed.replace(/^-\s+/, '')}</li>`;
			} else if (trimmed.length === 0) {
				if (inList) {
					html += '</ul>';
					inList = false;
				}
			} else {
				if (inList) {
					html += '</ul>';
					inList = false;
				}
				html += `<p class="my-1.5 text-xs sm:text-sm leading-relaxed text-slate-700">${trimmed}</p>`;
			}
		}
		if (inList) html += '</ul>';
		return html;
	}

	async function handleAiAsk(question: string) {
		const cleanQ = question.trim();
		if (!cleanQ || isAiLoading) return;

		lastQuestion = cleanQ;
		aiQuestion = '';
		showAiModal = true;
		isAiLoading = true;
		aiAnswer = '';

		try {
			const response = await fetchWithCsrfRetry('/api/aichat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					question: cleanQ,
					branch: selectedBranch.value
				})
			});

			const result = await response.json();

			if (result.success) {
				aiAnswer = result.answer;
			} else {
				reportApiFailure(result, response.status, '/api/aichat');
				aiAnswer = `Error: ${getApiErrorMessage(result, response.status, 'Terjadi kesalahan saat memproses pertanyaan.')}`;
			}
		} catch {
			aiAnswer =
				'Maaf, terjadi kesalahan saat menghubungi Asisten AI. Pastikan API key OPENROUTER_API_KEY sudah dikonfigurasi di file .env.';
		} finally {
			isAiLoading = false;
			if (chatContainer) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}
	}

	function handleAiClose() {
		showAiModal = false;
	}

	function handleResetChat() {
		aiAnswer = '';
		lastQuestion = '';
		aiQuestion = '';
		isAiLoading = false;
	}
</script>

<!-- ─── 1. FLOATING ACTION BUTTON (FAB) ──────────────────────────────────────── -->
<div class="fixed right-4 bottom-22 z-40 sm:right-6 sm:bottom-24">
	<button
		type="button"
		onclick={() => (showAiModal = true)}
		class="group flex cursor-pointer items-center gap-2 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-4.5 pl-3.5 text-white shadow-xl shadow-pink-500/25 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
		aria-label="Buka Asisten AI"
	>
		<div class="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
			<Sparkles class="h-3.5 w-3.5 animate-pulse stroke-[2.5] text-white" />
		</div>
		<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tanya AI</span>
	</button>
</div>

<!-- ─── 2. ASSISTANT MODAL DIALOG ────────────────────────────────────────────── -->
{#if showAiModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-xs sm:p-5"
		onclick={(e) => e.target === e.currentTarget && handleAiClose()}
		onkeydown={(e) => e.key === 'Escape' && handleAiClose()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 180 }}
	>
		<div
			class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl transition-all duration-200"
			transition:scale={{ duration: 220, start: 0.94, easing: cubicOut }}
		>
			<!-- Header Modal Asisten -->
			<div
				class="relative overflow-hidden bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 py-4 text-white shadow-sm"
			>
				<div class="relative z-10 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/20 shadow-xs backdrop-blur-md"
						>
							<Sparkles class="h-5 w-5 stroke-[2.5] text-white" />
						</div>
						<div>
							<h3 class="text-sm font-black tracking-tight sm:text-base">Asisten AI Keuangan</h3>
							<div class="flex items-center gap-1.5 text-[11px] font-semibold text-pink-100">
								<span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
								<span>Analisis Data Otomatis</span>
							</div>
						</div>
					</div>

					<div class="flex items-center gap-1.5">
						{#if lastQuestion || aiAnswer}
							<button
								type="button"
								onclick={handleResetChat}
								class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/20 text-white transition-all hover:bg-white/30 active:scale-95"
								title="Mulai Percakapan Baru"
								aria-label="Reset Percakapan"
							>
								<RotateCcw size={15} class="stroke-[2.2]" />
							</button>
						{/if}
						<button
							type="button"
							onclick={handleAiClose}
							class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white/20 text-white transition-all hover:bg-white/30 active:scale-95"
							aria-label="Tutup Asisten AI"
						>
							<X size={17} class="stroke-[2.5]" />
						</button>
					</div>
				</div>
			</div>

			<!-- Body Konten Percakapan / Saran -->
			<div
				bind:this={chatContainer}
				class="flex flex-1 flex-col gap-3.5 overflow-y-auto bg-[#faf7f8] p-4 sm:p-5"
			>
				{#if !lastQuestion && !aiAnswer && !isAiLoading}
					<!-- Welcome State & Quick Suggestions -->
					<div class="flex flex-col items-center py-4 text-center">
						<div
							class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 shadow-2xs"
						>
							<Sparkles size={24} class="stroke-[2.2]" />
						</div>
						<h4 class="text-sm font-black text-slate-900 sm:text-base">Ada yang bisa dibantu?</h4>
						<p class="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
							Tanyakan apa saja seputar performa keuangan, omzet, produk terlaris, atau analisis
							tren toko Anda.
						</p>

						<div class="mt-5 flex w-full flex-col gap-2">
							<span class="text-left text-[11px] font-bold tracking-wider text-slate-400 uppercase"
								>Rekomendasi Pertanyaan</span
							>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each quickSuggestions as item}
									{@const IconComponent = item.icon}
									<button
										type="button"
										onclick={() => handleAiAsk(item.query)}
										class="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-2xs transition-all hover:border-pink-300 hover:bg-pink-50/40 active:scale-[0.98]"
									>
										<div
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600"
										>
											<IconComponent size={16} class="stroke-[2.2]" />
										</div>
										<span class="text-xs font-bold text-slate-800">{item.label}</span>
									</button>
								{/each}
							</div>
						</div>
					</div>
				{:else}
					<!-- Percakapan Aktif -->
					{#if lastQuestion}
						<!-- Bubble Pertanyaan User -->
						<div class="flex justify-end">
							<div
								class="max-w-[85%] rounded-2xl rounded-tr-xs bg-gradient-to-r from-pink-600 to-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm sm:text-sm"
							>
								{lastQuestion}
							</div>
						</div>
					{/if}

					<!-- Bubble Jawaban AI -->
					{#if isAiLoading}
						<div class="flex items-start gap-2.5">
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pink-100 text-pink-600 shadow-2xs"
							>
								<Sparkles size={16} class="animate-spin stroke-[2.2]" />
							</div>
							<div
								class="flex items-center gap-2 rounded-2xl rounded-tl-xs border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
							>
								<div class="flex items-center gap-1.5">
									<span class="h-2 w-2 animate-bounce rounded-full bg-pink-600"></span>
									<span
										class="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:0.15s]"
									></span>
									<span
										class="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:0.3s]"
									></span>
								</div>
								<span class="text-xs font-bold text-slate-500">Menganalisis data keuangan...</span>
							</div>
						</div>
					{:else if aiAnswer}
						<div class="flex items-start gap-2.5">
							<div
								class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600 shadow-2xs"
							>
								<Sparkles size={16} class="stroke-[2.2]" />
							</div>
							<div
								class="flex-1 rounded-2xl rounded-tl-xs border border-slate-200/80 bg-white p-4 shadow-sm"
							>
								<div class="prose prose-sm max-w-none text-slate-800">
									{@html renderMarkdown(aiAnswer)}
								</div>

								<div class="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
									Analisis AI berdasarkan data transaksi riil cabang {selectedBranch.value ||
										'terpilih'}.
								</div>
							</div>
						</div>

						<!-- Saran Lanjutan -->
						<div class="mt-2 flex flex-wrap gap-1.5 pt-1">
							{#each quickSuggestions.filter((s) => s.query !== lastQuestion) as item}
								<button
									type="button"
									onclick={() => handleAiAsk(item.query)}
									class="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 shadow-2xs hover:border-pink-300 hover:bg-pink-50 active:scale-95"
								>
									{item.label}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Input Bar Bawah -->
			<div class="border-t border-slate-100 bg-white p-3 sm:p-4">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleAiAsk(aiQuestion);
					}}
					class="flex items-center gap-2"
				>
					<input
						type="text"
						placeholder="Ketik pertanyaan untuk asisten AI..."
						bind:value={aiQuestion}
						disabled={isAiLoading}
						class="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-900 transition-colors focus:border-pink-500 focus:bg-white focus:outline-none disabled:opacity-60 sm:text-sm"
					/>
					<button
						type="submit"
						disabled={!aiQuestion.trim() || isAiLoading}
						class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
						aria-label="Kirim pertanyaan"
					>
						<Send size={16} class="stroke-[2.5]" />
					</button>
				</form>
			</div>
		</div>
	</div>
{/if}
