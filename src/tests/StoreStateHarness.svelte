<script lang="ts">
	import { createBayarState } from '$lib/stores/bayarState.svelte';
	import { createCatatState } from '$lib/stores/catatState.svelte';

	const bayar = createBayarState();
	bayar.cart = [
		{
			product: { id: 'produk-1', nama: 'Jus Mangga', harga: 10_000, tipe: 'minuman' },
			jumlah: 2,
			addOns: [{ id: 'tambahan-1', nama: 'Jelly', harga: 2_000 }],
			gula: 'normal',
			es: 'normal',
			catatan: ''
		}
	];
	bayar.customerName = 'Ayu';
	bayar.paymentMethod = 'qris';
	const onlineCanPay = bayar.canPay;
	const totalHarga = bayar.totalHarga;
	bayar.setOffline(true);

	const catat = createCatatState();
	catat.nama = 'Belanja bahan';
	catat.paymentMethod = 'non-tunai';
	catat.handleSetPengeluaran();
</script>

<output
	data-total={totalHarga}
	data-online-can-pay={onlineCanPay}
	data-offline-method={bayar.paymentMethod}
	data-mode={catat.mode}
	data-name={catat.nama}
></output>
