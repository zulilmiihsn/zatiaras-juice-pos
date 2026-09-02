const browser = typeof window !== 'undefined';
import type { TaxSettings, TaxCalculationResult, TaxItemBreakdown } from '$lib/types/pajak';

export const TAX_STORAGE_KEY = 'zatiara_tax_settings';

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
	isTaxEnabled: true,
	taxes: [
		{
			id: 'pph_final_umkm',
			nama: 'PPh Final UMKM',
			tipe: 'pph_final',
			persentase: 0.5,
			isEnabled: true,
			deskripsi: 'Pajak Penghasilan UMKM 0,5% dari omzet bruto usaha (PP 55/2022).',
			useThreshold500Juta: false
		},
		{
			id: 'pbjt_makanan_minuman',
			nama: 'PBJT / PB1 Restoran & Kafe',
			tipe: 'pbjt_restoran',
			persentase: 10,
			isEnabled: false,
			deskripsi:
				'Pajak daerah makanan/minuman (UU HKPD No. 1/2022). Tarif standar 10% atau sesuai Perda.'
		},
		{
			id: 'ppn_pkp',
			nama: 'PPN (Pajak Pertambahan Nilai)',
			tipe: 'ppn',
			persentase: 11,
			isEnabled: false,
			deskripsi: 'Pajak pertambahan nilai 11% khusus Wajib Pajak yang telah dikukuhkan sebagai PKP.'
		}
	]
};

/**
 * Memuat konfigurasi pajak dari localStorage (per branch) atau default
 */
export function getTaxSettings(branch?: string): TaxSettings {
	if (!browser) {
		return DEFAULT_TAX_SETTINGS;
	}

	try {
		const targetBranch = (
			branch ||
			localStorage.getItem('selectedBranch') ||
			'samarinda'
		).toLowerCase();
		const raw =
			localStorage.getItem(`zatiaras_tax_settings_${targetBranch}`) ||
			localStorage.getItem(TAX_STORAGE_KEY);
		if (!raw) {
			return DEFAULT_TAX_SETTINGS;
		}
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.taxes)) {
			return DEFAULT_TAX_SETTINGS;
		}

		// Pastikan semua field valid dan gabungkan jika ada preset baru
		return {
			isTaxEnabled: typeof parsed.isTaxEnabled === 'boolean' ? parsed.isTaxEnabled : true,
			taxes: parsed.taxes.map((t: any) => ({
				id: String(t.id || `tax_${Date.now()}`),
				nama: String(t.nama || 'Pajak Kustom'),
				tipe: t.tipe || 'custom',
				persentase: typeof t.persentase === 'number' && !isNaN(t.persentase) ? t.persentase : 0,
				isEnabled: Boolean(t.isEnabled),
				deskripsi: t.deskripsi ? String(t.deskripsi) : undefined,
				useThreshold500Juta: Boolean(t.useThreshold500Juta)
			}))
		};
	} catch {
		return DEFAULT_TAX_SETTINGS;
	}
}

/**
 * Menyimpan konfigurasi pajak ke localStorage (per branch)
 */
export function saveTaxSettings(settings: TaxSettings, branch?: string): boolean {
	if (!browser) return false;
	try {
		const targetBranch = (
			branch ||
			localStorage.getItem('selectedBranch') ||
			'samarinda'
		).toLowerCase();
		localStorage.setItem(`zatiaras_tax_settings_${targetBranch}`, JSON.stringify(settings));
		localStorage.setItem(TAX_STORAGE_KEY, JSON.stringify(settings));
		// Dispatch storage event untuk listener lokal
		window.dispatchEvent(
			new CustomEvent('zatiara:tax_settings_updated', {
				detail: { settings, branch: targetBranch }
			})
		);
		return true;
	} catch (e) {
		console.error('[taxService] Gagal menyimpan pengaturan pajak:', e);
		return false;
	}
}

