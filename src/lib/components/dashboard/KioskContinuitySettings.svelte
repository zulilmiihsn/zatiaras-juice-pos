<script lang="ts">
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	let {
		kioskPilot = null,
		kioskBranch
	}: { kioskPilot?: 'staging' | 'production' | null; kioskBranch: string } = $props();
	const branchLabel = $derived(
		kioskBranch ? kioskBranch.charAt(0).toUpperCase() + kioskBranch.slice(1) : ''
	);
	let confirmed = $state(false);
	let busy = $state(false);
	let setupMessage = $state('');
	async function activatePilot() {
		if (!kioskPilot || !kioskBranch || busy || !confirmed) return;
		busy = true;
		setupMessage = '';
		try {
			const res = await fetchWithCsrfRetry('/api/perangkat-kasir', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					confirm: `${kioskBranch}-${kioskPilot}`
				})
			});
			const result = await res.json().catch(() => null);
			setupMessage =
				res.ok && result?.success === true
					? `Mode cadangan ${branchLabel} aktif. Kasir bisa masuk seperti biasa.`
					: result?.message || 'Peralihan belum terkonfirmasi. Jangan buka shift.';
			if (res.ok && result?.success === true) confirmed = false;
		} catch {
			setupMessage =
				'Peralihan belum terkonfirmasi. Periksa koneksi sebelum mengulang tindakan yang sama.';
		} finally {
			busy = false;
		}
	}
	async function checkCoordinator() {
		if (busy) return;
		busy = true;
		setupMessage = 'Memeriksa koordinator…';
		try {
			const response = await fetch('/api/perangkat-kasir', { cache: 'no-store' });
			if (!response.ok) throw new Error('Status tidak tersedia');
			const status = await response.json();
			const shift =
				status.shift === 'closed' ? 'tutup' : status.shift === 'open' ? 'buka' : 'belum aktif';
			setupMessage = `Shift koordinator: ${shift}. ${status.pending} catatan menunggu sinkronisasi.${status.paused ? ' Koordinator dijeda.' : ''}`;
		} catch {
			setupMessage = 'Status koordinator belum tersedia. Jangan anggap antrean kosong.';
		} finally {
			busy = false;
		}
	}
	async function prepareCatalog() {
		if (busy) return;
		busy = true;
		try {
			const res = await fetchWithCsrfRetry('/api/perangkat-kasir', { method: 'PUT' });
			setupMessage = res.ok
				? 'Katalog bersama siap hingga masa berlaku harga habis. Cabang tidak diaktifkan otomatis.'
				: 'Katalog belum siap. Periksa database pusat dan coba lagi.';
		} catch {
			setupMessage = 'Katalog belum terkonfirmasi. Periksa koneksi lalu coba lagi.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="soft-float-card space-y-4 p-4" aria-label="Mode cadangan kasir">
	<header>
		<h2 class="text-lg font-bold">Mode cadangan kasir{branchLabel ? ` · ${branchLabel}` : ''}</h2>
		<p class="mt-1 text-sm">
			Login seperti biasa di setiap HP saat database tersedia. HP itu otomatis siap untuk mode
			cadangan.
		</p>
	</header>
	<details class="border-t pt-3">
		<summary class="cursor-pointer text-sm font-semibold">Pengaturan mode cadangan</summary>
		<div class="mt-3 grid gap-4 text-sm">
			{#if kioskPilot}
				<div class="grid gap-2">
					<p>Aktifkan sekali setelah semua HP kasir berhasil login seperti biasa.</p>
					<button type="button" class="w-fit underline" disabled={busy} onclick={checkCoordinator}>
						Periksa status koordinator
					</button>
					<p>Status koordinator tidak mencakup antrean offline di HP kasir.</p>
					<label class="flex items-start gap-2">
						<input type="checkbox" bind:checked={confirmed} disabled={busy} />
						<span>Shift sudah tutup, antrean semua HP kosong, dan stok sudah dicocokkan.</span>
					</label>
					<button
						type="button"
						class="btn-brand-primary w-fit"
						disabled={busy || !confirmed}
						onclick={activatePilot}
					>
						Aktifkan mode cadangan
					</button>
				</div>
				{#if kioskPilot === 'staging'}
					<a href="/login?kiosk=staging" class="underline">Login uji Balikpapan</a>
				{/if}
			{/if}
			<details class="border-t pt-3">
				<summary class="cursor-pointer font-semibold">Pemeliharaan</summary>
				<div class="mt-3 grid gap-3">
					<button type="button" class="w-fit underline" disabled={busy} onclick={prepareCatalog}>
						Perbarui katalog mode cadangan
					</button>
				</div>
			</details>
			<p role="status">{setupMessage}</p>
		</div>
	</details>
</section>
