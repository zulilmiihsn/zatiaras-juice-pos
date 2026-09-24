<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	import Bot from '@lucide/svelte/icons/bot';
	import BotMessageSquare from '@lucide/svelte/icons/bot-message-square';
	import X from '@lucide/svelte/icons/x';
	import Send from '@lucide/svelte/icons/send';
	import Trophy from '@lucide/svelte/icons/trophy';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Square from '@lucide/svelte/icons/square';
	import Globe from '@lucide/svelte/icons/globe';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Percent from '@lucide/svelte/icons/percent';
	import Clock from '@lucide/svelte/icons/clock';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';
	import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';

	interface ChatMessageItem {
		id: string;
		role: 'user' | 'assistant';
		content: string;
		isStreaming?: boolean;
		webSearch?: boolean;
		dateRange?: { start?: string; end?: string; reasoning?: string };
	}

	let aiQuestion = $state('');
	let showAiModal = $state(false);
	let isAiLoading = $state(false);
	let isStreaming = $state(false);
	let messages = $state<ChatMessageItem[]>([]);
	let chatContainer = $state<HTMLDivElement | null>(null);
	let abortController: AbortController | null = null;
	let copiedId = $state<string | null>(null);

	// Action portal agar modal menempel langsung ke document.body dan tidak tertutup BottomNav
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		};
	}

	// Rekomendasi pertanyaan bersih, simpel & fokus kebutuhan bisnis kasir/pemilik
	const suggestions = [
		{
			id: 'omzet',
			title: 'Performa Penjualan',
			desc: 'Omzet, laba kotor & laba bersih hari ini',
			query:
				'Bagaimana performa penjualan toko hari ini? Berapa omzet, laba kotor, potongan biaya dan laba bersihnya?',
			icon: BarChart3
		},
		{
			id: 'terlaris',
			title: 'Menu Terlaris',
			desc: 'Produk paling laris & banyak terjual',
			query: 'Produk apa saja yang paling laris dan banyak terjual?',
			icon: Trophy
		},
		{
			id: 'stok',
			title: 'Stok Bahan Menipis',
			desc: 'Bahan kritis yang perlu segera restok',
			query:
				'Cek persediaan stok bahan baku toko saat ini. Apakah ada bahan yang stoknya menipis atau kritis di bawah ambang batas?',
			icon: Boxes
		},
		{
			id: 'margin',
			title: 'Margin Laba Menu',
			desc: 'Menu paling untung vs margin tipis',
			query:
				'Analisis HPP dan margin keuntungan tiap produk. Menu apa yang margin labanya paling tinggi dan mana yang tipis?',
			icon: Percent
		},
		{
			id: 'jam_ramai',
			title: 'Jam Ramai Toko',
			desc: 'Pola jam sibuk & pengunjung harian',
			query: 'Kapan jam paling ramai toko dan bagaimana performa transaksi per sesi kerja kasir?',
			icon: Clock
		},
		{
			id: 'tren_web',
			title: 'Riset Menu Viral',
			desc: 'Cari ide minuman tren di internet',
			query:
				'Lakukan riset web tentang tren minuman jus kekinian dan viral di internet, berikan ide inovasi produk baru untuk toko.',
			icon: Globe
		}
	];

	// Rekomendasi follow-up ringkas saat chat aktif
	const quickFollowUps = [
		{ label: 'Cek Stok Kritis', query: 'Bahan apa saja yang stoknya kritis dan mendesak dibeli?' },
		{ label: 'Menu Paling Untung', query: 'Menu mana yang margin labanya paling besar?' },
		{ label: 'Jam Paling Sibuk', query: 'Jam berapa toko biasanya paling ramai?' },
		{ label: 'Riset Tren Web', query: 'Cari di web tren minuman segar yang viral saat ini.' }
	];

	const visibleSuggestions = $derived(
		stockPolicyState.ignored ? suggestions.filter((item) => item.id !== 'stok') : suggestions
	);
	const visibleFollowUps = $derived(
		stockPolicyState.ignored
			? quickFollowUps.filter((item) => item.label !== 'Cek Stok Kritis')
			: quickFollowUps
	);

	onMount(() => {
		void stockPolicyState.refresh();
	});

	// Renderer Markdown ramah tampilan dengan tabel terformat rapi
	function renderMarkdown(md: string): string {
		if (!md) return '';
		const escapeHtml = (s: string) =>
			s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

		const rawLines = md.trim().split('\n');
		let html = '';
		let inList = false;
		let inTable = false;
		let tableHeaders: string[] = [];
		let tableRows: string[][] = [];

		const flushTable = () => {
			if (!inTable) return;
			html +=
				'<div class="my-2.5 w-full max-w-full overflow-x-auto rounded-xl border border-pink-100 bg-white shadow-2xs">';
			html += '<table class="min-w-full border-collapse text-left text-xs text-slate-700">';
			if (tableHeaders.length > 0) {
				html +=
					'<thead class="border-b border-pink-100 bg-pink-50/70 text-[10px] sm:text-[11px] font-bold text-pink-700 uppercase tracking-wider">';
				html += '<tr>';
				for (const h of tableHeaders) {
					html += `<th class="px-2.5 py-2 whitespace-nowrap">${h}</th>`;
				}
				html += '</tr></thead>';
			}
			html += '<tbody class="divide-y divide-slate-100">';
			for (const row of tableRows) {
				html += '<tr class="transition-colors hover:bg-pink-50/30">';
				for (const cell of row) {
					html += `<td class="px-2.5 py-1.5 leading-snug whitespace-nowrap sm:whitespace-normal">${cell}</td>`;
				}
				html += '</tr>';
			}
			html += '</tbody></table></div>';
			inTable = false;
			tableHeaders = [];
			tableRows = [];
		};

		const flushList = () => {
			if (!inList) return;
			html += '</ul>';
			inList = false;
		};

		const inlineFormat = (text: string) => {
			let t = escapeHtml(text);
			t = t.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>');
			t = t.replace(/\*(.*?)\*/g, '<em class="text-slate-600 italic">$1</em>');
			t = t.replace(
				/`([^`]+)`/g,
				'<code class="rounded bg-pink-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-pink-700 break-all">$1</code>'
			);
			return t;
		};

		for (let i = 0; i < rawLines.length; i++) {
			const line = rawLines[i].trim();

			if (line.startsWith('|') && line.endsWith('|')) {
				flushList();
				const cells = line
					.slice(1, -1)
					.split('|')
					.map((c) => inlineFormat(c.trim()));

				const isDivider = cells.every((c) => /^[-:\s]+$/.test(c));
				if (isDivider) continue;

				if (!inTable) {
					inTable = true;
					tableHeaders = cells;
				} else {
					tableRows.push(cells);
				}
				continue;
			} else if (inTable) {
				flushTable();
			}

			if (/^---+$|^\*\*\*+$/.test(line)) {
				flushList();
				html += '<hr class="my-3 border-pink-100" />';
				continue;
			}

			if (/^###\s+/.test(line)) {
				flushList();
				html += `<h4 class="mt-3 mb-1 text-xs font-black uppercase tracking-wider text-pink-700 break-words">${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`;
				continue;
			}
			if (/^##\s+/.test(line)) {
				flushList();
				html += `<h3 class="mt-3.5 mb-1.5 text-sm font-black tracking-tight text-slate-900 break-words">${inlineFormat(line.replace(/^##\s+/, ''))}</h3>`;
				continue;
			}
			if (/^#\s+/.test(line)) {
				flushList();
				html += `<h2 class="mt-4 mb-2 text-base font-black tracking-tight text-slate-900 break-words">${inlineFormat(line.replace(/^#\s+/, ''))}</h2>`;
				continue;
			}

			if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
				if (!inList) {
					html += '<ul class="my-2 space-y-1 pl-4 list-disc text-xs sm:text-sm text-slate-700">';
					inList = true;
				}
				html += `<li class="leading-relaxed break-words">${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`;
				continue;
			} else if (inList) {
				flushList();
			}

			if (!line) continue;

			html += `<p class="my-1.5 text-xs sm:text-sm leading-relaxed text-slate-700 break-words">${inlineFormat(line)}</p>`;
		}

		flushList();
		flushTable();
		return html;
	}

	function scrollToBottom() {
		if (chatContainer) {
			requestAnimationFrame(() => {
				if (chatContainer) {
					chatContainer.scrollTop = chatContainer.scrollHeight;
				}
			});
		}
	}

	function updateAssistantMessage(id: string, content: string, isStreamingStatus: boolean) {
		messages = messages.map((m) =>
			m.id === id ? { ...m, content, isStreaming: isStreamingStatus } : m
		);
	}

	function updateAssistantMeta(
		id: string,
		dateRange?: { start?: string; end?: string; reasoning?: string },
		webSearch?: boolean
	) {
		messages = messages.map((m) =>
			m.id === id
				? {
						...m,
						...(dateRange ? { dateRange } : {}),
						...(webSearch !== undefined ? { webSearch } : {})
					}
				: m
		);
	}

	function getCurrentAssistantMessage(id: string): string {
		return messages.find((m) => m.id === id)?.content || '';
	}

	async function handleCopy(id: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = null;
			}, 2000);
		} catch {}
	}

	function handleStopStreaming() {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		isStreaming = false;
		isAiLoading = false;
	}

	function handleResetChat() {
		if (isStreaming && abortController) {
			abortController.abort();
		}
		messages = [];
		aiQuestion = '';
		isAiLoading = false;
		isStreaming = false;
	}

	function handleAiClose() {
		showAiModal = false;
	}

	async function handleAiAsk(question: string) {
		const cleanQ = question.trim();
		if (!cleanQ) return;

		// Jika sedang streaming atau proses lama, batalkan dulu sebelum kirim pertanyaan baru
		if (abortController) {
			abortController.abort();
			abortController = null;
		}

		aiQuestion = '';
		showAiModal = true;
		isAiLoading = true;
		isStreaming = true;

		const userMsgId = crypto.randomUUID();
		const aiMsgId = crypto.randomUUID();

		const historyPayload = messages.map((m) => ({
			role: m.role,
			content: m.content
		}));

		messages = [
			...messages,
			{ id: userMsgId, role: 'user', content: cleanQ },
			{ id: aiMsgId, role: 'assistant', content: '', isStreaming: true }
		];

		scrollToBottom();
		abortController = new AbortController();

		try {
			const response = await fetchWithCsrfRetry('/api/aichat', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					question: cleanQ,
					branch: selectedBranch.value,
					stream: true,
					history: historyPayload
				}),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const baseMsg = errorData.error || `Gagal menghubungi AI (${response.status})`;
				const errorMsg = errorData.suggestion
					? `${baseMsg}\n\n💡 _${errorData.suggestion}_`
					: `Error: ${baseMsg}`;
				updateAssistantMessage(aiMsgId, errorMsg, false);
				if (response.status !== 404) {
					reportApiFailure(errorData, response.status, '/api/aichat');
				}
				return;
			}

			const contentType = response.headers.get('content-type') || '';
			if (contentType.includes('text/event-stream') && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				let accumulatedText = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(':')) continue;
						if (trimmed.startsWith('data: ')) {
							const jsonStr = trimmed.slice(6).trim();
							try {
								const ev = JSON.parse(jsonStr);
								if (ev.type === 'token') {
									accumulatedText += ev.text;
									updateAssistantMessage(aiMsgId, accumulatedText, true);
									scrollToBottom();
								} else if (ev.type === 'meta') {
									updateAssistantMeta(aiMsgId, ev.dateRange, ev.webSearch);
								} else if (ev.type === 'done') {
									updateAssistantMessage(aiMsgId, accumulatedText, false);
								} else if (ev.type === 'error') {
									accumulatedText += `\n\n_Peringatan: ${ev.error}_`;
									updateAssistantMessage(aiMsgId, accumulatedText, false);
								}
							} catch {
								// Abaikan baris parsial
							}
						}
					}
				}
				updateAssistantMessage(aiMsgId, accumulatedText, false);
			} else {
				const result = await response.json();
				if (result.success) {
					updateAssistantMessage(aiMsgId, result.answer, false);
					updateAssistantMeta(aiMsgId, result.dateRange, result.webSearch);
				} else {
					updateAssistantMessage(
						aiMsgId,
						`Error: ${getApiErrorMessage(result, response.status, 'Terjadi kesalahan saat memproses pertanyaan.')}`,
						false
					);
				}
			}
		} catch (err: any) {
			if (err?.name === 'AbortError') {
				const current = getCurrentAssistantMessage(aiMsgId);
				updateAssistantMessage(
					aiMsgId,
					(current || '') + ' _(analisis dihentikan pengguna)_',
					false
				);
			} else {
				updateAssistantMessage(
					aiMsgId,
					'Maaf, terjadi kesalahan koneksi saat menghubungi Asisten AI. Pastikan koneksi internet stabil.',
					false
				);
			}
		} finally {
			isAiLoading = false;
			isStreaming = false;
			abortController = null;
			scrollToBottom();
		}
	}