/**
 * Hitung kalkulasi pajak berdasarkan pendapatan bruto, laba kotor, dan omzet kumulatif YTD
 * @param pendapatanBruto Total pendapatan kotor/omzet periode ini
 * @param labaKotor Laba kotor (Omzet - Pengeluaran) periode ini
 * @param customSettings Optional settings override
 * @param cumulativeTurnoverYtd Optional omzet kumulatif YTD hingga akhir periode terpilih
 */
export function calculateTaxes(
	pendapatanBruto: number,
	labaKotor: number,
	customSettings?: TaxSettings,
	cumulativeTurnoverYtd?: number
): TaxCalculationResult {
	const settings = customSettings || getTaxSettings();

	if (!settings.isTaxEnabled) {
		return {
			isTaxEnabled: false,
			totalPajak: 0,
			labaKotor,
			labaBersih: labaKotor,
			breakdowns: [],
			activeTaxesLabel: 'Pajak Dinonaktifkan (0%)'
		};
	}

	const activeTaxes = settings.taxes.filter((t) => t.isEnabled && t.persentase > 0);

	if (activeTaxes.length === 0) {
		return {
			isTaxEnabled: true,
			totalPajak: 0,
			labaKotor,
			labaBersih: labaKotor,
			breakdowns: [],
			activeTaxesLabel: 'Tidak Ada Pajak Aktif (0%)'
		};
	}

	const breakdowns: TaxItemBreakdown[] = [];
	let totalPajak = 0;

	for (const tax of activeTaxes) {
		let dpp = Math.max(0, pendapatanBruto);
		let keterangan = `${tax.persentase}% dari Omzet (Rp ${dpp.toLocaleString('id-ID')})`;

		// Khusus PPh Final dengan threshold 500 juta / tahun WP OP (PP 55/2022)
		if (tax.tipe === 'pph_final' && tax.useThreshold500Juta) {
			const ytdEnd = cumulativeTurnoverYtd != null ? Math.max(dpp, cumulativeTurnoverYtd) : dpp;
			const ytdBefore = Math.max(0, ytdEnd - dpp);
			const taxableEnd = Math.max(0, ytdEnd - 500_000_000);
			const taxableBefore = Math.max(0, ytdBefore - 500_000_000);
			dpp = Math.min(dpp, Math.max(0, taxableEnd - taxableBefore));

			if (dpp === 0) {
				keterangan = `Bebas PPh Final (Omzet YTD Rp ${ytdEnd.toLocaleString('id-ID')} ≤ Rp 500 Juta/th)`;
			} else {
				keterangan = `${tax.persentase}% dari Omzet kena pajak periode ini (Rp ${dpp.toLocaleString('id-ID')} setelah fasilitas YTD Rp 500 Juta)`;
			}
		}

		const nominal = Math.round(dpp * (tax.persentase / 100));

		breakdowns.push({
			id: tax.id,
			nama: tax.nama,
			tipe: tax.tipe,
			persentase: tax.persentase,
			nominalPajak: nominal,
			dasarPengenaan: dpp,
			keterangan
		});

		totalPajak += nominal;
	}

	const labaBersih = labaKotor - totalPajak;

	// Buat label ringkas pajak aktif
	let activeTaxesLabel = '';
	if (activeTaxes.length === 1) {
		activeTaxesLabel = `${activeTaxes[0].nama} (${activeTaxes[0].persentase}%)`;
	} else {
		const percentSum = activeTaxes.reduce((sum, t) => sum + t.persentase, 0);
		const taxNames = activeTaxes
			.map((t) => `${t.nama.split('(')[0].trim()} ${t.persentase}%`)
			.join(', ');
		activeTaxesLabel = `Total Pajak ${percentSum}% (${taxNames})`;
	}

	return {
		isTaxEnabled: true,
		totalPajak,
		labaKotor,
		labaBersih,
		breakdowns,
		activeTaxesLabel
	};
}
