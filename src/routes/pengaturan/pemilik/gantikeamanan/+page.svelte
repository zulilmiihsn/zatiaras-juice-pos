<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import { userRole, userProfile } from '$lib/stores/userRole.svelte';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import User from '@lucide/svelte/icons/user';
	import Lock from '@lucide/svelte/icons/lock';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Check from '@lucide/svelte/icons/check';
	import Home from '@lucide/svelte/icons/home';
	import Receipt from '@lucide/svelte/icons/receipt';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
	import { transactionService } from '$lib/services/transactionService';

	// [CATATAN]: ─── Active Tab & Mode ─────────────────────────────────────────────────
	let activeSecurityTab = $state<'pemilik' | 'kasir'>('pemilik');
	let pemilikChangeMode = $state<'all' | 'username' | 'password'>('all');
	let kasirChangeMode = $state<'all' | 'username' | 'password'>('all');

	// [CATATAN]: ─── State Kredensial Pemilik ──────────────────────────────────────────
	let oldUsername = $state('');
	let newUsername = $state('');
	let oldPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let userPassError = $state('');
	let isSavingPemilik = $state(false);

	// Visibility toggles Pemilik
	let showOldPassword = $state(false);
	let showNewPassword = $state(false);
	let showConfirmPassword = $state(false);

	// [CATATAN]: ─── State Kredensial Kasir ────────────────────────────────────────────
	let kasirOldUsername = $state('kasir');
	let kasirNewUsername = $state('');
	let kasirOldPassword = $state('');
	let kasirNewPassword = $state('');
	let kasirConfirmPassword = $state('');
	let kasirUserPassError = $state('');
	let isSavingKasir = $state(false);

	// Visibility toggles Kasir
	let showKasirOldPassword = $state(false);
	let showKasirNewPassword = $state(false);
	let showKasirConfirmPassword = $state(false);

	// [CATATAN]: ─── State PIN & Proteksi Halaman ──────────────────────────────────────
	let oldPin = $state('');
	let newPin = $state('');
	let confirmPin = $state('');
	let lockedPages = $state<string[]>([]);
	let pinError = $state('');
	let pinConfigured = $state(false);
	let pengaturanKeamananId = $state('');
	let isSavingPin = $state(false);
	let isSavingPages = $state(false);

	// PIN visibility toggles
	let showOldPin = $state(false);
	let showNewPin = $state(false);
	let showConfirmPin = $state(false);

	const toastManager = createToastManager();

	onMount(async () => {
		if (userRole.value !== 'pemilik') {
			goto('/unauthorized');
			return;
		}

		if (userProfile.value && typeof userProfile.value === 'object') {
			const p = userProfile.value as { username?: string };
			if (p.username) {
				oldUsername = p.username;
			}
		}

		const data = (await transactionService.getOne('pengaturan')) as {
			pinConfigured?: boolean;
			halaman_terkunci?: string[];
			id?: string;
		} | null;
		if (data) {
			pinConfigured = data.pinConfigured === true;
			lockedPages = data.halaman_terkunci || [];
			pengaturanKeamananId = data.id ?? '';
		}
	});

	async function handleChangeUserPass(e: Event) {
		e.preventDefault();
		userPassError = '';

		if (!oldUsername.trim()) {
			userPassError = 'Username saat ini wajib diisi.';
			return;
		}
		if (!oldPassword.trim()) {
			userPassError = 'Password saat ini wajib diisi untuk verifikasi.';
			return;
		}

		const wantsUsername = pemilikChangeMode === 'all' || pemilikChangeMode === 'username';
		const wantsPassword = pemilikChangeMode === 'all' || pemilikChangeMode === 'password';

		if (wantsUsername && !newUsername.trim()) {
			userPassError = 'Username baru wajib diisi.';
			return;
		}
		if (wantsUsername && oldUsername.trim() === newUsername.trim()) {
			userPassError = 'Username baru tidak boleh sama dengan username saat ini.';
			return;
		}

		if (wantsPassword) {
			if (!newPassword.trim() || !confirmPassword.trim()) {
				userPassError = 'Password baru dan konfirmasi password wajib diisi.';
				return;
			}
			if (newPassword !== confirmPassword) {
				userPassError = 'Konfirmasi password baru tidak cocok.';
				return;
			}
		}

		isSavingPemilik = true;
		try {
			const branch = selectedBranch.value;
			const res = await fetchWithCsrfRetry('/api/gantikeamanan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					usernameLama: oldUsername.trim(),
					usernameBaru: wantsUsername ? newUsername.trim() : undefined,
					passwordLama: oldPassword,
					passwordBaru: wantsPassword ? newPassword : undefined,
					branch,
					targetRole: 'pemilik'
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				reportApiFailure(data, res.status, '/api/gantikeamanan');
				userPassError = getApiErrorMessage(data, res.status, 'Gagal update kredensial pemilik.');
				return;
			}
			userPassError = '';
			toastManager.showToastNotification(
				data.message || 'Kredensial Pemilik berhasil diperbarui!',
				'success'
			);
			if (wantsUsername) {
				oldUsername = newUsername.trim();
				newUsername = '';
			}
			oldPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch {
			userPassError = 'Terjadi error pada server.';
		} finally {
			isSavingPemilik = false;
		}
	}

	async function handleChangeUserPassKasir(e: Event) {
		e.preventDefault();
		kasirUserPassError = '';

		if (!kasirOldUsername.trim()) {
			kasirUserPassError = 'Username kasir saat ini wajib diisi.';
			return;
		}
		if (!kasirOldPassword.trim()) {
			kasirUserPassError = 'Password kasir saat ini wajib diisi untuk verifikasi.';
			return;
		}

		const wantsUsername = kasirChangeMode === 'all' || kasirChangeMode === 'username';
		const wantsPassword = kasirChangeMode === 'all' || kasirChangeMode === 'password';

		if (wantsUsername && !kasirNewUsername.trim()) {
			kasirUserPassError = 'Username baru kasir wajib diisi.';
			return;
		}
		if (wantsUsername && kasirOldUsername.trim() === kasirNewUsername.trim()) {
			kasirUserPassError = 'Username baru tidak boleh sama dengan username saat ini.';
			return;
		}

		if (wantsPassword) {
			if (!kasirNewPassword.trim() || !kasirConfirmPassword.trim()) {
				kasirUserPassError = 'Password baru dan konfirmasi password wajib diisi.';
				return;
			}
			if (kasirNewPassword !== kasirConfirmPassword) {
				kasirUserPassError = 'Konfirmasi password baru tidak cocok.';
				return;
			}
		}

		isSavingKasir = true;
		try {
			const branch = selectedBranch.value;
			const res = await fetchWithCsrfRetry('/api/gantikeamanan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					usernameLama: kasirOldUsername.trim(),
					usernameBaru: wantsUsername ? kasirNewUsername.trim() : undefined,
					passwordLama: kasirOldPassword,
					passwordBaru: wantsPassword ? kasirNewPassword : undefined,
					branch,
					targetRole: 'kasir'
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) {
				reportApiFailure(data, res.status, '/api/gantikeamanan');
				kasirUserPassError = getApiErrorMessage(data, res.status, 'Gagal update kredensial kasir.');
				return;
			}
			kasirUserPassError = '';
			toastManager.showToastNotification(
				data.message || 'Kredensial Kasir berhasil diperbarui!',
				'success'
			);
			if (wantsUsername) {
				kasirOldUsername = kasirNewUsername.trim();
				kasirNewUsername = '';
			}
			kasirOldPassword = '';
			kasirNewPassword = '';
			kasirConfirmPassword = '';
		} catch {
			kasirUserPassError = 'Terjadi error pada server.';
		} finally {
			isSavingKasir = false;
		}
	}

	async function savePinSettings(event: Event) {
		event.preventDefault();
		pinError = '';
		if ((pinConfigured && !oldPin.trim()) || !newPin.trim() || !confirmPin.trim()) {
			pinError = 'Semua field wajib diisi.';
			return;
		}
		if (newPin !== confirmPin) {
			pinError = 'Konfirmasi PIN tidak cocok.';
			return;
		}
		if (newPin.length < 4 || newPin.length > 6 || !/^[0-9]+$/.test(newPin)) {
			pinError = 'PIN harus 4-6 digit angka.';
			return;
		}

		isSavingPin = true;
		try {
			const response = await fetchWithCsrfRetry('/api/pin', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPin: oldPin, newPin })
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || payload?.ok !== true) {
				reportApiFailure(payload, response.status, '/api/pin');
				pinError = getApiErrorMessage(payload, response.status, 'Gagal menyimpan PIN.');
				return;
			}
			toastManager.showToastNotification('PIN Keamanan berhasil disimpan!', 'success');
			oldPin = '';
			newPin = '';
			confirmPin = '';
			pinError = '';
			pinConfigured = true;
		} catch (error) {
			console.error('[gantikeamanan] update PIN gagal:', error);
			pinError = 'Gagal menyimpan perubahan. Coba lagi.';
		} finally {
			isSavingPin = false;
		}
	}

	function togglePageLock(pageKey: string) {
		if (lockedPages.includes(pageKey)) {
			lockedPages = lockedPages.filter((p) => p !== pageKey);
		} else {
			lockedPages = [...lockedPages, pageKey];
		}
	}

	async function saveLockedPages() {
		isSavingPages = true;
		try {
			await transactionService.updateRows(
				'pengaturan',
				{ halaman_terkunci: lockedPages },
				{ id: pengaturanKeamananId }
			);
			toastManager.showToastNotification(
				'Pengaturan halaman terkunci berhasil disimpan!',
				'success'
			);
		} catch (error) {
			toastManager.showToastNotification(
				'Gagal menyimpan pengaturan: ' + (error instanceof Error ? error.message : String(error)),
				'error'
			);
		} finally {
			isSavingPages = false;
		}
	}
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<button
				onclick={() => goto('/pengaturan/pemilik')}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali ke Pengaturan Pemilik"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</button>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Keamanan & Hak Akses
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col px-4 md:px-6">
		<div class="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-start md:gap-5">
			<!-- ========================================== -->
			<!-- COLUMN 1: Kredensial Login (Pemilik / Kasir) -->
			<!-- ========================================== -->
			<div class="flex flex-col gap-4 md:col-span-6 lg:col-span-7">
				<div class="soft-float-card p-5 md:p-6">
					<!-- Header Kartu Kredensial -->
					<div class="mb-4 flex items-center justify-between border-b border-pink-100/80 pb-3.5">
						<div class="flex items-center gap-3">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
							>
								<User class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
							</div>
							<div>
								<h2 class="text-sm font-black text-slate-900 md:text-base">Kredensial Akun</h2>
								<p class="text-xs text-slate-500 md:text-sm">Ubah username atau password login</p>
							</div>
						</div>
					</div>

					<!-- Pill Role Switcher (Pemilik vs Kasir) -->
					<div class="mb-4 flex rounded-2xl border border-pink-100 bg-pink-50/50 p-1.5 shadow-2xs">
						<button
							type="button"
							class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200 md:text-sm {activeSecurityTab ===
							'pemilik'
								? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
								: 'text-slate-600 hover:text-pink-600'}"
							onclick={() => {
								activeSecurityTab = 'pemilik';
								userPassError = '';
							}}
						>
							<User class="h-4 w-4" />
							<span>Akun Pemilik</span>
						</button>
						<button
							type="button"
							class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200 md:text-sm {activeSecurityTab ===
							'kasir'
								? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
								: 'text-slate-600 hover:text-pink-600'}"
							onclick={() => {
								activeSecurityTab = 'kasir';
								kasirUserPassError = '';
							}}
						>
							<Shield class="h-4 w-4" />
							<span>Akun Kasir</span>
						</button>
					</div>

					<!-- Sub-pilihan Ubah: Semua / Username Saja / Password Saja -->
					<div
						class="mb-5 flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50 p-1"
					>
						<button
							type="button"
							onclick={() => {
								if (activeSecurityTab === 'pemilik') pemilikChangeMode = 'all';
								else kasirChangeMode = 'all';
							}}
							class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(activeSecurityTab ===
							'pemilik'
								? pemilikChangeMode
								: kasirChangeMode) === 'all'
								? 'bg-white font-extrabold text-pink-600 shadow-2xs'
								: 'text-slate-500 hover:text-slate-800'}"
						>
							Keduanya
						</button>
						<button
							type="button"
							onclick={() => {
								if (activeSecurityTab === 'pemilik') pemilikChangeMode = 'username';
								else kasirChangeMode = 'username';
							}}
							class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(activeSecurityTab ===
							'pemilik'
								? pemilikChangeMode
								: kasirChangeMode) === 'username'
								? 'bg-white font-extrabold text-pink-600 shadow-2xs'
								: 'text-slate-500 hover:text-slate-800'}"
						>
							Username Saja
						</button>
						<button
							type="button"
							onclick={() => {
								if (activeSecurityTab === 'pemilik') pemilikChangeMode = 'password';
								else kasirChangeMode = 'password';
							}}
							class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(activeSecurityTab ===
							'pemilik'
								? pemilikChangeMode
								: kasirChangeMode) === 'password'
								? 'bg-white font-extrabold text-pink-600 shadow-2xs'
								: 'text-slate-500 hover:text-slate-800'}"
						>
							Password Saja
						</button>
					</div>

					<!-- ========================================== -->
					<!-- FORM PEMILIK                               -->
					<!-- ========================================== -->
					{#if activeSecurityTab === 'pemilik'}
						<form onsubmit={handleChangeUserPass} autocomplete="off" class="space-y-3.5">
							<div
								class="flex items-center gap-2 rounded-xl border border-pink-100/60 bg-pink-50/60 px-3.5 py-2 text-xs font-semibold text-pink-700"
							>
								<ShieldCheck class="h-4 w-4 shrink-0 text-pink-600" />
								<span>
									{#if pemilikChangeMode === 'username'}
										Ubah username akun Pemilik. Verifikasi dengan password saat ini.
									{:else if pemilikChangeMode === 'password'}
										Ubah password akun Pemilik. Verifikasi dengan password saat ini.
									{:else}
										Ubah username dan password akun Pemilik secara bersamaan.
									{/if}
								</span>
							</div>

							<!-- 1. Username Saat Ini (Selalu tampil sebagai identitas) -->
							<div>
								<label
									for="old-username"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									Username Pemilik Saat Ini
								</label>
								<input
									id="old-username"
									type="text"
									class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
									placeholder="Username saat ini"
									bind:value={oldUsername}
									required
								/>
							</div>

							<!-- 2. Username Baru (Jika mode 'all' atau 'username') -->
							{#if pemilikChangeMode === 'all' || pemilikChangeMode === 'username'}
								<div>
									<label
										for="new-username"
										class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
									>
										Username Baru
									</label>
									<input
										id="new-username"
										type="text"
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="Masukkan username baru"
										bind:value={newUsername}
										required
									/>
								</div>
							{/if}

							<!-- 3. Password Saat Ini (Selalu wajib untuk verifikasi keamanan) -->
							<div>
								<label
									for="old-password"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									Password Saat Ini <span class="font-normal text-rose-500"
										>(Verifikasi Keamanan)</span
									>
								</label>
								<div class="relative">
									<input
										id="old-password"
										type={showOldPassword ? 'text' : 'password'}
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="Masukkan password saat ini"
										bind:value={oldPassword}
										required
									/>
									<button
										type="button"
										onclick={() => (showOldPassword = !showOldPassword)}
										class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
										aria-label={showOldPassword ? 'Sembunyikan password' : 'Lihat password'}
									>
										{#if showOldPassword}
											<EyeOff class="h-4.5 w-4.5" />
										{:else}
											<Eye class="h-4.5 w-4.5" />
										{/if}
									</button>
								</div>
							</div>

							<!-- 4. Password Baru + Konfirmasi (Jika mode 'all' atau 'password') -->
							{#if pemilikChangeMode === 'all' || pemilikChangeMode === 'password'}
								<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
									<div>
										<label
											for="new-password"
											class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
										>
											Password Baru
										</label>
										<div class="relative">
											<input
												id="new-password"
												type={showNewPassword ? 'text' : 'password'}
												class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
												placeholder="Minimal 8 karakter"
												bind:value={newPassword}
												required
											/>
											<button
												type="button"
												onclick={() => (showNewPassword = !showNewPassword)}
												class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
												aria-label={showNewPassword ? 'Sembunyikan password' : 'Lihat password'}
											>
												{#if showNewPassword}
													<EyeOff class="h-4.5 w-4.5" />
												{:else}
													<Eye class="h-4.5 w-4.5" />
												{/if}
											</button>
										</div>
									</div>

									<div>
										<label
											for="confirm-password"
											class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
										>
											Konfirmasi Password Baru
										</label>
										<div class="relative">
											<input
												id="confirm-password"
												type={showConfirmPassword ? 'text' : 'password'}
												class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
												placeholder="Ulangi password baru"
												bind:value={confirmPassword}
												required
											/>
											<button
												type="button"
												onclick={() => (showConfirmPassword = !showConfirmPassword)}
												class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
												aria-label={showConfirmPassword ? 'Sembunyikan password' : 'Lihat password'}
											>
												{#if showConfirmPassword}
													<EyeOff class="h-4.5 w-4.5" />
												{:else}
													<Eye class="h-4.5 w-4.5" />
												{/if}
											</button>
										</div>
									</div>
								</div>
							{/if}

							{#if userPassError}
								<div
									class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
								>
									<AlertCircle class="h-4 w-4 shrink-0" />
									<span>{userPassError}</span>
								</div>
							{/if}

							<button
								type="submit"
								disabled={isSavingPemilik}
								class="mt-2 w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
							>
								{isSavingPemilik
									? 'Menyimpan...'
									: pemilikChangeMode === 'username'
										? 'Simpan Username Baru'
										: pemilikChangeMode === 'password'
											? 'Simpan Password Baru'
											: 'Simpan Perubahan Kredensial'}
							</button>
						</form>
					{:else}
						<!-- ========================================== -->
						<!-- FORM KASIR                                 -->
						<!-- ========================================== -->
						<form onsubmit={handleChangeUserPassKasir} autocomplete="off" class="space-y-3.5">
							<div
								class="flex items-center gap-2 rounded-xl border border-pink-100/60 bg-pink-50/60 px-3.5 py-2 text-xs font-semibold text-pink-700"
							>
								<Shield class="h-4 w-4 shrink-0 text-pink-600" />
								<span>
									{#if kasirChangeMode === 'username'}
										Ubah username akun Kasir. Verifikasi dengan password kasir saat ini.
									{:else if kasirChangeMode === 'password'}
										Ubah password akun Kasir. Verifikasi dengan password kasir saat ini.
									{:else}
										Ubah username dan password akun Kasir secara bersamaan.
									{/if}
								</span>
							</div>

							<!-- 1. Username Kasir Saat Ini -->
							<div>
								<label
									for="kasir-old-username"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									Username Kasir Saat Ini
								</label>
								<input
									id="kasir-old-username"
									type="text"
									class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
									placeholder="Username kasir saat ini"
									bind:value={kasirOldUsername}
									required
								/>
							</div>

							<!-- 2. Username Baru Kasir (Jika mode 'all' atau 'username') -->
							{#if kasirChangeMode === 'all' || kasirChangeMode === 'username'}
								<div>
									<label
										for="kasir-new-username"
										class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
									>
										Username Baru Kasir
									</label>
									<input
										id="kasir-new-username"
										type="text"
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="Masukkan username baru kasir"
										bind:value={kasirNewUsername}
										required
									/>
								</div>
							{/if}

							<!-- 3. Password Kasir Saat Ini -->
							<div>
								<label
									for="kasir-old-password"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									Password Kasir Saat Ini <span class="font-normal text-rose-500"
										>(Verifikasi Keamanan)</span
									>
								</label>
								<div class="relative">
									<input
										id="kasir-old-password"
										type={showKasirOldPassword ? 'text' : 'password'}
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="Masukkan password kasir saat ini"
										bind:value={kasirOldPassword}
										required
									/>
									<button
										type="button"
										onclick={() => (showKasirOldPassword = !showKasirOldPassword)}
										class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
										aria-label={showKasirOldPassword ? 'Sembunyikan password' : 'Lihat password'}
									>
										{#if showKasirOldPassword}
											<EyeOff class="h-4.5 w-4.5" />
										{:else}
											<Eye class="h-4.5 w-4.5" />
										{/if}
									</button>
								</div>
							</div>

							<!-- 4. Password Baru Kasir + Konfirmasi (Jika mode 'all' atau 'password') -->
							{#if kasirChangeMode === 'all' || kasirChangeMode === 'password'}
								<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
									<div>
										<label
											for="kasir-new-password"
											class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
										>
											Password Baru Kasir
										</label>
										<div class="relative">
											<input
												id="kasir-new-password"
												type={showKasirNewPassword ? 'text' : 'password'}
												class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
												placeholder="Minimal 8 karakter"
												bind:value={kasirNewPassword}
												required
											/>
											<button
												type="button"
												onclick={() => (showKasirNewPassword = !showKasirNewPassword)}
												class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
												aria-label={showKasirNewPassword
													? 'Sembunyikan password'
													: 'Lihat password'}
											>
												{#if showKasirNewPassword}
													<EyeOff class="h-4.5 w-4.5" />
												{:else}
													<Eye class="h-4.5 w-4.5" />
												{/if}
											</button>
										</div>
									</div>

									<div>
										<label
											for="kasir-confirm-password"
											class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
										>
											Konfirmasi Password Baru
										</label>
										<div class="relative">
											<input
												id="kasir-confirm-password"
												type={showKasirConfirmPassword ? 'text' : 'password'}
												class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
												placeholder="Ulangi password baru"
												bind:value={kasirConfirmPassword}
												required
											/>
											<button
												type="button"
												onclick={() => (showKasirConfirmPassword = !showKasirConfirmPassword)}
												class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
												aria-label={showKasirConfirmPassword
													? 'Sembunyikan password'
													: 'Lihat password'}
											>
												{#if showKasirConfirmPassword}
													<EyeOff class="h-4.5 w-4.5" />
												{:else}
													<Eye class="h-4.5 w-4.5" />
												{/if}
											</button>
										</div>
									</div>
								</div>
							{/if}

							{#if kasirUserPassError}
								<div
									class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
								>
									<AlertCircle class="h-4 w-4 shrink-0" />
									<span>{kasirUserPassError}</span>
								</div>
							{/if}

							<button
								type="submit"
								disabled={isSavingKasir}
								class="mt-2 w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
							>
								{isSavingKasir
									? 'Menyimpan...'
									: kasirChangeMode === 'username'
										? 'Simpan Username Kasir'
										: kasirChangeMode === 'password'
											? 'Simpan Password Kasir'
											: 'Simpan Kredensial Kasir'}
							</button>
						</form>
					{/if}
				</div>
			</div>

			<!-- ========================================== -->
			<!-- COLUMN 2: PIN & Proteksi Halaman Terkunci  -->
			<!-- ========================================== -->
			<div class="flex flex-col gap-4 md:col-span-6 lg:col-span-5">
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
								<p class="text-xs text-slate-500 md:text-sm">4-6 digit angka untuk proteksi</p>
							</div>
						</div>

						{#if pinConfigured}
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

					<form onsubmit={savePinSettings} autocomplete="off" class="space-y-3.5">
						{#if pinConfigured}
							<div>
								<label
									for="old-pin"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									PIN Lama
								</label>
								<div class="relative">
									<input
										id="old-pin"
										type={showOldPin ? 'text' : 'password'}
										inputmode="numeric"
										maxlength="6"
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm tracking-widest text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="PIN lama (4-6 angka)"
										bind:value={oldPin}
										required
									/>
									<button
										type="button"
										onclick={() => (showOldPin = !showOldPin)}
										class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
										aria-label={showOldPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
									>
										{#if showOldPin}
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
								Tetapkan PIN baru 4-6 digit sebelum mengaktifkan kunci halaman.
							</div>
						{/if}

						<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
							<div>
								<label
									for="new-pin"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									PIN Baru
								</label>
								<div class="relative">
									<input
										id="new-pin"
										type={showNewPin ? 'text' : 'password'}
										inputmode="numeric"
										maxlength="6"
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm tracking-widest text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="PIN baru"
										bind:value={newPin}
										required
									/>
									<button
										type="button"
										onclick={() => (showNewPin = !showNewPin)}
										class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
										aria-label={showNewPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
									>
										{#if showNewPin}
											<EyeOff class="h-4.5 w-4.5" />
										{:else}
											<Eye class="h-4.5 w-4.5" />
										{/if}
									</button>
								</div>
							</div>

							<div>
								<label
									for="confirm-pin"
									class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm"
								>
									Konfirmasi PIN
								</label>
								<div class="relative">
									<input
										id="confirm-pin"
										type={showConfirmPin ? 'text' : 'password'}
										inputmode="numeric"
										maxlength="6"
										class="w-full rounded-xl border border-pink-100 bg-pink-50/30 py-2.5 pr-11 pl-4 text-sm tracking-widest text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
										placeholder="Ulangi PIN"
										bind:value={confirmPin}
										required
									/>
									<button
										type="button"
										onclick={() => (showConfirmPin = !showConfirmPin)}
										class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
										aria-label={showConfirmPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
									>
										{#if showConfirmPin}
											<EyeOff class="h-4.5 w-4.5" />
										{:else}
											<Eye class="h-4.5 w-4.5" />
										{/if}
									</button>
								</div>
							</div>
						</div>

						{#if pinError}
							<div
								class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
							>
								<AlertCircle class="h-4 w-4 shrink-0" />
								<span>{pinError}</span>
							</div>
						{/if}

						<button
							type="submit"
							disabled={isSavingPin}
							class="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
						>
							{isSavingPin ? 'Menyimpan...' : 'Simpan PIN Keamanan'}
						</button>
					</form>
				</div>

				<!-- Card B: Halaman Terkunci (Proteksi Akses) -->
				<div class="soft-float-card p-5 md:p-6">
					<div class="mb-4 flex items-center justify-between border-b border-pink-100/80 pb-3.5">
						<div class="flex items-center gap-3">
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
							>
								<Lock class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
							</div>
							<div>
								<h2 class="text-sm font-black text-slate-900 md:text-base">Proteksi Halaman</h2>
								<p class="text-xs text-slate-500 md:text-sm">Kunci menu tertentu dengan PIN</p>
							</div>
						</div>
					</div>

					<p class="mb-3.5 text-xs leading-relaxed text-slate-500 md:text-sm">
						Halaman yang diaktifkan di bawah ini akan mewajibkan verifikasi PIN saat dibuka oleh
						staf atau pengunjung kios.
					</p>

					<!-- List Toggle Switch Halaman -->
					<div class="mb-4 space-y-2.5">
						<!-- 1. Beranda -->
						<div
							class="flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 {lockedPages.includes(
								'beranda'
							)
								? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
								: 'border-slate-100 bg-white hover:border-pink-100'}"
							onclick={() => togglePageLock('beranda')}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									togglePageLock('beranda');
								}
							}}
							role="button"
							tabindex="0"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600"
								>
									<Home class="h-4.5 w-4.5 stroke-[2.2]" />
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900 md:text-sm">Beranda (Kasir POS)</div>
									<div class="text-[11px] text-slate-400">Proteksi menu penjualan utama</div>
								</div>
							</div>
							<div
								class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {lockedPages.includes(
									'beranda'
								)
									? 'bg-pink-600'
									: 'bg-slate-200'}"
							>
								<span
									class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {lockedPages.includes(
										'beranda'
									)
										? 'translate-x-5'
										: 'translate-x-0'}"
								></span>
							</div>
						</div>

						<!-- 2. Catat Transaksi -->
						<div
							class="flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 {lockedPages.includes(
								'catat'
							)
								? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
								: 'border-slate-100 bg-white hover:border-pink-100'}"
							onclick={() => togglePageLock('catat')}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									togglePageLock('catat');
								}
							}}
							role="button"
							tabindex="0"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600"
								>
									<Receipt class="h-4.5 w-4.5 stroke-[2.2]" />
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900 md:text-sm">
										Catat Transaksi Manual
									</div>
									<div class="text-[11px] text-slate-400">Proteksi input pengeluaran & kas</div>
								</div>
							</div>
							<div
								class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {lockedPages.includes(
									'catat'
								)
									? 'bg-pink-600'
									: 'bg-slate-200'}"
							>
								<span
									class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {lockedPages.includes(
										'catat'
									)
										? 'translate-x-5'
										: 'translate-x-0'}"
								></span>
							</div>
						</div>

						<!-- 3. Laporan Keuangan -->
						<div
							class="flex cursor-pointer items-center justify-between rounded-2xl border p-3.5 transition-all duration-200 {lockedPages.includes(
								'laporan'
							)
								? 'border-pink-200 bg-pink-50/40 ring-1 ring-pink-500/10'
								: 'border-slate-100 bg-white hover:border-pink-100'}"
							onclick={() => togglePageLock('laporan')}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									togglePageLock('laporan');
								}
							}}
							role="button"
							tabindex="0"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50 text-pink-600"
								>
									<BarChart3 class="h-4.5 w-4.5 stroke-[2.2]" />
								</div>
								<div>
									<div class="text-xs font-bold text-slate-900 md:text-sm">Laporan Keuangan</div>
									<div class="text-[11px] text-slate-400">Proteksi data omzet & laba bersih</div>
								</div>
							</div>
							<div
								class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {lockedPages.includes(
									'laporan'
								)
									? 'bg-pink-600'
									: 'bg-slate-200'}"
							>
								<span
									class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {lockedPages.includes(
										'laporan'
									)
										? 'translate-x-5'
										: 'translate-x-0'}"
								></span>
							</div>
						</div>
					</div>

					<button
						type="button"
						disabled={isSavingPages}
						onclick={saveLockedPages}
						class="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
					>
						{isSavingPages ? 'Menyimpan...' : 'Simpan Pengaturan Halaman'}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Toast Notification -->
{#if toastManager.showToast}
	<ToastNotification
		show={toastManager.showToast}
		message={toastManager.toastMessage}
		type={toastManager.toastType}
		position="top"
	/>
{/if}
