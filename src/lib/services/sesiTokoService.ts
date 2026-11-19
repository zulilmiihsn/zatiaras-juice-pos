/**
 * Shared service for sesi_toko (store session) queries.
 * All DB access via per-resource route /api/sesi-toko.
 */

import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import type { TokoSession } from '$lib/types/store';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { MS_PER_DAY } from '$lib/constants/time';

const branch = () => selectedBranch.value || 'default';
const ACTIVE_SESSION_TTL_MS = MS_PER_DAY;

interface CachedActiveSession {
	session: TokoSession;
	expiresAt: number;
}

function activeSessionKey(storeBranch: string) {
	return `active_store_session_${storeBranch}`;
}

function getCachedActiveSession(storeBranch: string): TokoSession | null {
	if (typeof window === 'undefined') return null;
	const key = activeSessionKey(storeBranch);
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const cached = JSON.parse(raw) as CachedActiveSession;
		if (
			!cached.session?.is_active ||
			!Number.isFinite(cached.expiresAt) ||
			cached.expiresAt <= Date.now()
		) {
			localStorage.removeItem(key);
			return null;
		}
		return cached.session;
	} catch {
		localStorage.removeItem(key);
		return null;
	}
}

function cacheActiveSession(storeBranch: string, session: TokoSession | null): void {
	if (typeof window === 'undefined') return;
	const key = activeSessionKey(storeBranch);
	if (!session?.is_active) {
		localStorage.removeItem(key);
		return;
	}
	localStorage.setItem(
		key,
		JSON.stringify({ session, expiresAt: Date.now() + ACTIVE_SESSION_TTL_MS })
	);
}

export async function getSesiAktif(): Promise<TokoSession | null> {
	const storeBranch = branch();
	const epoch = selectedBranch.contextEpoch;
	const fallback = () =>
		epoch === selectedBranch.contextEpoch ? getCachedActiveSession(storeBranch) : null;
	if (typeof navigator !== 'undefined' && !navigator.onLine) return fallback();
	const qs = new URLSearchParams({ branch: storeBranch }).toString();
	try {
		const res = await fetch(`/api/sesi-toko?${qs}`).catch((error: unknown) => {
			if (error instanceof TypeError) return null;
			throw error;
		});
		if (!res) return fallback();
		if (!res.ok) return null;
		const rows: TokoSession[] = await res.json();
		// A switch away and back still invalidates an earlier read.
		if (epoch !== selectedBranch.contextEpoch) return null;
		const active =
			rows
				.filter((r) => r.is_active)
				.sort((a, b) => new Date(b.waktu_buka).getTime() - new Date(a.waktu_buka).getTime())[0] ||
			null;
		cacheActiveSession(storeBranch, active);
		return active;
	} catch {
		return typeof navigator !== 'undefined' && !navigator.onLine ? fallback() : null;
	}
}

export interface SesiSummary {
	id: string;
	modalAwal: number;
	totalPemasukan: number;
	pemasukanTunai: number;
	pemasukanNonTunai: number;
	pengeluaranTunai: number;
	uangKasir: number;
	baris: number;
}

export async function getSesiSummary(sesiId: string): Promise<SesiSummary | null> {
	const qs = new URLSearchParams({ branch: branch(), summary: '1', id: sesiId }).toString();
	try {
		const res = await fetch(`/api/sesi-toko?${qs}`);
		if (!res.ok) return null;
		return (await res.json()) as SesiSummary;
	} catch {
		return null;
	}
}

export async function bukaToko(openingCash: number, openingTime: string): Promise<void> {
	const storeBranch = branch();
	const epoch = selectedBranch.contextEpoch;
	const response = await fetchWithCsrfRetry('/api/sesi-toko', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			branch: storeBranch,
			payload: {
				id: crypto.randomUUID(),
				kas_awal: openingCash,
				waktu_buka: openingTime,
				is_active: true
			}
		})
	});
	if (!response.ok) {
		const detail = await response.json().catch(() => null);
		const message =
			detail && typeof detail.message === 'string' && detail.message
				? detail.message
				: `Gagal membuka toko: HTTP ${response.status}`;
		throw new Error(message);
	}
	if (epoch === selectedBranch.contextEpoch) await getSesiAktif();
}

export async function tutupToko(sesiId: string, closingTime: string): Promise<void> {
	const storeBranch = branch();
	const response = await fetchWithCsrfRetry('/api/sesi-toko', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			branch: storeBranch,
			where: { id: sesiId },
			payload: { waktu_tutup: closingTime, is_active: false }
		})
	});
	if (!response.ok) throw new Error(`Gagal menutup toko: HTTP ${response.status}`);
	cacheActiveSession(storeBranch, null);
}
