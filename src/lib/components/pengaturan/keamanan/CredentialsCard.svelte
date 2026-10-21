<script lang="ts">
	import Shield from '@lucide/svelte/icons/shield';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import User from '@lucide/svelte/icons/user';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	import type { SecuritySettingsState } from '$lib/stores/securitySettingsState.svelte';

	let { s }: { s: SecuritySettingsState } = $props();
</script>

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
			class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200 md:text-sm {s.activeSecurityTab ===
			'pemilik'
				? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
				: 'text-slate-600 hover:text-pink-600'}"
			onclick={() => {
				s.activeSecurityTab = 'pemilik';
				s.userPassError = '';
			}}
		>
			<User class="h-4 w-4" />
			<span>Akun Pemilik</span>
		</button>
		<button
			type="button"
			class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all duration-200 md:text-sm {s.activeSecurityTab ===
			'kasir'
				? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
				: 'text-slate-600 hover:text-pink-600'}"
			onclick={() => {
				s.activeSecurityTab = 'kasir';
				s.kasirUserPassError = '';
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
				if (s.activeSecurityTab === 'pemilik') s.pemilikChangeMode = 'all';
				else s.kasirChangeMode = 'all';
			}}
			class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(s.activeSecurityTab ===
			'pemilik'
				? s.pemilikChangeMode
				: s.kasirChangeMode) === 'all'
				? 'bg-white font-extrabold text-pink-600 shadow-2xs'
				: 'text-slate-500 hover:text-slate-800'}"
		>
			Keduanya
		</button>
		<button
			type="button"
			onclick={() => {
				if (s.activeSecurityTab === 'pemilik') s.pemilikChangeMode = 'username';
				else s.kasirChangeMode = 'username';
			}}
			class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(s.activeSecurityTab ===
			'pemilik'
				? s.pemilikChangeMode
				: s.kasirChangeMode) === 'username'
				? 'bg-white font-extrabold text-pink-600 shadow-2xs'
				: 'text-slate-500 hover:text-slate-800'}"
		>
			Username Saja
		</button>
		<button
			type="button"
			onclick={() => {
				if (s.activeSecurityTab === 'pemilik') s.pemilikChangeMode = 'password';
				else s.kasirChangeMode = 'password';
			}}
			class="flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition-all {(s.activeSecurityTab ===
			'pemilik'
				? s.pemilikChangeMode
				: s.kasirChangeMode) === 'password'
				? 'bg-white font-extrabold text-pink-600 shadow-2xs'
				: 'text-slate-500 hover:text-slate-800'}"
		>
			Password Saja
		</button>
	</div>

	<!-- ========================================== -->
	<!-- FORM PEMILIK                               -->
	<!-- ========================================== -->
	{#if s.activeSecurityTab === 'pemilik'}
		<form onsubmit={s.handleChangeUserPass} autocomplete="off" class="space-y-3.5">
			<div
				class="flex items-center gap-2 rounded-xl border border-pink-100/60 bg-pink-50/60 px-3.5 py-2 text-xs font-semibold text-pink-700"
			>
				<ShieldCheck class="h-4 w-4 shrink-0 text-pink-600" />
				<span>
					{#if s.pemilikChangeMode === 'username'}
						Ubah username akun Pemilik. Verifikasi dengan password saat ini.
					{:else if s.pemilikChangeMode === 'password'}
						Ubah password akun Pemilik. Verifikasi dengan password saat ini.
					{:else}
						Ubah username dan password akun Pemilik secara bersamaan.
					{/if}
				</span>
			</div>

			<!-- 1. Username Saat Ini (Hanya tampil jika ubah username atau keduanya) -->
			{#if s.pemilikChangeMode === 'all' || s.pemilikChangeMode === 'username'}
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
						class="form-input-pink px-4 py-2.5"
						placeholder="Username saat ini"
						bind:value={s.oldUsername}
						required
					/>
				</div>
			{/if}

			<!-- 2. Username Baru (Jika mode 'all' atau 'username') -->
			{#if s.pemilikChangeMode === 'all' || s.pemilikChangeMode === 'username'}
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
						class="form-input-pink px-4 py-2.5"
						placeholder="Masukkan username baru"
						bind:value={s.newUsername}
						required
					/>
				</div>
			{/if}

			<!-- 3. Password Saat Ini (Selalu wajib untuk verifikasi keamanan) -->
			<div>
				<label for="old-password" class="mb-1.5 block text-xs font-bold text-slate-700 md:text-sm">
					Password Saat Ini <span class="font-normal text-rose-500">(Verifikasi Keamanan)</span>
				</label>
				<div class="relative">
					<input
						id="old-password"
						type={s.showOldPassword ? 'text' : 'password'}
						class="form-input-pink py-2.5 pr-11 pl-4"
						placeholder="Masukkan password saat ini"
						bind:value={s.oldPassword}
						required
					/>
					<button
						type="button"
						onclick={() => (s.showOldPassword = !s.showOldPassword)}
						class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						aria-label={s.showOldPassword ? 'Sembunyikan password' : 'Lihat password'}
					>
						{#if s.showOldPassword}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
			</div>

			<!-- 4. Password Baru + Konfirmasi (Jika mode 'all' atau 'password') -->
			{#if s.pemilikChangeMode === 'all' || s.pemilikChangeMode === 'password'}
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
								type={s.showNewPassword ? 'text' : 'password'}
								class="form-input-pink py-2.5 pr-11 pl-4"
								placeholder="Minimal 8 karakter"
								bind:value={s.newPassword}
								required
							/>
							<button
								type="button"
								onclick={() => (s.showNewPassword = !s.showNewPassword)}
								class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
								aria-label={s.showNewPassword ? 'Sembunyikan password' : 'Lihat password'}
							>
								{#if s.showNewPassword}
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
								type={s.showConfirmPassword ? 'text' : 'password'}
								class="form-input-pink py-2.5 pr-11 pl-4"
								placeholder="Ulangi password baru"
								bind:value={s.confirmPassword}
								required
							/>
							<button
								type="button"
								onclick={() => (s.showConfirmPassword = !s.showConfirmPassword)}
								class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
								aria-label={s.showConfirmPassword ? 'Sembunyikan password' : 'Lihat password'}
							>
								{#if s.showConfirmPassword}
									<EyeOff class="h-4.5 w-4.5" />
								{:else}
									<Eye class="h-4.5 w-4.5" />
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}

			{#if s.userPassError}
				<div
					class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
				>
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{s.userPassError}</span>
				</div>
			{/if}

			<button
				type="submit"
				disabled={s.isSavingPemilik}
				class="mt-2 w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
			>
				{s.isSavingPemilik
					? 'Menyimpan...'
					: s.pemilikChangeMode === 'username'
						? 'Simpan Username Baru'
						: s.pemilikChangeMode === 'password'
							? 'Simpan Password Baru'
							: 'Simpan Perubahan Kredensial'}
			</button>
		</form>
	{:else}
		<!-- ========================================== -->
		<!-- FORM KASIR                                 -->
		<!-- ========================================== -->
		<form onsubmit={s.handleChangeUserPassKasir} autocomplete="off" class="space-y-3.5">
			<div
				class="flex items-center gap-2 rounded-xl border border-pink-100/60 bg-pink-50/60 px-3.5 py-2 text-xs font-semibold text-pink-700"
			>
				<Shield class="h-4 w-4 shrink-0 text-pink-600" />
				<span>
					{#if s.kasirChangeMode === 'username'}
						Ubah username akun Kasir. Verifikasi dengan password kasir saat ini.
					{:else if s.kasirChangeMode === 'password'}
						Ubah password akun Kasir. Verifikasi dengan password kasir saat ini.
					{:else}
						Ubah username dan password akun Kasir secara bersamaan.
					{/if}
				</span>
			</div>

			<!-- 1. Username Kasir Saat Ini (Hanya tampil jika ubah username atau keduanya) -->
			{#if s.kasirChangeMode === 'all' || s.kasirChangeMode === 'username'}
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
						class="form-input-pink px-4 py-2.5"
						placeholder="Username kasir saat ini"
						bind:value={s.kasirOldUsername}
						required
					/>
				</div>
			{/if}

			<!-- 2. Username Baru Kasir (Jika mode 'all' atau 'username') -->
			{#if s.kasirChangeMode === 'all' || s.kasirChangeMode === 'username'}
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
						class="form-input-pink px-4 py-2.5"
						placeholder="Masukkan username baru kasir"
						bind:value={s.kasirNewUsername}
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
						type={s.showKasirOldPassword ? 'text' : 'password'}
						class="form-input-pink py-2.5 pr-11 pl-4"
						placeholder="Masukkan password kasir saat ini"
						bind:value={s.kasirOldPassword}
						required
					/>
					<button
						type="button"
						onclick={() => (s.showKasirOldPassword = !s.showKasirOldPassword)}
						class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
						aria-label={s.showKasirOldPassword ? 'Sembunyikan password' : 'Lihat password'}
					>
						{#if s.showKasirOldPassword}
							<EyeOff class="h-4.5 w-4.5" />
						{:else}
							<Eye class="h-4.5 w-4.5" />
						{/if}
					</button>
				</div>
			</div>

			<!-- 4. Password Baru Kasir + Konfirmasi (Jika mode 'all' atau 'password') -->
			{#if s.kasirChangeMode === 'all' || s.kasirChangeMode === 'password'}
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
								type={s.showKasirNewPassword ? 'text' : 'password'}
								class="form-input-pink py-2.5 pr-11 pl-4"
								placeholder="Minimal 8 karakter"
								bind:value={s.kasirNewPassword}
								required
							/>
							<button
								type="button"
								onclick={() => (s.showKasirNewPassword = !s.showKasirNewPassword)}
								class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
								aria-label={s.showKasirNewPassword ? 'Sembunyikan password' : 'Lihat password'}
							>
								{#if s.showKasirNewPassword}
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
								type={s.showKasirConfirmPassword ? 'text' : 'password'}
								class="form-input-pink py-2.5 pr-11 pl-4"
								placeholder="Ulangi password baru"
								bind:value={s.kasirConfirmPassword}
								required
							/>
							<button
								type="button"
								onclick={() => (s.showKasirConfirmPassword = !s.showKasirConfirmPassword)}
								class="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors hover:text-pink-600"
								aria-label={s.showKasirConfirmPassword ? 'Sembunyikan password' : 'Lihat password'}
							>
								{#if s.showKasirConfirmPassword}
									<EyeOff class="h-4.5 w-4.5" />
								{:else}
									<Eye class="h-4.5 w-4.5" />
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}

			{#if s.kasirUserPassError}
				<div
					class="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-2 text-xs font-bold text-rose-600"
				>
					<AlertCircle class="h-4 w-4 shrink-0" />
					<span>{s.kasirUserPassError}</span>
				</div>
			{/if}

			<button
				type="submit"
				disabled={s.isSavingKasir}
				class="mt-2 w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-black text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-60 md:text-base"
			>
				{s.isSavingKasir
					? 'Menyimpan...'
					: s.kasirChangeMode === 'username'
						? 'Simpan Username Kasir'
						: s.kasirChangeMode === 'password'
							? 'Simpan Password Kasir'
							: 'Simpan Kredensial Kasir'}
			</button>
		</form>
	{/if}
</div>
