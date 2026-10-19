<script lang="ts">
	import { untrack } from 'svelte';
	import { createBayarState } from '$lib/stores/bayarState.svelte';
	import { createCatatState } from '$lib/stores/catatState.svelte';

	let {
		emptyCart = false,
		customerName = 'Ayu',
		paymentMethod = 'qris',
		quantity = 2,
		portion = 'reguler',
		jumboPrice = null,
		catatMode = 'pengeluaran',
		repeatMode = false
	}: {
		emptyCart?: boolean;
		customerName?: string;
		paymentMethod?: string;
		quantity?: number;
		portion?: 'reguler' | 'jumbo';
		jumboPrice?: number | null;
		catatMode?: 'pemasukan' | 'pengeluaran';
		repeatMode?: boolean;
	} = $props();
	// Setiap render menguji satu snapshot input, bukan pembaruan prop pada komponen hidup.
	const fixture = untrack(() => ({
		emptyCart,
		customerName,
		paymentMethod,
		quantity,
		portion,
		jumboPrice,
		catatMode,
		repeatMode
	}));

	const bayar = createBayarState();
	bayar.cart = fixture.emptyCart
		? []
		: [
				{
					product: {
						id: 'produk-1',
						nama: 'Jus Mangga',
						harga: 10_000,
						harga_jumbo: fixture.jumboPrice,
						tipe: 'minuman'
					},
					jumlah: fixture.quantity,
					porsi: fixture.portion,
					addOns: [{ id: 'tambahan-1', nama: 'Jelly', harga: 2_000 }],
					gula: 'normal',
					es: 'normal',
					catatan: ''
				}
			];
	bayar.customerName = fixture.customerName;
	bayar.paymentMethod = fixture.paymentMethod;
	const onlineCanPay = bayar.canPay;
	const totalHarga = bayar.totalHarga;
	bayar.setOffline(true);
	bayar.setExactCash();

	const catat = createCatatState();
	if (fixture.catatMode === 'pemasukan') catat.handleSetPengeluaran();
	catat.nama = 'Belanja bahan';
	catat.paymentMethod = 'non-tunai';
	if (fixture.catatMode === 'pengeluaran') catat.handleSetPengeluaran();
	else catat.handleSetPemasukan();
	if (fixture.repeatMode) {
		catat.nama = 'Catatan dipertahankan';
		if (fixture.catatMode === 'pengeluaran') catat.handleSetPengeluaran();
		else catat.handleSetPemasukan();
	}
</script>

<output
	data-total={totalHarga}
	data-online-can-pay={onlineCanPay}
	data-offline-method={bayar.paymentMethod}
	data-offline-can-pay={bayar.canPay}
	data-cash={bayar.cashReceived}
	data-change={bayar.kembalian}
	data-mode={catat.mode}
	data-category={catat.jenis}
	data-name={catat.nama}
></output>
