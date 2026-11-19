<script lang="ts">
	import type { PageProps } from './$types';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	let { data, form }: PageProps = $props();
	const newLine = (key: number) => ({
		key,
		productId: '',
		qty: 1,
		portion: 'reguler',
		addOnIds: [] as string[]
	});
	let cart = $state([newLine(0)]);
	function linePrice(line: ReturnType<typeof newLine>) {
		const product = data.user.products.find((item) => item.id === line.productId);
		if (!product) return 0;
		return (
			(line.portion === 'jumbo' ? (product.hargaJumbo ?? 0) : product.harga) +
			product.addOns
				.filter((extra) => line.addOnIds.includes(extra.id))
				.reduce((sum, extra) => sum + extra.harga, 0)
		);
	}
	let nextLine = 1;
	let payment = $state('tunai');
	const cartReady = $derived(
		cart.every((line) => data.user.products.some((item) => item.id === line.productId))
	);
	const cartTotal = $derived(
		cart.reduce((sum, line) => sum + linePrice(line) * (line.qty || 0), 0)
	);
	const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
	let busy = $state(false),
		message = $state('');
	async function logout() {
		busy = true;
		try {
			const response = await fetch('/api/logout', { method: 'POST' });
			if (!response.ok) throw new Error();
			await goto('/login');
		} catch {
			message = 'Logout belum terkonfirmasi. Coba lagi.';
		} finally {
			busy = false;
		}
	}
</script>

