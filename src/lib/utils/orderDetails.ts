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

function formatOption(kind: 'gula' | 'es', value?: string | null): string | null {
	if (!value || value === 'normal') return null;
	return ORDER_OPTION_LABELS[kind][value] || value;
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
