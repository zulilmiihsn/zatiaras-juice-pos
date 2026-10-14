// State, perintah, dan lifecycle halaman Pengaturan Pemilik > Keamanan
// (kredensial pemilik/kasir, PIN, halaman terkunci). Halaman hanya merender.
import { goto } from '$app/navigation';
import { userRole, userProfile } from '$lib/stores/userRole.svelte';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { createToastManager } from '$lib/utils/ui';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
import { transactionService } from '$lib/services/transactionService';
import { setSecuritySettings } from '$lib/stores/securitySettings.svelte';

export function createSecuritySettingsState() {
	let activeSecurityTab = $state<'pemilik' | 'kasir'>('pemilik');
	let pemilikChangeMode = $state<'all' | 'username' | 'password'>('all');
	let kasirChangeMode = $state<'all' | 'username' | 'password'>('all');

	// ─── State Kredensial Pemilik ──────────────────────────────────────────
	let oldUsername = $state('pemilik');
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

	// ─── State Kredensial Kasir ────────────────────────────────────────────
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

	// ─── State PIN & Proteksi Halaman ──────────────────────────────────────
	let oldPin = $state('');
	let newPin = $state('');
	let confirmPin = $state('');
	let lockedPages = $state<string[]>([]);
	// Daftar terakhir yang dikonfirmasi server (berbeda dari toggle yang belum disimpan).
	let savedLockedPages: string[] = [];
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
	function destroy(): void {
		toastManager.dispose();
	}

	async function mount(): Promise<void> {
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

		let data: { pinConfigured?: boolean; halaman_terkunci?: string[]; id?: string } | null;
		try {
			data = (await transactionService.getOne('pengaturan')) as typeof data;
		} catch (error) {
			// Jangan tampilkan default (PIN "belum diatur") seolah data server.
			console.error('[gantikeamanan] muat pengaturan gagal:', error);
			toastManager.showToastNotification(
				'Pengaturan keamanan gagal dimuat. Muat ulang halaman sebelum mengubah.',
				'error'
			);
			return;
		}
		if (data) {
			pinConfigured = data.pinConfigured === true;
			lockedPages = data.halaman_terkunci || [];
			savedLockedPages = lockedPages;
			pengaturanKeamananId = data.id ?? '';
			setSecuritySettings({
				lockedPages: pinConfigured ? lockedPages : [],
				pinConfigured
			});
		}
	}

	async function handleChangeUserPass(e: Event) {
		e.preventDefault();
		userPassError = '';

		if (!oldUsername.trim()) {
			oldUsername = 'pemilik';
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
			kasirOldUsername = 'kasir';
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
		if (newPin.length !== 4 || !/^[0-9]+$/.test(newPin)) {
			pinError = 'PIN harus 4 digit angka.';
			return;
		}
		if (['0000', '1111', '1234', '4321'].includes(newPin)) {
			pinError = 'PIN terlalu mudah ditebak (hindari 1234, 0000, 1111, 4321).';
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
			// Hanya daftar yang sudah tersimpan di server; toggle belum disimpan tidak berlaku.
			setSecuritySettings({
				lockedPages: savedLockedPages,
				pinConfigured: true
			});
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
		if (!pengaturanKeamananId) {
			toastManager.showToastNotification(
				'Pengaturan keamanan belum termuat. Muat ulang halaman lalu coba lagi.',
				'error'
			);
			return;
		}
		isSavingPages = true;
		try {
			await transactionService.updateRows(
				'pengaturan',
				{ halaman_terkunci: lockedPages },
				{ id: pengaturanKeamananId }
			);
			savedLockedPages = lockedPages;
			setSecuritySettings({
				lockedPages: pinConfigured ? lockedPages : [],
				pinConfigured
			});
			toastManager.showToastNotification(
				pinConfigured
					? 'Pengaturan halaman terkunci berhasil disimpan!'
					: 'Pengaturan halaman disimpan. Proteksi aktif setelah PIN diatur.',
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

	return {
		get activeSecurityTab() {
			return activeSecurityTab;
		},
		set activeSecurityTab(value) {
			activeSecurityTab = value;
		},
		get pemilikChangeMode() {
			return pemilikChangeMode;
		},
		set pemilikChangeMode(value) {
			pemilikChangeMode = value;
		},
		get kasirChangeMode() {
			return kasirChangeMode;
		},
		set kasirChangeMode(value) {
			kasirChangeMode = value;
		},
		get oldUsername() {
			return oldUsername;
		},
		set oldUsername(value) {
			oldUsername = value;
		},
		get newUsername() {
			return newUsername;
		},
		set newUsername(value) {
			newUsername = value;
		},
		get oldPassword() {
			return oldPassword;
		},
		set oldPassword(value) {
			oldPassword = value;
		},
		get newPassword() {
			return newPassword;
		},
		set newPassword(value) {
			newPassword = value;
		},
		get confirmPassword() {
			return confirmPassword;
		},
		set confirmPassword(value) {
			confirmPassword = value;
		},
		get userPassError() {
			return userPassError;
		},
		set userPassError(value) {
			userPassError = value;
		},
		get isSavingPemilik() {
			return isSavingPemilik;
		},
		get showOldPassword() {
			return showOldPassword;
		},
		set showOldPassword(value) {
			showOldPassword = value;
		},
		get showNewPassword() {
			return showNewPassword;
		},
		set showNewPassword(value) {
			showNewPassword = value;
		},
		get showConfirmPassword() {
			return showConfirmPassword;
		},
		set showConfirmPassword(value) {
			showConfirmPassword = value;
		},
		get kasirOldUsername() {
			return kasirOldUsername;
		},
		set kasirOldUsername(value) {
			kasirOldUsername = value;
		},
		get kasirNewUsername() {
			return kasirNewUsername;
		},
		set kasirNewUsername(value) {
			kasirNewUsername = value;
		},
		get kasirOldPassword() {
			return kasirOldPassword;
		},
		set kasirOldPassword(value) {
			kasirOldPassword = value;
		},
		get kasirNewPassword() {
			return kasirNewPassword;
		},
		set kasirNewPassword(value) {
			kasirNewPassword = value;
		},
		get kasirConfirmPassword() {
			return kasirConfirmPassword;
		},
		set kasirConfirmPassword(value) {
			kasirConfirmPassword = value;
		},
		get kasirUserPassError() {
			return kasirUserPassError;
		},
		set kasirUserPassError(value) {
			kasirUserPassError = value;
		},
		get isSavingKasir() {
			return isSavingKasir;
		},
		get showKasirOldPassword() {
			return showKasirOldPassword;
		},
		set showKasirOldPassword(value) {
			showKasirOldPassword = value;
		},
		get showKasirNewPassword() {
			return showKasirNewPassword;
		},
		set showKasirNewPassword(value) {
			showKasirNewPassword = value;
		},
		get showKasirConfirmPassword() {
			return showKasirConfirmPassword;
		},
		set showKasirConfirmPassword(value) {
			showKasirConfirmPassword = value;
		},
		get oldPin() {
			return oldPin;
		},
		set oldPin(value) {
			oldPin = value;
		},
		get newPin() {
			return newPin;
		},
		set newPin(value) {
			newPin = value;
		},
		get confirmPin() {
			return confirmPin;
		},
		set confirmPin(value) {
			confirmPin = value;
		},
		get lockedPages() {
			return lockedPages;
		},
		get pinError() {
			return pinError;
		},
		get pinConfigured() {
			return pinConfigured;
		},
		get isSavingPin() {
			return isSavingPin;
		},
		get isSavingPages() {
			return isSavingPages;
		},
		get showOldPin() {
			return showOldPin;
		},
		set showOldPin(value) {
			showOldPin = value;
		},
		get showNewPin() {
			return showNewPin;
		},
		set showNewPin(value) {
			showNewPin = value;
		},
		get showConfirmPin() {
			return showConfirmPin;
		},
		set showConfirmPin(value) {
			showConfirmPin = value;
		},
		toastManager,
		handleChangeUserPass,
		handleChangeUserPassKasir,
		savePinSettings,
		togglePageLock,
		saveLockedPages,
		mount,
		destroy
	};
}

export type SecuritySettingsState = ReturnType<typeof createSecuritySettingsState>;
