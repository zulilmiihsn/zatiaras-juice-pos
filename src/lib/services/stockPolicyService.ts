export type StockPolicyMode = 'tracked' | 'ignored';

export interface BranchStockPolicy {
	mode: StockPolicyMode;
	revision: number;
	disabled_at: string | null;
	reconciled_at: string | null;
	updated_at: string | null;
	can_manage_policy: boolean;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
	try {
		const payload = (await response.json()) as { message?: unknown; error?: unknown };
		if (typeof payload?.message === 'string' && payload.message) return payload.message;
		if (typeof payload?.error === 'string' && payload.error) return payload.error;
	} catch {
		// Abaikan body non-JSON; pakai fallback.
	}
	return `${fallback} (HTTP ${response.status})`;
}

export async function fetchStockPolicy(branch?: string): Promise<BranchStockPolicy> {
	const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
	const response = await fetch(`/api/pengaturan/stok${qs}`, {
		headers: { Accept: 'application/json' },
		cache: 'no-store'
	});
	if (!response.ok) throw new Error(await parseApiError(response, 'Gagal memuat pengaturan stok'));
	const payload = (await response.json()) as { ok?: boolean; data?: BranchStockPolicy };
	if (
		!payload?.ok ||
		!payload.data ||
		(payload.data.mode !== 'tracked' && payload.data.mode !== 'ignored')
	) {
		throw new Error('Respons pengaturan stok tidak valid');
	}
	return payload.data;
}

export async function updateStockPolicy(input: {
	branch: string;
	expected_revision: number;
	mode: StockPolicyMode;
}): Promise<BranchStockPolicy> {
	const { fetchWithCsrfRetry } = await import('$lib/utils/csrf');
	const response = await fetchWithCsrfRetry('/api/pengaturan/stok', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!response.ok)
		throw new Error(await parseApiError(response, 'Gagal mengubah pengaturan stok'));
	const payload = (await response.json()) as { ok?: boolean; data?: BranchStockPolicy };
	if (!payload?.ok || !payload.data) throw new Error('Respons pengaturan stok tidak valid');
	return { ...payload.data, can_manage_policy: true };
}
