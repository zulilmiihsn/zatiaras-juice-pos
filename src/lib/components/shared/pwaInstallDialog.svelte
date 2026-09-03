<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	let {
		show = false,
		onClose = () => {}
	}: {
		show?: boolean;
		onClose?: () => void;
	} = $props();

	type Platform = 'ios' | 'android' | 'chrome-desktop' | 'edge' | 'firefox' | 'other';
	let platform = $state<Platform>('other');
	let isAlreadyInstalled = $state(false);
	let deferredPrompt: any = $state(null);
	let installing = $state(false);
	let installSuccess = $state(false);

	onMount(() => {
		if (!browser) return;

		const ua = window.navigator.userAgent.toLowerCase();
		const isIOS = /iphone|ipad|ipod/.test(ua);
		const isAndroid = /android/.test(ua);
		const isEdge = /edg\//.test(ua);
		const isFirefox = /firefox/.test(ua);
		const isChrome = /chrome/.test(ua) && !isEdge;
		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			('standalone' in window.navigator &&
				Boolean((window.navigator as unknown as { standalone?: boolean }).standalone));

		if (isStandalone) {
			isAlreadyInstalled = true;
		} else if (isIOS) {
			platform = 'ios';
		} else if (isAndroid && isChrome) {
			platform = 'android';
		} else if (isEdge) {
			platform = 'edge';
		} else if (isFirefox) {
			platform = 'firefox';
		} else if (isChrome) {
			platform = 'chrome-desktop';
		}

		window.addEventListener('beforeinstallprompt', (e: any) => {
			e.preventDefault();
			deferredPrompt = e;
		});
	});

	async function handleInstall() {
		if (deferredPrompt) {
			installing = true;
			try {
				deferredPrompt.prompt();
				const { outcome } = await deferredPrompt.userChoice;
				if (outcome === 'accepted') {
					installSuccess = true;
					deferredPrompt = null;
					setTimeout(() => {
						show = false;
						onClose();
					}, 2000);
				}
			} catch (e) {
				console.error(e);
			} finally {
				installing = false;
			}
		}
	}

	const iosSteps = [
		{
			icon: '⬆️',
			bg: 'bg-blue-100',
			text: 'Ketuk ikon',
			highlight: 'Share',
			suffix: 'di toolbar bawah Safari'
		},
		{
			icon: '📋',
			bg: 'bg-green-100',
			text: 'Scroll dan pilih',
			highlight: '"Add to Home Screen"',
			suffix: ''
		},
		{
			icon: '✅',
			bg: 'bg-pink-100',
			text: 'Ketuk',
			highlight: '"Add"',
			suffix: 'di pojok kanan atas'
		}
	];

	const androidSteps = [
		{
			icon: '⋮',
			bg: 'bg-blue-100',
			text: 'Ketuk ikon',
			highlight: 'menu (⋮)',
			suffix: 'di pojok kanan atas'
		},
		{
			icon: '📲',
			bg: 'bg-green-100',
			text: 'Pilih',
			highlight: '"Add to Home Screen"',
			suffix: 'atau "Install App"'
		},
		{ icon: '✅', bg: 'bg-pink-100', text: 'Ketuk', highlight: '"Add"', suffix: 'untuk konfirmasi' }
	];

	const edgeSteps = [
		{
			icon: '···',
			bg: 'bg-blue-100',
			text: 'Ketuk menu',
			highlight: '(···)',
			suffix: 'di pojok kanan atas'
		},
		{
			icon: '📱',
			bg: 'bg-green-100',
			text: 'Pilih',
			highlight: '"Apps"',
			suffix: '→ "Install this site"'
		},
		{
			icon: '✅',
			bg: 'bg-pink-100',
			text: 'Klik',
			highlight: '"Install"',
			suffix: 'untuk mengkonfirmasi'
		}
	];

	const firefoxSteps = [
		{
			icon: '🏠',
			bg: 'bg-orange-100',
			text: 'Cari ikon',
			highlight: 'rumah (+)',
			suffix: 'di address bar'
		},
		{
			icon: '📲',
			bg: 'bg-green-100',
			text: 'Atau ketuk menu',
			highlight: '(⋮)',
			suffix: '→ "Add to Home Screen"'
		},
		{
			icon: '✅',
			bg: 'bg-pink-100',
			text: 'Konfirmasi',
			highlight: 'instalasi',
			suffix: 'di dialog yang muncul'
		}
	];

	let steps = $derived(
		platform === 'ios'
			? iosSteps
			: platform === 'android'
				? androidSteps
				: platform === 'edge'
					? edgeSteps
					: platform === 'firefox'
						? firefoxSteps
						: null
	);
	let platformLabel = $derived(
		platform === 'ios'
			? 'Safari / iOS'
			: platform === 'android'
				? 'Chrome / Android'
				: platform === 'edge'
					? 'Microsoft Edge'
					: platform === 'firefox'
						? 'Firefox'
						: platform === 'chrome-desktop'
							? 'Chrome Desktop'
							: 'Browser'
	);
</script>