</script>

<!-- ─── 1. FLOATING ACTION BUTTON (FAB) TEMA PINK RESMI ZATIARAS ─────────────── -->
<div class="z-fab fixed right-4 bottom-20 sm:right-6 sm:bottom-24">
	<button
		type="button"
		onclick={() => (showAiModal = true)}
		class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-4 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
		aria-label="Buka Asisten AI"
	>
		<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
			<BotMessageSquare class="h-4 w-4 stroke-[2.2] text-white" />
		</div>
		<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tanya AI</span>
	</button>
</div>

<!-- ─── 2. ASSISTANT MODAL DIALOG (PORTAL KE BODY, BEBAS TUMPUKAN BOTTOMNAV) ─── -->
{#if showAiModal}
	<div
		use:portal
		class="z-dialog fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-black/60 p-3 backdrop-blur-xs sm:p-5"
		onclick={(e) => e.target === e.currentTarget && handleAiClose()}
		onkeydown={(e) => e.key === 'Escape' && handleAiClose()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 180 }}
	>
		<div
			class="flex h-[78dvh] max-h-[78dvh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl transition-all duration-200 sm:h-[620px] sm:max-h-[85dvh] sm:rounded-[32px]"
			transition:scale={{ duration: 220, start: 0.95, easing: cubicOut }}
		>
			<!-- Header Modal Gradien Pink Khas Zatiaras -->
			<div
				class="relative overflow-hidden bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 py-4 text-white shadow-sm"
			>
				<div class="relative z-10 flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/20 shadow-xs backdrop-blur-md"
						>
							<BotMessageSquare class="h-5 w-5 stroke-[2.2] text-white" />
						</div>
						<div>
							<h3 class="text-sm font-black tracking-tight text-white sm:text-base">
								Asisten AI Zatiaras
							</h3>
							<div class="flex items-center gap-1.5 text-[11px] font-medium text-pink-100">
								<span class="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
								<span>Analisis Data Bisnis Cabang {selectedBranch.value || 'Aktif'}</span>
							</div>
						</div>
					</div>

					<div class="flex items-center gap-1.5">
						{#if messages.length > 0}
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

			<!-- Body Konten Percakapan / Saran Bersih -->
			<div
				bind:this={chatContainer}
				class="flex flex-1 flex-col gap-3.5 overflow-y-auto bg-[#faf7f8] p-4 sm:p-5"
			>
				{#if messages.length === 0}
					<!-- Welcome State Sederhana & Ramah -->
					<div class="flex flex-col items-center py-3 text-center">
						<div
							class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 shadow-2xs"
						>
							<Bot size={24} class="stroke-[2.2]" />
						</div>
						<h4 class="text-sm font-black text-slate-900 sm:text-base">Ada yang bisa dibantu?</h4>
						<p class="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
							Tanyakan apa saja seputar performa penjualan, laba, stok bahan, atau tren minuman
							tokomu.
						</p>

						<!-- Rekomendasi Pertanyaan Bersih -->
						<div class="mt-5 flex w-full flex-col gap-2">
							<span class="text-left text-[11px] font-bold tracking-wider text-slate-400 uppercase">
								Rekomendasi Pertanyaan
							</span>
							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{#each visibleSuggestions as item}
									{@const IconComponent = item.icon}
									<button
										type="button"
										onclick={() => handleAiAsk(item.query)}
										class="group flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-2xs transition-all hover:border-pink-300 hover:bg-pink-50/40 active:scale-[0.98]"
									>
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600 transition-colors group-hover:bg-pink-100"
										>
											<IconComponent size={17} class="stroke-[2.2]" />
										</div>
										<div class="min-w-0 flex-1">
											<div
												class="text-xs font-bold text-slate-800 transition-colors group-hover:text-pink-700"
											>
												{item.title}
											</div>
											<div class="truncate text-[11px] text-slate-500">
												{item.desc}
											</div>
										</div>
									</button>
								{/each}
							</div>
						</div>
					</div>
				{:else}
					<!-- Percakapan Aktif Multi-Turn -->
					{#each messages as msg (msg.id)}
						{#if msg.role === 'user'}
							<!-- Bubble Pertanyaan User -->
							<div class="flex w-full justify-end">
								<div
									class="max-w-[85%] rounded-2xl rounded-tr-xs bg-gradient-to-r from-pink-600 to-rose-600 px-4 py-2.5 text-xs font-bold break-words text-white shadow-sm sm:text-sm"
								>
									{msg.content}
								</div>
							</div>
						{:else}
							<!-- Bubble Jawaban AI -->
							<div class="flex w-full min-w-0 items-start gap-2 sm:gap-2.5">
								<div
									class="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600 shadow-2xs sm:h-8 sm:w-8"
								>
									{#if msg.isStreaming}
										<Bot size={15} class="animate-bounce stroke-[2.2]" />
									{:else}
										<Bot size={15} class="stroke-[2.2]" />
									{/if}
								</div>
								<div
									class="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-xs border border-slate-200/80 bg-white p-3.5 shadow-sm sm:p-4"
								>
									{#if (msg.dateRange?.start && msg.dateRange?.end) || msg.webSearch}
										<div
											class="mb-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 pb-2"
										>
											<div class="flex flex-wrap items-center gap-1.5">
												{#if msg.dateRange?.start && msg.dateRange?.end}
													<span
														class="inline-flex items-center rounded-md border border-pink-100 bg-pink-50 px-2 py-0.5 text-[10px] font-bold text-pink-700"
													>
														Periode: {msg.dateRange.start} s/d {msg.dateRange.end}
													</span>
												{/if}
												{#if msg.webSearch}
													<span
														class="inline-flex items-center gap-1 rounded-md border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700"
													>
														<Globe size={11} class="stroke-[2.5]" />
														Riset Pasar Web
													</span>
												{/if}
											</div>

											{#if msg.content && !msg.isStreaming}
												<button
													type="button"
													onclick={() => handleCopy(msg.id, msg.content)}
													class="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 active:scale-95"
													title="Salin analisis"
												>
													{#if copiedId === msg.id}
														<Check size={11} class="stroke-[2.5] text-emerald-600" />
														<span class="text-emerald-600">Tersalin</span>
													{:else}
														<Copy size={11} class="stroke-[2.2]" />
														<span>Salin</span>
													{/if}
												</button>
											{/if}
										</div>
									{/if}

									{#if msg.isStreaming && !msg.content}
										<div class="flex items-center gap-2 py-1">
											<div class="flex items-center gap-1.5">
												<span class="h-2 w-2 animate-bounce rounded-full bg-pink-600"></span>
												<span
													class="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:0.15s]"
												></span>
												<span
													class="h-2 w-2 animate-bounce rounded-full bg-pink-600 [animation-delay:0.3s]"
												></span>
											</div>
											<span class="text-xs font-bold text-slate-500">
												{msg.webSearch
													? 'Mencari data tren web...'
													: 'Menganalisis data transaksi toko...'}
											</span>
										</div>
									{:else}
										<div
											class="prose prose-sm max-w-none min-w-0 [overflow-wrap:anywhere] break-words text-slate-800"
										>
											{@html renderMarkdown(msg.content)}
										</div>
										{#if msg.isStreaming}
											<span
												class="inline-block h-3.5 w-1 animate-pulse rounded-full bg-pink-500 align-middle"
											></span>
										{/if}
									{/if}

									<div class="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
										Analisis AI berbasis data cabang {selectedBranch.value || 'terpilih'}.
									</div>
								</div>
							</div>
						{/if}
					{/each}

					<!-- Saran Pertanyaan Lanjutan -->
					{#if !isStreaming}
						<div class="mt-1 flex flex-wrap gap-1.5 pt-1">
							{#each visibleFollowUps as item}
								<button
									type="button"
									onclick={() => handleAiAsk(item.query)}
									class="cursor-pointer rounded-full border border-pink-200 bg-white px-3 py-1 text-[11px] font-bold text-pink-700 shadow-2xs hover:bg-pink-50 active:scale-95"
								>
									{item.label}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>

			<!-- Input Bar Bawah Berwarna Tema Pink -->
			<div class="border-t border-pink-100/80 bg-white p-2.5 pb-3 sm:p-4 sm:pb-4">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						if (isStreaming || isAiLoading) {
							handleStopStreaming();
						} else {
							handleAiAsk(aiQuestion);
						}
					}}
					class="flex items-center gap-2"
				>
					<input
						type="text"
						placeholder="Ketik pertanyaan untuk asisten AI..."
						bind:value={aiQuestion}
						class="flex-1 rounded-2xl border border-pink-200/90 bg-pink-50/40 px-3.5 py-2 text-xs font-bold text-slate-900 transition-colors focus:border-pink-500 focus:bg-white focus:outline-none sm:px-4 sm:py-2.5 sm:text-sm"
					/>
					{#if isStreaming || isAiLoading}
						<button
							type="button"
							onclick={handleStopStreaming}
							class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-rose-500 text-white shadow-md shadow-rose-500/25 transition-all hover:bg-rose-600 active:scale-95"
							title="Hentikan respons AI"
							aria-label="Hentikan respons AI"
						>
							<Square size={14} class="fill-current" />
						</button>
					{:else}
						<button
							type="submit"
							disabled={!aiQuestion.trim()}
							class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
							title="Kirim pertanyaan"
							aria-label="Kirim pertanyaan"
						>
							<Send size={16} class="stroke-[2.5]" />
						</button>
					{/if}
				</form>
			</div>
		</div>
	</div>
{/if}
