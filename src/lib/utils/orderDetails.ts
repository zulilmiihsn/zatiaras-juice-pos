type OrderCustomization = {
	gula?: string | null;
	es?: string | null;
	catatan?: string | null;
};

export const ORDER_OPTION_LABELS: Record<'gula' | 'es', Record<string, string>> = {
	gula: {
		no: 'Tanpa Gula',
		less: 'Sedikit Gula',
		normal: 'Normal'
	},
	es: {
		no: 'Tanpa Es',
		less: 'Sedikit Es',
		normal: 'Normal'
	}
};

export const SUGAR_OPTIONS = Object.entries(ORDER_OPTION_LABELS.gula).map(([id, label]) => ({
	id,
	label
}));

export const ICE_OPTIONS = Object.entries(ORDER_OPTION_LABELS.es).map(([id, label]) => ({
	id,
	label
}));

/**
 * Alias nilai lama (sebelum kosakata no/less/normal dibakukan) ke kunci kanonik.
 * Tampilan tidak pernah menghilangkan data: kunci tak dikenal lolos apa adanya.
 */
const LEGACY_ALIASES: Record<'gula' | 'es', Record<string, 'less' | 'no'>> = {
	gula: { kurang: 'less', sedikit: 'less', tanpa: 'no' },
	es: { kurang: 'less', sedikit: 'less', tanpa: 'no' }
};

/**
 * Label Indonesia untuk satu level gula/es. Null = level normal/tidak diisi
 * (disembunyikan seperti perilaku lama). Satu-satunya sumber label tampil;
 * dipakai chip Antrean, struk HTML/ESC-POS, dan ringkasan bayar.
 */
export function formatLevelLabel(kind: 'gula' | 'es', value?: string | null): string | null {
	if (value == null) return null;
	const key = value.trim().toLowerCase();
	if (!key || key === 'normal') return null;
	const canonical = LEGACY_ALIASES[kind][key] ?? key;
	return ORDER_OPTION_LABELS[kind][canonical] ?? value.trim();
}

function formatOption(kind: 'gula' | 'es', value?: string | null): string | null {
	return formatLevelLabel(kind, value);
}

export function formatOrderDetails(item: OrderCustomization): string {
	return [
		formatOption('gula', item.gula),
		formatOption('es', item.es),
		item.catatan?.trim() || null
	]
		.filter((value): value is string => Boolean(value))
		.join(', ');
}
