<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { loginWithUsername } from '$lib/auth/auth';
	import { validateText, validatePasswordDemo, sanitizeInput } from '$lib/utils/validation';
	import { securityUtils } from '$lib/utils/security';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import type { BranchType } from '$lib/stores/selectedBranch.svelte';
	import { isAuthenticated } from '$lib/utils/authGuard';

	import User from '@lucide/svelte/icons/user';
	import Lock from '@lucide/svelte/icons/lock';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Store from '@lucide/svelte/icons/store';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';

	let username = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let isLoading = $state(false);
	let hydrated = $state(false);
	let errorMessage = $state('');

	// [CATATAN]: Form validation
	let usernameError = $state('');
	let passwordError = $state('');

	let branch: BranchType = $state('samarinda');
	$effect(() => {
		selectedBranch.value = branch as BranchType;
	});

	// [CATATAN]: Validate form
	function validateForm(): boolean {
		let isValid = true;
		const usernameValidation = validateText(username, {
			required: true,
			minLength: 3,
			maxLength: 50
		});
		usernameError = usernameValidation.errors.join(', ');
		if (!usernameValidation.isValid) isValid = false;
		const passwordValidation = validatePasswordDemo(password);
		passwordError = passwordValidation.errors.join(', ');
		if (!passwordValidation.isValid) isValid = false;
		return isValid;
	}

	let showSuccessModal = $state(false);
	let showErrorModal = $state(false);
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	async function handleSubmit() {
		errorMessage = '';
		if (!validateForm()) return;
		if (!securityUtils.checkFormRateLimit('login')) {
			errorMessage = 'Terlalu banyak percobaan login. Silakan coba lagi dalam 1 menit.';
			showErrorModal = true;
			if (errorTimeout) clearTimeout(errorTimeout);
			errorTimeout = setTimeout(() => (showErrorModal = false), 1200);
			return;
		}
		const sanitizedUsername = sanitizeInput(username);
		const sanitizedPassword = sanitizeInput(password);
		if (securityUtils.detectSuspiciousActivity('login', sanitizedUsername + sanitizedPassword)) {
			errorMessage = 'Aktivitas mencurigakan terdeteksi. Silakan coba lagi.';
			securityUtils.logSecurityEvent('login_attempt_blocked', {
				username: sanitizedUsername,
				reason: 'suspicious_activity'
			});
			showErrorModal = true;
			if (errorTimeout) clearTimeout(errorTimeout);
			errorTimeout = setTimeout(() => (showErrorModal = false), 1200);
			return;
		}
		isLoading = true;
		try {
			await loginWithUsername(sanitizedUsername, sanitizedPassword, branch);
			showSuccessModal = true;
			await new Promise((resolve) => setTimeout(resolve, 1000));
			goto('/');
		} catch (e: unknown) {
			errorMessage = e instanceof Error ? e.message : 'Login gagal';
			securityUtils.logSecurityEvent('login_failed', {
				username: sanitizedUsername,
				reason: 'invalid_credentials'
			});
			showErrorModal = true;
			if (errorTimeout) clearTimeout(errorTimeout);
			errorTimeout = setTimeout(() => (showErrorModal = false), 1200);
		} finally {
			isLoading = false;
		}
	}

	function handleUsernameChange() {
		usernameError = '';
	}
	function handlePasswordChange() {
		passwordError = '';
	}
	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter' && !isLoading) handleSubmit();
	}

	onMount(async () => {
		hydrated = true;
		const params = new URLSearchParams(window.location.search);
		const reason = params.get('reason');
		const reasonMessages: Record<string, string> = {
			rate_limit: 'Terlalu banyak permintaan. Silakan tunggu sebentar lalu coba lagi.',
			session_expired: 'Sesi login Anda berakhir. Silakan login kembali.',
			unauthorized: 'Silakan login untuk melanjutkan.',
			csrf_invalid: 'Sesi keamanan berakhir. Silakan coba login kembali.'
		};

		if (reason && reasonMessages[reason]) {
			errorMessage = reasonMessages[reason];
		}

		// [CATATAN]: Jika sudah login, redirect ke dashboard
		if (await isAuthenticated()) {
			goto('/');
			return;
		}
	});
</script>

<div
	class="page-content relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-gradient-to-br from-pink-200 via-pink-100 to-pink-300 p-4 sm:p-6"
