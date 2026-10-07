// Kebijakan kategori ledger kanonik (AUD-032).
// Arah saja (pemasukan/pengeluaran) TIDAK menentukan jenis usaha.
// Non-operasional (modal/prive/pinjaman) -> 'lainnya' agar tak masuk
// omzet usaha kena pajak. Ambigu -> konfirmasi eksplisit, bukan default diam.
export const LEDGER_JENIS = ['pendapatan_usaha', 'beban_usaha', 'lainnya'] as const;

export type LedgerJenis = (typeof LEDGER_JENIS)[number];

export const LEDGER_JENIS_LABEL: Record<LedgerJenis, string> = {
	pendapatan_usaha: 'Pendapatan Usaha',
	beban_usaha: 'Beban Usaha',
	lainnya: 'Lainnya (non-usaha)'
};

const MODAL_KEYWORDS = [
	'modal',
	'setor',
	'invest',
	'pinjam',
	'hibah',
	'deposit',
	'top up',
	'tambah dana',
	'isi kas',
	'isi modal',
	'investor',
	'tambah modal'
];

const PRIVE_KEYWORDS = [
	'prive',
	'pribadi',
	'ambil modal',
	'ambil keuntungan',
	'pengambilan keuntungan',
	'tarik modal'
];

function containsKeyword(text: string, keywords: string[]): boolean {
	const lowered = text.toLowerCase();
	return keywords.some((keyword) => lowered.includes(keyword));
}

export type CategoryResolution =
	{ jenis: LedgerJenis } | { needsConfirmation: true; reason: string };

export function resolveLedgerCategory(input: {
	type: unknown;
	category?: unknown;
	deskripsi?: unknown;
}): CategoryResolution {
	const type = String(input.type ?? '')
		.trim()
		.toLowerCase();
	const explicit = typeof input.category === 'string' ? input.category.trim() : '';
	if ((LEDGER_JENIS as readonly string[]).includes(explicit)) {
		return { jenis: explicit as LedgerJenis };
	}
	if (explicit !== '') {
		return {
			needsConfirmation: true,
			reason: `Kategori "${explicit}" tidak dikenal. Pilih Pendapatan Usaha, Beban Usaha, atau Lainnya.`
		};
	}
	const deskripsi = typeof input.deskripsi === 'string' ? input.deskripsi : '';
	if (type === 'pemasukan' && containsKeyword(deskripsi, MODAL_KEYWORDS)) {
		return { jenis: 'lainnya' };
	}
	if (type === 'pengeluaran' && containsKeyword(deskripsi, PRIVE_KEYWORDS)) {
		return { jenis: 'lainnya' };
	}
	return {
		needsConfirmation: true,
		reason:
			'Jenis akuntansi belum jelas dari rekomendasi. Konfirmasi manual: Pendapatan Usaha, Beban Usaha, atau Lainnya.'
	};
}
