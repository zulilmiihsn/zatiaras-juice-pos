<script lang="ts">
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	let {
		kioskPilot = null,
		kioskBranch = null,
		username = null,
		canManage = false
	}: {
		kioskPilot?: 'staging' | 'production' | null;
		kioskBranch?: string | null;
		username?: string | null;
		canManage?: boolean;
	} = $props();
	const branchLabel = $derived(
		kioskBranch ? kioskBranch.charAt(0).toUpperCase() + kioskBranch.slice(1) : ''
	);
	let confirmed = $state(false);
	let rollbackConfirmed = $state(false);
	let busy = $state(false);
	let message = $state('');
	let setupMessage = $state('');
	async function changePilot(action: 'activate' | 'rollback') {
		const rollback = action === 'rollback';
		if (!kioskPilot || !kioskBranch || busy || !(rollback ? rollbackConfirmed : confirmed)) return;
		busy = true;
		setupMessage = '';
		try {
			const res = await fetchWithCsrfRetry('/api/perangkat-kasir', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					confirm: `${rollback ? 'rollback-' : ''}${kioskBranch}-${kioskPilot}`
				})
			});
			const result = await res.json().catch(() => null);
			setupMessage =
				res.ok && result?.success === true
					? rollback
						? `Kasir lama ${branchLabel} sudah bisa digunakan kembali.`
						: `Mode cadangan ${branchLabel} aktif. Masuk lagi dari HP yang sudah terdaftar.`
					: result?.message || 'Peralihan belum terkonfirmasi. Jangan buka shift.';
			if (res.ok && result?.success === true) {
				confirmed = false;
				rollbackConfirmed = false;
			}
		} catch {
			setupMessage =
				'Peralihan belum terkonfirmasi. Periksa koneksi sebelum mengulang tindakan yang sama.';
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
	async function enroll(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		message = '';
		busy = true;
		try {
			const res = await fetchWithCsrfRetry('/api/perangkat-kasir', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ self: true })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(
					typeof data?.message === 'string'
						? data.message
						: 'Pendaftaran gagal. Periksa koneksi lalu coba lagi.'
				);
			}
			message = 'HP ini sudah terdaftar untuk akunmu selama 48 jam.';
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Pendaftaran gagal.';
		} finally {
			busy = false;
		}
	}
</script>

<section class="soft-float-card space-y-4 p-4" aria-label="Perangkat kasir">
	<header>
		<h2 class="text-lg font-bold">Perangkat kasir{branchLabel ? ` · ${branchLabel}` : ''}</h2>
		<p class="mt-1 text-sm">
			Daftarkan HP yang kamu pakai jualan agar akunmu bisa masuk saat database pusat terganggu.
		</p>
	</header>
	<form onsubmit={enroll} class="grid gap-3">
		{#if username}<p class="text-sm">Akun saat ini: <strong>{username}</strong></p>{/if}
		<button type="submit" class="btn-brand-primary w-fit" disabled={busy}>
			{busy ? 'Tunggu sebentar…' : 'Daftarkan HP ini'}
		</button>
		<p role="status" class="text-sm">{message}</p>
	</form>
	{#if canManage}
		<details class="border-t pt-3">
			<summary class="cursor-pointer text-sm font-semibold">Pengaturan mode cadangan</summary>
			<div class="mt-3 grid gap-4 text-sm">
				{#if kioskPilot}
					<div class="grid gap-2">
						<p>Aktifkan sekali untuk cabang ini setelah semua HP kasir didaftarkan.</p>
						<label class="flex items-start gap-2">
							<input type="checkbox" bind:checked={confirmed} disabled={busy} />
							<span>Shift sudah tutup, antrean semua HP kosong, dan stok sudah dicocokkan.</span>
						</label>
						<button
							type="button"
							class="btn-brand-primary w-fit"
							disabled={busy || !confirmed}
							onclick={() => changePilot('activate')}
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
						{#if kioskPilot}
							<label class="flex items-start gap-2">
								<input type="checkbox" bind:checked={rollbackConfirmed} disabled={busy} />
								<span>Shift kios sudah tutup. Saya ingin kembali ke kasir lama.</span>
							</label>
							<button
								type="button"
								class="w-fit underline"
								disabled={busy || !rollbackConfirmed}
								onclick={() => changePilot('rollback')}
							>
								Kembali ke kasir lama
							</button>
						{/if}
					</div>
				</details>
				<p role="status">{setupMessage}</p>
			</div>
		</details>
	{/if}
</section>