<main data-hydrated={hydrated} class="page-content mx-auto max-w-lg p-6">
	<h1 class="text-xl font-bold">Mode operasional kios</h1>
	<p>{data.user.username} berhasil masuk untuk cabang {data.user.branch} dengan HP terdaftar.</p>
	<p>Mode kios aktif untuk sesi ini. Laporan pusat disinkronkan terpisah.</p>
	{#if data.user.shiftStatus.state === 'open'}
		<p class="mt-4 font-bold">
			Kios sudah buka · Modal awal Rp{data.user.shiftStatus.openingCash.toLocaleString('id-ID')}
		</p>
		{#if data.user.products.length}
			<form method="POST" action="?/sale" class="my-4 grid gap-2 print:hidden">
				<input
					type="hidden"
					name="id"
					value={form && 'saleId' in form && typeof form.saleId === 'string'
						? form.saleId
						: data.operationId}
				/>
				<input type="hidden" name="shiftId" value={data.user.shiftStatus.id} />
				{#each cart as line, index (line.key)}
					{@const product = data.user.products.find((item) => item.id === line.productId)}
					<input type="hidden" name="unitPrice" value={linePrice(line)} />
					<label
						>Produk {index + 1}
						<select
							name="productId"
							bind:value={line.productId}
							onchange={() => {
								line.portion = 'reguler';
								line.addOnIds = [];
							}}
							required
						>
							<option value="">Pilih produk</option>
							{#each data.user.products as item (item.id)}
								<option value={item.id}>{item.nama} · {rupiah(item.harga)}</option>
							{/each}
						</select>
					</label>
					<label
						>Porsi
						<select name="portion" bind:value={line.portion}>
							<option value="reguler">Reguler</option>
							{#if product?.hargaJumbo}<option value="jumbo"
									>Jumbo · {rupiah(product.hargaJumbo)}</option
								>{/if}
						</select>
					</label>
					{#each product?.addOns ?? [] as extra (extra.id)}
						<label
							><input
								type="checkbox"
								name={'extra-' + index}
								value={extra.id}
								bind:group={line.addOnIds}
							/>
							{extra.nama} · {rupiah(extra.harga)}</label
						>
					{/each}
					<label
						>Jumlah <input
							name="qty"
							type="number"
							min="1"
							max="99"
							bind:value={line.qty}
							required
						/></label
					>
					{#if cart.length > 1}<button
							type="button"
							onclick={() => (cart = cart.filter((other) => other.key !== line.key))}
							>Hapus produk {index + 1}</button
						>{/if}
				{/each}
				<button
					type="button"
					disabled={cart.length >= 20}
					onclick={() => cart.push(newLine(nextLine++))}>Tambah produk</button
				>
				<p>Total: {rupiah(cartTotal)}</p>
				<label
					>Pembayaran
					<select name="payment" bind:value={payment}>
						<option value="tunai">Tunai</option>
						<option value="qris">QRIS</option>
					</select>
				</label>
				{#if payment === 'tunai'}
					<label
						>Uang diterima (Rp) <input name="cash" type="number" min="0" step="1" required /></label
					>
				{:else}
					<label
						><input type="checkbox" name="qrisConfirmed" value="yes" required /> Dana sudah saya periksa
						di aplikasi pembayaran.</label
					>
				{/if}
				<button type="submit" class="btn-brand-primary" disabled={!hydrated || !cartReady}
					>Catat Pembayaran</button
				>
			</form>
		{:else}
			<p>Katalog kios belum tersedia atau kedaluwarsa.</p>
		{/if}
		<form method="POST" action="?/close" class="my-4 grid gap-2 print:hidden">
			<input type="hidden" name="id" value={data.user.shiftStatus.id} />
			<label
				><input type="checkbox" name="confirm" value="yes" required /> Saya ingin menutup shift untuk
				cabang ini.</label
			>
			{#if data.user.pinRequired}<label
					>PIN toko <input
						type="password"
						name="pin"
						inputmode="numeric"
						pattern={'[0-9]{4}'}
						maxlength="4"
						autocomplete="off"
						required
					/></label
				>{/if}
			<button type="submit" class="btn-brand-primary">Tutup Toko</button>
		</form>
	{:else if data.user.shiftStatus.state === 'uninitialized'}
		<p class="mt-4">Cabang belum dialihkan ke mode operasional.</p>
	{:else if data.user.shiftStatus.state === 'policy-blocked'}
		<p class="mt-4">Izin buka toko belum terverifikasi.</p>
	{:else if data.user.shiftStatus.state === 'unknown'}
		<p class="mt-4">Status kios belum diketahui.</p>
	{:else}
		<form method="POST" action="?/open" class="my-4 grid gap-2">
			<input type="hidden" name="id" value={data.operationId} />
			<label
				>Modal awal (Rp) <input
					required
					inputmode="numeric"
					pattern="[0-9]+"
					name="openingCash"
					autocomplete="off"
				/></label
			>
			{#if data.user.pinRequired}<label
					>PIN toko <input
						type="password"
						name="pin"
						inputmode="numeric"
						pattern={'[0-9]{4}'}
						maxlength="4"
						autocomplete="off"
						required
					/></label
				>{/if}
			<button class="btn-brand-primary" type="submit">Buka Toko</button>
		</form>
	{/if}
	<p role="status" class="print:hidden">{form?.message ?? ''}</p>
	{#if form?.receipt}
		<section aria-label="Struk kios" class="my-4 border p-4">
			<h2 class="font-bold">Struk ZatiarasPOS · {data.user.branch}</h2>
			{#if typeof form.orderNumber === 'number'}<p>Nomor pesanan: {form.orderNumber}</p>{/if}
			<p>ID: {form.receiptId}</p>
			<p>{form.receipt.committed_at}</p>
			<ul>
				{#each form.receipt.items as item}
					<li>{item.jumlah} × {item.nama} · {rupiah(item.nominal)}</li>
				{/each}
			</ul>
			<p>Total: {rupiah(form.receipt.total_amount)}</p>
			<p>Pembayaran: {form.receipt.metode_bayar === 'tunai' ? 'Tunai' : 'QRIS (dicatat kasir)'}</p>
			{#if form.receipt.metode_bayar === 'tunai' && form.receipt.change !== null}
				<p>Kembalian: {rupiah(form.receipt.change)}</p>
			{/if}
			<button type="button" class="btn-brand-primary print:hidden" onclick={() => window.print()}
				>Cetak Struk</button
			>
		</section>
	{/if}
	<a href="/operasional" data-sveltekit-reload class="underline">Perbarui status kios</a>
	<button type="button" class="btn-brand-primary mt-4" disabled={busy} onclick={logout}
		>Keluar</button
	>
	<p role="status">{message}</p>
</main>
