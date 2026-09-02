<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth/auth';
	import { securityUtils } from '$lib/utils/security';

	// [CATATAN]: Log unauthorized access attempt
	securityUtils.logSecurityEvent('unauthorized_access', {
		user: (auth.getCurrentUser() as any)?.username || 'anonymous',
		url: typeof window !== 'undefined' ? window.location.href : 'unknown'
	});

	function goBack() {
		goto('/pengaturan');
	}

	function goToLogin() {
		auth.logout();
		goto('/login');
	}
</script>

<div
	class="page-content flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-red-100 p-4"
>
	<div class="w-full max-w-md text-center">
		<!-- Icon -->
		<div class="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-red-600">
			<svg class="h-12 w-12 text-white" fill="currentColor" viewBox="0 0 20 20">
				<path
					fill-rule="evenodd"
					d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
					clip-rule="evenodd"
				/>
			</svg>
		</div>

		<!-- Content -->
		<div class="rounded-2xl bg-white p-8 shadow-lg">
			<h1 class="mb-4 text-2xl font-bold text-gray-800">Akses Ditolak</h1>

			<p class="mb-6 text-gray-600">
				Maaf, Anda tidak memiliki izin untuk mengakses halaman ini. Silakan hubungi administrator
				jika Anda merasa ini adalah kesalahan.
			</p>

			<!-- Action Buttons -->
			<div class="space-y-3">
				<button
					onclick={goBack}
					class="w-full rounded-lg bg-gray-600 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-700"
				>
					Kembali
				</button>

				<button
					onclick={goToLogin}
					class="w-full rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition-colors hover:bg-red-700"
				>
					Login Ulang
				</button>
			</div>
		</div>

		<!-- Footer -->
		<div class="mt-6">
			<p class="text-sm text-gray-500">© 2024 Zatiaras Juice. All rights reserved.</p>
		</div>
	</div>
</div>