>
	<!-- Ambient Background Glow Orbs -->
	<div
		class="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full bg-pink-400/30 blur-3xl"
	></div>
	<div
		class="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-rose-400/25 blur-3xl"
	></div>

	<!-- Login Card Container -->
	<div
		class="relative w-full max-w-sm rounded-3xl border border-white/80 bg-white/95 p-7 shadow-2xl shadow-pink-500/15 backdrop-blur-xl sm:p-8"
	>
		<!-- Logo & Brand Header -->
		<div class="mb-7 text-center">
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-pink-100 bg-white p-2.5 shadow-lg ring-4 shadow-pink-500/20 ring-pink-50"
			>
				<img src="/img/logo.svg" alt="Logo ZatiarasPOS" class="h-10 w-10 object-contain" />
			</div>
			<h1 class="text-2xl font-black tracking-tight text-slate-900">Zatiaras POS</h1>
			<p class="mt-1 text-xs font-semibold text-slate-500">Masuk untuk memulai sesi kasir</p>
		</div>

		<!-- Error Banner -->
		{#if errorMessage}
			<div
				class="mb-5 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-3.5 text-xs font-bold text-rose-700"
			>
				<AlertCircle class="h-4.5 w-4.5 shrink-0 text-rose-600" />
				<span class="flex-1">{errorMessage}</span>
			</div>
		{/if}

		<!-- Success Notification Overlay -->
		{#if showSuccessModal}
			<div
				class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-xs"
			>
				<div
					class="flex flex-col items-center rounded-3xl border border-pink-100 bg-white px-8 py-6 shadow-2xl"
				>
					<div
						class="flex h-14 w-14 items-center justify-center rounded-full bg-pink-50 text-pink-600"
					>
						<CheckCircle2 class="h-9 w-9 stroke-[2.5]" />
					</div>
					<div class="mt-3 text-lg font-black text-slate-900">Login Berhasil!</div>
					<div class="text-xs font-medium text-slate-400">Membuka aplikasi...</div>
				</div>
			</div>
		{/if}

		<!-- Error Notification Overlay -->
		{#if showErrorModal}
			<div
				class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-xs"
			>
				<div
					class="flex flex-col items-center rounded-3xl border border-rose-100 bg-white px-8 py-6 shadow-2xl"
				>
					<div
						class="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600"
					>
						<AlertCircle class="h-9 w-9 stroke-[2.5]" />
					</div>
					<div class="mt-3 text-lg font-black text-rose-600">Login Gagal</div>
					<div class="text-xs font-medium text-slate-400">
						{errorMessage || 'Periksa username dan password'}
					</div>
				</div>
			</div>
		{/if}

		<form
			data-hydrated={hydrated}
			onsubmit={(e) => {
				e.preventDefault();
				handleSubmit();
			}}
			class="space-y-4"
		>
			<!-- Username Field -->
			<div>
				<label
					for="username"
					class="mb-1.5 block text-xs font-bold tracking-wider text-slate-600 uppercase"
				>
					Username
				</label>
				<div class="relative">
					<span class="absolute inset-y-0 left-0 flex items-center pl-3.5 text-pink-400">
						<User class="h-4.5 w-4.5" />
					</span>
					<input
						id="username"
						type="text"
						bind:value={username}
						oninput={handleUsernameChange}
						onkeypress={handleKeyPress}
						class="block w-full rounded-2xl border border-pink-100 bg-white py-3 pr-4 pl-10 text-sm font-semibold text-slate-900 shadow-xs transition-all outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15"
						placeholder="Masukkan username"
						autocomplete="username"
						required
					/>
				</div>
				{#if usernameError}
					<div class="mt-1 text-xs font-bold text-rose-500">{usernameError}</div>
				{/if}
			</div>

			<!-- Password Field with Visibility Toggle -->
			<div>
				<label
					for="password"
					class="mb-1.5 block text-xs font-bold tracking-wider text-slate-600 uppercase"
				>
					Password
				</label>
				<div class="relative">
					<span class="absolute inset-y-0 left-0 flex items-center pl-3.5 text-pink-400">
						<Lock class="h-4.5 w-4.5" />
					</span>
					<input
						id="password"
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						oninput={handlePasswordChange}
						onkeypress={handleKeyPress}
						class="block w-full rounded-2xl border border-pink-100 bg-white py-3 pr-11 pl-10 text-sm font-semibold text-slate-900 shadow-xs transition-all outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15"
						placeholder="Masukkan password"
						autocomplete="current-password"
						required
					/>
					<button
						type="button"
						class="absolute inset-y-0 right-0 flex cursor-pointer items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
					>
						{#if showPassword}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
				{#if passwordError}
					<div class="mt-1 text-xs font-bold text-rose-500">{passwordError}</div>
				{/if}
			</div>

			<!-- Branch Selector with Sleek Dropdown Icon -->
			<div>
				<label
					for="branch"
					class="mb-1.5 block text-xs font-bold tracking-wider text-slate-600 uppercase"
				>
					Cabang
				</label>
				<div class="relative">
					<span class="absolute inset-y-0 left-0 flex items-center pl-3.5 text-pink-400">
						<Store class="h-4.5 w-4.5" />
					</span>
					<select
						id="branch"
						class="block w-full cursor-pointer appearance-none rounded-2xl border border-pink-100 bg-white py-3 pr-10 pl-10 text-sm font-semibold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15"
						bind:value={branch}
						aria-label="Pilih Cabang"
					>
						<option value="samarinda">Samarinda</option>
						<option value="berau">Berau</option>
						<option value="balikpapan">Balikpapan</option>
						<option value="samarinda2">Samarinda 2</option>
						<option value="balikpapan2">Balikpapan 2</option>
					</select>
					<span
						class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400"
					>
						<ChevronDown class="h-4 w-4" />
					</span>
				</div>
			</div>

			<!-- Submit Button -->
			<button
				type="submit"
				class="mt-2 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-pink-600 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:from-pink-600 hover:to-pink-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!hydrated || isLoading}
			>
				{#if isLoading}
					<svg
						class="h-5 w-5 animate-spin"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
					>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
						></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
					</svg>
					<span>Memproses...</span>
				{:else}
					<span>Masuk</span>
				{/if}
			</button>
		</form>

		<div class="mt-6 text-center text-xs font-semibold text-slate-400">
			Zatiaras POS &copy; 2026
		</div>
	</div>
</div>
