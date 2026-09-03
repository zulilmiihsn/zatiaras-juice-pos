/**
 * Shared service for sesi_toko (store session) queries.
 * All DB access via per-resource route /api/sesi-toko.
 */

import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import type { TokoSession } from '$lib/types/store';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';

const branch = () => selectedBranch.value || 'default';
const ACTIVE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedActiveSession {
	session: TokoSession;
	expiresAt: number;
}

function activeSessionKey() {
	return `active_store_session_${branch()}`;
}

function getCachedActiveSession(): TokoSession | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = localStorage.getItem(activeSessionKey());
		if (!raw) return null;
		const cached = JSON.parse(raw) as CachedActiveSession;
		if (
			!cached.session?.is_active ||
			!Number.isFinite(cached.expiresAt) ||
			cached.expiresAt <= Date.now()
		) {
			localStorage.removeItem(activeSessionKey());
			return null;
		}
		return cached.session;
	} catch {
		localStorage.removeItem(activeSessionKey());
		return null;
	}
}

function cacheActiveSession(session: TokoSession | null): void {
	if (typeof window === 'undefined') return;
	if (!session?.is_active) {
		localStorage.removeItem(activeSessionKey());
		return;
	}
	localStorage.setItem(
		activeSessionKey(),
		JSON.stringify({ session, expiresAt: Date.now() + ACTIVE_SESSION_TTL_MS })
	);
}

export async function getSesiAktif(): Promise<TokoSession | null> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return getCachedActiveSession();
	const qs = new URLSearchParams({ branch: branch() }).toString();
	try {
		const res = await fetch(`/api/sesi-toko?${qs}`);
		if (!res.ok) return null;
		const rows: TokoSession[] = await res.json();
		const active =
			rows
				.filter((r) => r.is_active)
				.sort((a, b) => new Date(b.waktu_buka).getTime() - new Date(a.waktu_buka).getTime())[0] ||
			null;
		cacheActiveSession(active);
		return active;
	} catch {
		return typeof navigator !== 'undefined' && !navigator.onLine ? getCachedActiveSession() : null;
	}
}

export async function bukaToko(openingCash: number, openingTime: string): Promise<void> {
	const response = await fetchWithCsrfRetry('/api/sesi-toko', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			branch: branch(),
			payload: {
				id: crypto.randomUUID(),
				kas_awal: openingCash,
				waktu_buka: openingTime,
				is_active: true
			}
		})
	});
	if (!response.ok) throw new Error(`Gagal membuka toko: HTTP ${response.status}`);
	await getSesiAktif();
}

export async function tutupToko(sesiId: string, closingTime: string): Promise<void> {
	const response = await fetchWithCsrfRetry('/api/sesi-toko', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			branch: branch(),
			where: { id: sesiId },
			payload: { waktu_tutup: closingTime, is_active: false }
		})
	});
	if (!response.ok) throw new Error(`Gagal menutup toko: HTTP ${response.status}`);
	cacheActiveSession(null);
}