{#if show}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
		transition:fade={{ duration: 200 }}
	>
		<button
			class="absolute inset-0 bg-black/50 backdrop-blur-sm"
			onclick={onClose}
			aria-label="Tutup"
		></button>

		<!-- Dialog -->
		<div
			class="relative z-10 w-full max-w-sm rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
			transition:fly={{ y: 100, duration: 350, easing: cubicOut }}
		>
			<!-- Handle bar (mobile) -->
			<div class="flex justify-center pt-3 pb-1 sm:hidden">
				<div class="h-1 w-10 rounded-full bg-gray-300"></div>
			</div>

			<!-- Header -->
			<div class="flex items-center gap-4 px-6 pt-5 pb-4">
				<!-- App Icon -->
				<div
					class="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink-400 to-pink-600 shadow-lg"
				>
					<img
						src="/img/icon-192.png"
						alt="App Icon"
						class="h-full w-full object-cover"
						onerror={(e) => {
							(e.currentTarget as HTMLElement).style.display = 'none';
							const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement;
							if (next) next.style.display = 'flex';
						}}
					/>
					<div class="hidden h-full w-full items-center justify-center text-3xl text-white">🧋</div>
				</div>
				<div class="flex-1">
					<div class="text-lg font-bold text-gray-900">ZatiarasPOS</div>
					<div class="text-sm text-gray-500">Pasang ke perangkat Anda</div>
					{#if platformLabel}
						<span
							class="mt-1 inline-block rounded-full bg-pink-100 px-2 py-0.5 text-xs font-semibold text-pink-600"
							>{platformLabel}</span
						>
					{/if}
				</div>
				<button
					onclick={onClose}
					class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
					aria-label="Tutup"
				>
					✕
				</button>
			</div>

			<!-- Divider -->
			<div class="mx-6 border-t border-gray-100"></div>

			<!-- Content -->
			<div class="px-6 py-4">
				{#if installSuccess}
					<!-- Success state -->
					<div class="flex flex-col items-center py-4 text-center">
						<div
							class="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-4xl"
						>
							✅
						</div>
						<div class="text-lg font-bold text-green-600">Berhasil Dipasang!</div>
						<div class="mt-1 text-sm text-gray-500">Aplikasi sudah tersedia di Home Screen</div>
					</div>
				{:else if isAlreadyInstalled}
					<!-- Already installed -->
					<div class="flex flex-col items-center py-4 text-center">
						<div
							class="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-4xl"
						>
							📱
						</div>
						<div class="text-lg font-bold text-blue-600">Sudah Terpasang!</div>
						<div class="mt-1 text-sm text-gray-500">
							Aplikasi sudah ada di Home Screen perangkat Anda
						</div>
					</div>
				{:else if deferredPrompt !== null || platform === 'chrome-desktop'}
					<!-- Native install available -->
					<div class="py-2 text-center">
						<div class="mb-3 text-4xl">🚀</div>
						<div class="mb-1 font-semibold text-gray-800">Siap dipasang!</div>
						<div class="mb-4 text-sm text-gray-500">
							Pasang ZatiarasPOS ke perangkat Anda untuk akses lebih cepat tanpa buka browser
						</div>

						<div class="mb-4 flex justify-center gap-6 text-center text-xs text-gray-500">
							<div class="flex flex-col items-center gap-1">
								<span class="text-2xl">⚡</span>
								<span>Lebih cepat</span>
							</div>
							<div class="flex flex-col items-center gap-1">
								<span class="text-2xl">📴</span>
								<span>Offline ready</span>
							</div>
							<div class="flex flex-col items-center gap-1">
								<span class="text-2xl">🏠</span>
								<span>Home screen</span>
							</div>
						</div>
					</div>
				{:else if steps}
					<!-- Step-by-step guide -->
					<div class="mb-3 text-sm font-medium text-gray-600">Ikuti langkah berikut:</div>
					<div class="space-y-3">
						{#each steps as step, i}
							<div class="flex items-start gap-3">
								<div
									class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full {step.bg} text-sm font-bold text-gray-700"
								>
									{i + 1}
								</div>
								<div class="flex-1 pt-1 text-sm text-gray-700">
									{step.text}
									<span class="font-semibold text-pink-600">{step.highlight}</span>
									{#if step.suffix}
										{step.suffix}
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<!-- Generic fallback -->
					<div class="py-2 text-center text-sm text-gray-600">
						<div class="mb-3 text-4xl">💡</div>
						Buka halaman ini di<strong>Chrome</strong> atau <strong>Safari</strong> untuk bisa memasang
						aplikasi ke Home Screen
					</div>
				{/if}
			</div>

			<!-- Footer buttons -->
			<div class="px-6 pt-2 pb-6">
				{#if isAlreadyInstalled || installSuccess}
					<button
						class="w-full rounded-2xl bg-gray-100 py-3 font-semibold text-gray-700"
						onclick={onClose}
					>
						Tutup
					</button>
				{:else if deferredPrompt !== null}
					<button
						class="w-full rounded-2xl bg-gradient-to-r from-pink-500 to-pink-600 py-3 font-bold text-white shadow-md disabled:opacity-60"
						onclick={handleInstall}
						disabled={installing}
					>
						{installing ? 'Memasang...' : '📲 Pasang Sekarang'}
					</button>
					<button
						class="mt-2 w-full rounded-2xl py-3 text-sm font-medium text-gray-400"
						onclick={onClose}
					>
						Nanti saja
					</button>
				{:else}
					<button
						class="w-full rounded-2xl bg-gradient-to-r from-pink-500 to-pink-600 py-3 font-bold text-white shadow-md"
						onclick={onClose}
					>
						Mengerti
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
