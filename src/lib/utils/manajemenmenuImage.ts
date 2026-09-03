import { fetchWithCsrfRetry } from '$lib/utils/csrf';

export async function readImageFile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(reader.error || new Error('Gagal membaca gambar'));
		reader.readAsDataURL(file);
	});
}

export async function uploadMenuImageFromDataUrl(
	dataUrl: string,
	menuId: string | number
): Promise<string> {
	const blob = await (await fetch(dataUrl)).blob();
	const file = new File([blob], `menu-${menuId}-${Date.now()}.jpg`, { type: 'image/jpeg' });
	const formData = new FormData();
	formData.append('file', file);
	const response = await fetchWithCsrfRetry('/api/upload', { method: 'POST', body: formData });
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new Error(error.error || 'Gagal mengunggah gambar');
	}
	const data = await response.json();
	return data.url;
}

const OUTBOX_STORAGE_KEY = 'zatiaras_r2_delete_outbox';

export function getR2CleanupOutbox(): string[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

export function queueR2Cleanup(key: string): void {
	if (typeof window === 'undefined') return;
	try {
		const outbox = getR2CleanupOutbox();
		if (!outbox.includes(key)) {
			outbox.push(key);
			localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(outbox));
		}
	} catch {}
}

export async function processR2CleanupOutbox(): Promise<void> {
	if (typeof window === 'undefined') return;
	const outbox = getR2CleanupOutbox();
	if (outbox.length === 0) return;
	const remaining: string[] = [];
	for (const key of outbox) {
		try {
			const res = await fetchWithCsrfRetry('/api/upload', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key })
			});
			if (!res.ok && res.status !== 404 && res.status !== 400) {
				remaining.push(key);
			}
		} catch {
			remaining.push(key);
		}
	}
	try {
		localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(remaining));
	} catch {}
}

export function extractProductImageKey(imageUrl: string): string | null {
	if (!imageUrl || typeof imageUrl !== 'string') return null;
	const clean = imageUrl.trim();
	const match = /produk\/([a-z0-9_-]+\/[0-9a-f-]+\.[a-z0-9]+)/i.exec(clean);
	if (match) {
		return `produk/${match[1]}`;
	}
	const legacyMatch = /produk\/([0-9a-f-]+\.[a-z0-9]+)/i.exec(clean);
	if (legacyMatch) {
		return `produk/${legacyMatch[1]}`;
	}
	return null;
}

export async function deleteMenuImage(imageUrl?: string): Promise<void> {
	if (!imageUrl) return;
	const key = extractProductImageKey(imageUrl);
	if (!key) return;

	try {
		const res = await fetchWithCsrfRetry('/api/upload', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key })
		});
		if (!res.ok && res.status !== 404) {
			queueR2Cleanup(key);
		}
	} catch {
		queueR2Cleanup(key);
	}

	void processR2CleanupOutbox();
}
