<script lang="ts">
	import { fetchWithCsrfRetry } from '$lib/utils/csrf';
	let { kioskPilot = null }: { kioskPilot?: 'staging' | 'production' | null } = $props();
	const targetLabel = $derived(kioskPilot === 'production' ? 'produksi' : 'staging');
	let confirmed = $state(false);
	let rollbackConfirmed = $state(false);
	let account = $state<'self' | 'cashier'>('cashier');
	let username = $state('');
	let busy = $state(false);
	let message = $state('');
	async function changePilot(action: 'activate' | 'rollback') {
		const rollback = action === 'rollback';
		if (!kioskPilot || busy || !(rollback ? rollbackConfirmed : confirmed)) return;
		busy = true;
		try {
			const res = await fetchWithCsrfRetry('/api/perangkat-kasir', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					confirm: `${rollback ? 'rollback-' : ''}balikpapan-${kioskPilot}`
				})
			});
			const result = await res.json().catch(() => null);
			message =
				res.ok && result?.success === true
					? rollback
						? `Kasir lama Balikpapan ${targetLabel} sudah bisa digunakan kembali.`
						: `Balikpapan ${targetLabel} aktif. Masuk lagi dari HP yang sudah terdaftar.`
					: result?.message || 'Peralihan belum terkonfirmasi. Jangan buka shift.';
			if (res.ok && result?.success === true) {
				confirmed = false;
				rollbackConfirmed = false;
			}
		} catch {
			message =
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
			message = res.ok
				? 'Katalog bersama siap hingga masa berlaku harga habis. Cabang tidak diaktifkan otomatis.'
				: 'Katalog belum siap. Periksa database pusat dan coba lagi.';
		} catch {
			message = 'Katalog belum terkonfirmasi. Periksa koneksi lalu coba lagi.';
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
				body: JSON.stringify(account === 'self' ? { self: true } : { username: username.trim() })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(
					typeof data?.message === 'string'
						? data.message
						: 'Pendaftaran gagal. Periksa koneksi lalu coba lagi.'
				);
			}
			message =
				'HP ini terdaftar untuk akun yang dipilih selama 48 jam. Pendaftaran bukan konfirmasi bahwa penjualan sudah tersinkron.';
		} catch (cause) {
			message = cause instanceof Error ? cause.message : 'Pendaftaran gagal.';
		} finally {
			busy = false;
		}
	}
</script>

<details class="soft-float-card p-4">
	<summary class="cursor-pointer font-bold">Daftarkan HP kios ini</summary>
	<p class="my-2 text-sm">
		Gunakan hanya pada HP tepercaya saat database cabang tersedia. Pendaftaran mengganti akun
		operasional yang dipilih untuk HP ini di cabang ini.
	</p>
	<form onsubmit={enroll} class="grid gap-3">
		<label
			>Akun perangkat <select bind:value={account} disabled={busy}
				><option value="cashier">Kasir cabang</option><option value="self">Akun pemilik saya</option
				></select
			></label
		>
		{#if account === 'cashier'}<label
				>Username kasir <input
					required
					bind:value={username}
					disabled={busy}
					autocapitalize="none"
					spellcheck="false"
				/></label
			>{/if}
		<button
			type="submit"
			class="btn-brand-primary"
			disabled={busy || (account === 'cashier' && !username.trim())}
			>{busy ? 'Mendaftarkan…' : 'Daftarkan HP ini'}</button
		>
	</form>
	<button type="button" class="btn-brand-primary mt-3" disabled={busy} onclick={prepareCatalog}
		>Siapkan Katalog Kios</button
	>
	{#if kioskPilot}
		<div class="mt-4 grid gap-2">
			<label
				><input type="checkbox" bind:checked={confirmed} disabled={busy} /> Shift lama tutup, antrean
				semua HP kosong, dan stok sudah dicocokkan.</label
			>
			<button
				type="button"
				class="btn-brand-primary"
				disabled={busy || !confirmed}
				onclick={() => changePilot('activate')}>Aktifkan Balikpapan {targetLabel}</button
			>
			{#if kioskPilot === 'staging'}<a href="/login?kiosk=staging" class="underline"
					>Login uji Balikpapan staging</a
				>{/if}
			<label
				><input type="checkbox" bind:checked={rollbackConfirmed} disabled={busy} /> Shift kios sudah tutup.
				Saya ingin kembali ke kasir lama.</label
			>
			<button
				type="button"
				disabled={busy || !rollbackConfirmed}
				onclick={() => changePilot('rollback')}>Kembali ke kasir lama ({targetLabel})</button
			>
		</div>
	{/if}
	<p role="status" class="text-sm">{message}</p>
</details>
