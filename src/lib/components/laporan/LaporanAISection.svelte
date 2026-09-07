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
	import Square from '@lucide/svelte/icons/square';
	import Globe from '@lucide/svelte/icons/globe';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Percent from '@lucide/svelte/icons/percent';
	import Clock from '@lucide/svelte/icons/clock';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Database from '@lucide/svelte/icons/database';

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

	// Rekomendasi terstruktur format Bento Grid
	const suggestionCategories = [
		{
			id: 'keuangan',
			name: 'Finansial & Margin',
			badge: 'SQL D1',
			badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
			items: [
				{
					id: 'performa',
					title: 'Performa Penjualan & Laba',
					desc: 'Ringkasan omzet, laba kotor, beban operasional, dan laba bersih riil.',
					query: 'Bagaimana performa penjualan toko hari ini? Berapa omzet, laba kotor, potongan biaya dan laba bersihnya?',
					icon: BarChart3,
					tag: 'Buku Kas'
				},
				{
					id: 'margin',
					title: 'Analisis Margin Menu & HPP',
					desc: 'Temukan produk bermargin paling tebal dan menu dengan HPP tinggi.',
					query: 'Analisis HPP dan margin keuntungan tiap produk. Menu apa yang margin labanya paling tinggi dan mana yang tipis?',
					icon: Percent,
					tag: 'Profitabilitas'
				}
			]
		},
		{
			id: 'operasional',
			name: 'Inventaris & Operasional',
			badge: 'Stok D1',
			badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/80',
			items: [
				{
					id: 'stok',
					title: 'Bahan Kritis & Alert Stok',
					desc: 'Pantau bahan baku yang menipis di bawah ambang batas aman.',
					query: 'Cek persediaan stok bahan baku toko saat ini. Apakah ada bahan yang stoknya menipis atau kritis di bawah ambang batas?',
					icon: Boxes,
					tag: 'Restok'
				},
				{
					id: 'jam_ramai',
					title: 'Jam Ramai & Shift Kasir',
					desc: 'Evaluasi jam sibuk toko dan efisiensi omzet per sesi kasir.',
					query: 'Kapan jam paling ramai toko dan bagaimana performa transaksi per sesi kerja kasir?',
					icon: Clock,
					tag: 'Shift & Jam'
				}
			]
		},
		{
			id: 'strategi',
			name: 'Riset Pasar & Strategi',
			badge: 'Web Live',
			badgeClass: 'bg-sky-50 text-sky-700 border-sky-200/80',
			items: [
				{
					id: 'riset_web',
					title: 'Riset Tren Minuman Viral',
					desc: 'Browsing live internet untuk tren varian rasa dan inovasi menu baru.',
					query: 'Lakukan riset web tentang tren minuman jus kekinian dan viral di internet, berikan ide inovasi produk baru untuk toko.',
					icon: Globe,
					tag: 'Web Agent'
				},
				{
					id: 'psikologi_harga',
					title: 'Psikologi Harga & Bundling',
					desc: 'Strategi paket menu dan optimasi harga jual untuk menaikkan basket size.',
					query: 'Analisis menu terlaris dan berikan rekomendasi strategi harga (pricing psychology) serta bundling untuk menaikkan omzet.',
					icon: Lightbulb,
					tag: 'Pricing'
				}
			]
		}
	];

	// Rekomendasi pertanyaan cepat saat percakapan sudah berjalan
	const quickFollowUps = [
		{ label: 'Cek Bahan Kritis', query: 'Bahan apa saja yang stoknya di bawah batas aman dan perlu restok segera?' },
		{ label: 'Menu Paling Untung', query: 'Menu mana yang margin laba kotornya paling tinggi untuk dipromosikan?' },
		{ label: 'Jam Paling Sibuk', query: 'Jam berapa toko mencatat volume transaksi paling ramai?' },
		{ label: 'Riset Tren Viral', query: 'Cari di web inovasi minuman jus yang sedang tren tahun ini.' }
	];

	// Renderer Markdown yang mendukung tabel, list, heading, dan inline code
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
			html += '<div class="my-3 overflow-x-auto rounded-xl border border-slate-200/90 bg-white shadow-2xs">';
			html += '<table class="w-full border-collapse text-left text-xs text-slate-700">';
			if (tableHeaders.length > 0) {
				html += '<thead class="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">';
				html += '<tr>';
				for (const h of tableHeaders) {
					html += `<th class="px-3 py-2.5 whitespace-nowrap font-bold">${h}</th>`;
				}
				html += '</tr></thead>';
			}
			html += '<tbody class="divide-y divide-slate-100">';
			for (const row of tableRows) {
				html += '<tr class="transition-colors hover:bg-slate-50/70">';
				for (const cell of row) {
					html += `<td class="px-3 py-2 leading-relaxed">${cell}</td>`;
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
				'<code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800">$1</code>'
			);
			return t;
		};

		for (let i = 0; i < rawLines.length; i++) {
			const line = rawLines[i].trim();

			// Deteksi baris tabel markdown (| a | b |)
			if (line.startsWith('|') && line.endsWith('|')) {
				flushList();
				const cells = line
					.slice(1, -1)
					.split('|')
					.map((c) => inlineFormat(c.trim()));

				const isDivider = cells.every((c) => /^[-:\s]+$/.test(c));
				if (isDivider) {
					continue;
				}

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

			// Horizontal separator (--- atau ***)
			if (/^---+$|^\*\*\*+$/.test(line)) {
				flushList();
				html += '<hr class="my-3 border-slate-200" />';
				continue;
			}

			// Headings
			if (/^###\s+/.test(line)) {
				flushList();
				html += `<h4 class="mt-3.5 mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-900">${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`;
				continue;
			}
			if (/^##\s+/.test(line)) {
				flushList();
				html += `<h3 class="mt-4 mb-2 text-sm font-black tracking-tight text-slate-900">${inlineFormat(line.replace(/^##\s+/, ''))}</h3>`;
				continue;
			}
			if (/^#\s+/.test(line)) {
				flushList();
				html += `<h2 class="mt-4.5 mb-2.5 text-base font-black tracking-tight text-slate-900">${inlineFormat(line.replace(/^#\s+/, ''))}</h2>`;
				continue;
			}

			// Unordered list items
			if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
				if (!inList) {
					html += '<ul class="my-2 space-y-1 pl-4 list-disc text-xs sm:text-sm text-slate-700">';
					inList = true;
				}
				html += `<li class="leading-relaxed">${inlineFormat(line.replace(/^[-\*]\s+/, ''))}</li>`;
				continue;
			} else if (inList) {
				flushList();
			}

			// Baris kosong
			if (!line) {
				continue;
			}

			// Paragraf biasa
			html += `<p class="my-1.5 text-xs sm:text-sm leading-relaxed text-slate-700">${inlineFormat(line)}</p>`;
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
		if (!cleanQ || isAiLoading || isStreaming) return;

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

<!-- ─── 1. FLOATING ACTION BUTTON (FAB) ──────────────────────────────────────── -->
<div class="z-fab fixed right-4 bottom-22 sm:right-6 sm:bottom-24">
	<button
		type="button"
		onclick={() => (showAiModal = true)}
		class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-slate-700/80 bg-slate-900/95 py-3 pr-4.5 pl-3.5 text-white shadow-xl shadow-slate-950/25 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:bg-slate-800 hover:shadow-2xl hover:shadow-slate-950/35 active:scale-95"
		aria-label="Buka Partner Bisnis AI"
	>
		<div class="relative flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 border border-slate-700/70 text-rose-400 shadow-2xs">
			<Sparkles class="h-3.5 w-3.5 stroke-[2.4]" />
			<span class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse"></span>
		</div>
		<div class="flex flex-col text-left">
			<span class="text-xs font-black tracking-tight text-white">Partner Bisnis AI</span>
			<span class="text-[9px] font-semibold text-slate-400 leading-none">SQL + Web Live</span>
		</div>
	</button>
</div>

<!-- ─── 2. ASSISTANT MODAL DIALOG ────────────────────────────────────────────── -->
{#if showAiModal}
	<div
		class="z-dialog fixed inset-0 flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
		onclick={(e) => e.target === e.currentTarget && handleAiClose()}
		onkeydown={(e) => e.key === 'Escape' && handleAiClose()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 180 }}
	>
		<div
			class="flex h-[92dvh] sm:h-[680px] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] bg-[#f8f9fa] shadow-2xl border border-slate-200/80 transition-all duration-200"
			transition:scale={{ duration: 220, start: 0.95, easing: cubicOut }}
		>
			<!-- Header Modal Asisten -->
			<div class="relative z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5 text-white">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-900 text-rose-400 shadow-xs">
						<Sparkles class="h-5 w-5 stroke-[2.3]" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<h3 class="text-sm font-black tracking-tight text-white sm:text-base">Partner Bisnis & Strategi AI</h3>
							<span class="rounded-md border border-slate-700 bg-slate-800/80 px-1.5 py-0.2 font-mono text-[9px] font-bold text-slate-300">
								MiniMax M3
							</span>
						</div>
						<div class="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
							<span>Terhubung Database SQL D1 &amp; Riset Web Aktif</span>
							<span class="text-slate-600">•</span>
							<span class="text-slate-300 font-semibold">{selectedBranch.value || 'Cabang Aktif'}</span>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-1.5">
					{#if messages.length > 0}
						<button
							type="button"
							onclick={handleResetChat}
							class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 transition-all hover:bg-slate-800 hover:text-white active:scale-95"
							title="Mulai Percakapan Baru"
							aria-label="Reset Percakapan"
						>
							<RotateCcw size={14} class="stroke-[2.2]" />
						</button>
					{/if}
					<button
						type="button"
						onclick={handleAiClose}
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 transition-all hover:bg-slate-800 hover:text-white active:scale-95"
						aria-label="Tutup Asisten AI"
					>
						<X size={16} class="stroke-[2.5]" />
					</button>
				</div>
			</div>

			<!-- Body Konten Percakapan / Saran -->
			<div
				bind:this={chatContainer}
				class="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5"
			>
				{#if messages.length === 0}
					<!-- Welcome State & Bento Grid Suggestions -->
					<div class="flex flex-col gap-4">
						<!-- Hero Bar -->
						<div class="flex flex-col gap-1 rounded-2xl border border-slate-200/80 bg-white p-4.5 shadow-2xs">
							<div class="flex items-center justify-between">
								<span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Analisis Otomatis &amp; Strategi</span>
								<div class="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
									<Database size={11} class="text-slate-400" />
									<span>D1 SQLite Terisolasi</span>
								</div>
							</div>
							<h4 class="text-base font-black tracking-tight text-slate-900 sm:text-lg">
								Ada yang ingin dianalisis hari ini?
							</h4>
							<p class="text-xs leading-relaxed text-slate-600">
								Kueri data keuangan riil, pantau stok bahan baku kritis, bandingkan margin laba menu, atau riset tren kuliner viral via live web browsing.
							</p>

							<!-- Tips Memori Jangka Panjang -->
							<div class="mt-2 flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-left">
								<Lightbulb size={14} class="shrink-0 text-amber-600" />
								<span class="text-[11px] leading-tight text-slate-600">
									<strong class="font-bold text-slate-800">Tips Memori:</strong> Ketik
									<code class="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-800 border border-slate-200/80">Ingat: [target omzet/catatan]</code>
									agar AI selalu menjadikannya acuan analisis.
								</span>
							</div>
						</div>

						<!-- Bento Grid Kategori Rekomendasi -->
						<div class="space-y-4">
							{#each suggestionCategories as cat}
								<div class="space-y-2">
									<div class="flex items-center justify-between px-1">
										<span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">{cat.name}</span>
										<span class="rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold {cat.badgeClass}">
											{cat.badge}
										</span>
									</div>

									<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
										{#each cat.items as item}
											{@const IconComponent = item.icon}
											<button
												type="button"
												onclick={() => handleAiAsk(item.query)}
												class="group flex cursor-pointer flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3.5 text-left shadow-2xs transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/60 active:scale-[0.98]"
											>
												<div class="flex items-start justify-between gap-2">
													<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800 group-hover:bg-slate-900 group-hover:text-white transition-colors">
														<IconComponent size={16} class="stroke-[2.2]" />
													</div>
													<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
														{item.tag}
													</span>
												</div>

												<div class="mt-2.5">
													<div class="flex items-center justify-between">
														<span class="text-xs font-bold text-slate-900 group-hover:text-slate-950">{item.title}</span>
														<ArrowRight size={13} class="text-slate-300 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
													</div>
													<p class="mt-0.5 text-[11px] leading-snug text-slate-500 line-clamp-2">
														{item.desc}
													</p>
												</div>
											</button>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<!-- Percakapan Aktif Multi-Turn -->
					{#each messages as msg (msg.id)}
						{#if msg.role === 'user'}
							<!-- Bubble Pertanyaan User -->
							<div class="flex justify-end">
								<div class="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tr-xs bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-2xs sm:text-sm">
									{msg.content}
								</div>
							</div>
						{:else}
							<!-- Bubble Jawaban AI -->
							<div class="flex items-start gap-2.5">
								<div class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-2xs">
									{#if msg.isStreaming}
										<Sparkles size={15} class="animate-spin stroke-[2.2] text-rose-400" />
									{:else}
										<Sparkles size={15} class="stroke-[2.2] text-rose-400" />
									{/if}
								</div>

								<div class="flex-1 rounded-2xl rounded-tl-xs border border-slate-200/90 bg-white p-4 shadow-xs sm:p-5">
									<!-- Meta Badges Bar & Copy Action -->
									<div class="mb-3 flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 pb-2.5">
										<div class="flex flex-wrap items-center gap-1.5">
											<span class="inline-flex items-center rounded-md border border-slate-200 bg-slate-100/70 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700">
												Analisis Bisnis Zatiaras
											</span>
											{#if msg.dateRange?.start && msg.dateRange?.end}
												<span class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
													📅 {msg.dateRange.start} s/d {msg.dateRange.end}
												</span>
											{/if}
											{#if msg.webSearch}
												<span class="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">
													<Globe size={11} class="stroke-[2.5]" />
													Riset Web Live
												</span>
											{/if}
										</div>

										{#if msg.content && !msg.isStreaming}
											<button
												type="button"
												onclick={() => handleCopy(msg.id, msg.content)}
												class="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
												title="Salin isi analisis"
											>
												{#if copiedId === msg.id}
													<Check size={12} class="text-emerald-600 stroke-[2.5]" />
													<span class="text-emerald-600">Tersalin!</span>
												{:else}
													<Copy size={12} class="stroke-[2.2]" />
													<span>Salin</span>
												{/if}
											</button>
										{/if}
									</div>

									<!-- Skeleton Loading State -->
									{#if msg.isStreaming && !msg.content}
										<div class="space-y-2 py-2">
											<div class="flex items-center gap-2">
												<div class="flex items-center gap-1">
													<span class="h-2 w-2 animate-bounce rounded-full bg-slate-900"></span>
													<span class="h-2 w-2 animate-bounce rounded-full bg-slate-900 [animation-delay:0.15s]"></span>
													<span class="h-2 w-2 animate-bounce rounded-full bg-slate-900 [animation-delay:0.3s]"></span>
												</div>
												<span class="text-xs font-bold text-slate-700">
													{msg.webSearch
														? 'Menghubungkan ke web pencarian & menganalisis tren...'
														: 'Menghitung kalkulasi SQL & merumuskan strategi bisnis...'}
												</span>
											</div>
											<div class="h-3 w-4/5 animate-pulse rounded bg-slate-100"></div>
											<div class="h-3 w-3/5 animate-pulse rounded bg-slate-100"></div>
										</div>
									{:else}
										<!-- Konten Analisis Markdown -->
										<div class="prose prose-sm max-w-none text-slate-800">
											{@html renderMarkdown(msg.content)}
										</div>
										{#if msg.isStreaming}
											<span class="inline-block h-4 w-1.5 animate-pulse rounded-full bg-rose-500 align-middle"></span>
										{/if}
									{/if}

									<div class="mt-3.5 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
										Data terisolasi cabang {selectedBranch.value || 'aktif'}. Kalkulasi keuangan dihitung otomatis oleh SQL D1.
									</div>
								</div>
							</div>
						{/if}
					{/each}

					<!-- Saran Pertanyaan Lanjutan Ringkas -->
					{#if !isStreaming}
						<div class="mt-2 space-y-1.5 pt-1">
							<span class="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Lanjutkan Analisis:</span>
							<div class="flex flex-wrap gap-1.5">
								{#each quickFollowUps as item}
									<button
										type="button"
										onclick={() => handleAiAsk(item.query)}
										class="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-700 shadow-2xs transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-95"
									>
										{item.label}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Input Bar Bawah -->
			<div class="border-t border-slate-200/80 bg-white p-3 sm:p-4">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleAiAsk(aiQuestion);
					}}
					class="flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-1.5 focus-within:border-slate-800 focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-900/5 transition-all"
				>
					<input
						type="text"
						placeholder="Ketik pertanyaan bisnis, kalkulasi margin, atau riset web..."
						bind:value={aiQuestion}
						disabled={isStreaming}
						class="flex-1 bg-transparent px-3 py-1.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60 sm:text-sm"
					/>
					{#if isStreaming}
						<button
							type="button"
							onclick={handleStopStreaming}
							class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-rose-600 text-white shadow-xs transition-all hover:bg-rose-700 active:scale-95"
							title="Hentikan respons"
							aria-label="Hentikan respons"
						>
							<Square size={13} class="fill-current" />
						</button>
					{:else}
						<button
							type="submit"
							disabled={!aiQuestion.trim() || isAiLoading}
							class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs transition-all hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
							aria-label="Kirim pertanyaan"
						>
							<Send size={15} class="stroke-[2.4]" />
						</button>
					{/if}
				</form>
				<div class="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-400">
					<span>Kueri D1 SQL &bull; MiniMax M3 &bull; Web Browsing</span>
					<span>ESC untuk tutup</span>
				</div>
			</div>
		</div>
	</div>
{/if}
