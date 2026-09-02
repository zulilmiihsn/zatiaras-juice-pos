export type TaxType = 'pph_final' | 'pbjt_restoran' | 'ppn' | 'custom';

export interface TaxItemConfig {
	id: string;
	nama: string;
	tipe: TaxType;
	persentase: number; // e.g. 0.5, 10, 11
	isEnabled: boolean;
	deskripsi?: string;
	useThreshold500Juta?: boolean; // Khusus PPh Final WP Orang Pribadi (omzet < 500jt/th bebas pajak)
}

export interface TaxSettings {
	isTaxEnabled: boolean; // Master toggle perhitungan pajak di laporan
	taxes: TaxItemConfig[];
}

export interface TaxItemBreakdown {
	id: string;
	nama: string;
	tipe: TaxType;
	persentase: number;
	nominalPajak: number;
	dasarPengenaan: number;
	keterangan?: string;
}

export interface TaxCalculationResult {
	isTaxEnabled: boolean;
	totalPajak: number;
	labaKotor: number;
	labaBersih: number;
	breakdowns: TaxItemBreakdown[];
	activeTaxesLabel: string;
}
