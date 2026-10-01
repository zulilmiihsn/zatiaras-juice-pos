<script lang="ts">
	import { formatNomorHarian } from '$lib/utils/orderNumber';

	interface Props {
		/** Nomor antrean harian resmi. Null = belum ada (legacy atau menunggu sinkron). */
		nomor?: number | null;
		/** True = tampilkan penanda menunggu sinkron bila nomor belum ada. */
		menunggu?: boolean;
		/** Kelas untuk label nomor resmi. */
		kelas?: string;
		/** Kelas untuk penanda menunggu (default ikut kelas). */
		kelasMenunggu?: string;
	}

	let { nomor = null, menunggu = false, kelas = '', kelasMenunggu = '' }: Props = $props();
	const tampil = $derived(formatNomorHarian(nomor));
</script>

{#if tampil}
	<div class={kelas} aria-label={`Nomor pesanan ${tampil}`}>{tampil}</div>
{:else if menunggu}
	<div
		class={kelasMenunggu || kelas}
		title="menunggu sinkronisasi"
		aria-label="Nomor pesanan menunggu sinkronisasi"
	>
		···
	</div>
{/if}
