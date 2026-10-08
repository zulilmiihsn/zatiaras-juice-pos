// KENAPA: preset kulakan diurutkan dari frekuensi klik per browser agar pilihan
// yang paling sering dipakai muncul duluan; ranking ini best-effort dan tidak
// boleh menggagalkan update stok bila storage tidak tersedia atau rusak.
export const MUTATION_FREQUENCY_KEY = 'mutasi_click_freq';

export interface FrequencyStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function browserStorage(): FrequencyStorage | null {
	if (typeof window === 'undefined') return null;
	return window.localStorage;
}

export function readMutationFrequency(
	storage: FrequencyStorage | null = browserStorage()
): Record<string, number> {
	if (!storage) return {};
	try {
		const raw = storage.getItem(MUTATION_FREQUENCY_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as Record<string, number>;
	} catch {
		return {};
	}
}

export function recordMutationClick(
	key: string,
	storage: FrequencyStorage | null = browserStorage()
): void {
	if (!storage) return;
	try {
		const map = readMutationFrequency(storage);
		map[key] = (map[key] || 0) + 1;
		storage.setItem(MUTATION_FREQUENCY_KEY, JSON.stringify(map));
	} catch {
		// Best-effort usage ranking; unavailable browser storage must not block stock updates.
	}
}
