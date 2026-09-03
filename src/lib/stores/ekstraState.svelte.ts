import { createEkstraCrud } from '$lib/services/manajemenmenuCrud';
import { formatRupiah, parseRupiah } from '$lib/utils/currency';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { convertToBaseUnit } from '$lib/utils/unitConversion';
import type { AddOn, Ingredient } from '$lib/types/product';

interface EkstraDeps {
	showNotif: (msg: string, type: string) => void;
	afterUpdate: () => Promise<void>;
	getBahanList: () => Ingredient[];
}

export function createEkstraState(deps: EkstraDeps) {
	const ekstraCrud = createEkstraCrud();

	let ekstraList = $state<(AddOn & { harga: number })[]>([]);
	let ekstraForm = $state({
		nama: '',
		harga: '',
		bahan_id: '',
		jumlah_bahan: '',
		satuan_resep: ''
	});
	let showEkstraForm = $state(false);
	let editEkstraId = $state<string | number | null>(null);
	let showDeleteEkstraModal = $state(false);
	let ekstraIdToDelete = $state<string | number | null>(null);
	let searchEkstra = $state('');
	let isLoadingEkstra = $state(true);

	async function fetchEkstra() {
		isLoadingEkstra = true;
		try {
			ekstraList = await ekstraCrud.load();
		} catch (error) {
			const e = error as Error;
			deps.showNotif('Gagal mengambil data ekstra: ' + (e?.message || 'Unknown error'), 'error');
		}
		isLoadingEkstra = false;
	}

	function openEkstraForm(ekstra: (AddOn & { harga: number }) | null = null) {
		showEkstraForm = true;
		if (ekstra) {
			editEkstraId = ekstra.id;
			ekstraForm.nama = ekstra.nama;
			ekstraForm.harga = formatRupiah(ekstra.harga);
			ekstraForm.bahan_id = ekstra.bahan_id ? String(ekstra.bahan_id) : '';
			ekstraForm.jumlah_bahan =
				ekstra.jumlah_bahan !== null && ekstra.jumlah_bahan !== undefined
					? String(ekstra.jumlah_bahan)
					: '';
			ekstraForm.satuan_resep = ekstra.satuan_resep || '';
		} else {
			editEkstraId = null;
			ekstraForm.nama = '';
			ekstraForm.harga = '';
			ekstraForm.bahan_id = '';
			ekstraForm.jumlah_bahan = '';
			ekstraForm.satuan_resep = '';
		}
	}

	function closeEkstraForm() {
		showEkstraForm = false;
		editEkstraId = null;
		ekstraForm = {
			nama: '',
			harga: '',
			bahan_id: '',
			jumlah_bahan: '',
			satuan_resep: ''
		};
	}

	async function saveEkstra() {
		if (!ekstraForm.nama.trim()) {
			deps.showNotif('Nama ekstra wajib diisi', 'warning');
			return;
		}
		const harga = parseRupiah(ekstraForm.harga);
		if (isNaN(harga) || harga <= 0) {
			deps.showNotif('Harga wajib diisi dan harus lebih dari 0', 'warning');
			return;
		}

		let bahan_id: string | null = null;
		let jumlah_bahan: number | null = null;
		let satuan_resep: string | null = null;
		let jumlah_dasar_per_item: number | null = null;

		if (ekstraForm.bahan_id) {
			bahan_id = String(ekstraForm.bahan_id);
			const bahan = deps.getBahanList().find((b) => String(b.id) === bahan_id);
			jumlah_bahan = parseFloat(ekstraForm.jumlah_bahan) || 0;
			satuan_resep = ekstraForm.satuan_resep || bahan?.satuan || 'gram';
			const baseUnit = bahan?.satuan || 'gram';
			const packSize = bahan?.isi_per_kemasan || 1;
			jumlah_dasar_per_item = convertToBaseUnit(jumlah_bahan, satuan_resep, baseUnit, packSize);
		}

		try {
			await ekstraCrud.save(
				{
					nama: ekstraForm.nama,
					harga,
					bahan_id,
					jumlah_bahan,
					satuan_resep,
					jumlah_dasar_per_item
				},
				editEkstraId
			);
			await fetchEkstra();
			showEkstraForm = false;
			ekstraForm = {
				nama: '',
				harga: '',
				bahan_id: '',
				jumlah_bahan: '',
				satuan_resep: ''
			};
			editEkstraId = null;
		} catch (error) {
			deps.showNotif('Gagal menyimpan ekstra: ' + ErrorHandler.extractErrorMessage(error), 'error');
		}
		await deps.afterUpdate();
	}

	function confirmDeleteEkstra(id: string | number) {
		ekstraIdToDelete = id;
		showDeleteEkstraModal = true;
	}

	async function doDeleteEkstra() {
		if (ekstraIdToDelete !== null) {
			await ekstraCrud.remove(ekstraIdToDelete);
			showDeleteEkstraModal = false;
			ekstraIdToDelete = null;
			await fetchEkstra();
			await deps.afterUpdate();
		}
	}

	function cancelDeleteEkstra() {
		showDeleteEkstraModal = false;
		ekstraIdToDelete = null;
	}

	return {
		get ekstraList() {
			return ekstraList;
		},
		get ekstraForm() {
			return ekstraForm;
		},
		set ekstraForm(v) {
			ekstraForm = v;
		},
		get showEkstraForm() {
			return showEkstraForm;
		},
		get editEkstraId() {
			return editEkstraId;
		},
		get showDeleteEkstraModal() {
			return showDeleteEkstraModal;
		},
		get searchEkstra() {
			return searchEkstra;
		},
		set searchEkstra(v) {
			searchEkstra = v;
		},
		get isLoadingEkstra() {
			return isLoadingEkstra;
		},
		fetchEkstra,
		openEkstraForm,
		closeEkstraForm,
		saveEkstra,
		confirmDeleteEkstra,
		doDeleteEkstra,
		cancelDeleteEkstra
	};
}
