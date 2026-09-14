import { error as kitError } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { AuthSession } from '$lib/server/sessionStore';

export const PROTECTED_PAGES = ['beranda', 'laporan', 'pengaturan', 'catat'] as const;
export type ProtectedPage = (typeof PROTECTED_PAGES)[number];

export function isProtectedPage(value: unknown): value is ProtectedPage {
	return typeof value === 'string' && PROTECTED_PAGES.includes(value as ProtectedPage);
}

export function parsePageList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
	if (typeof value !== 'string' || !value.trim()) return [];
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed)) throw new Error('Daftar halaman tidak valid');
	return parsed.filter((item): item is string => typeof item === 'string');
}

export async function requirePageAccess(
	rawDb: D1Database,
	session: AuthSession,
	page: ProtectedPage
): Promise<void> {
	if (session.role === 'pemilik' || session.role === 'admin') return;

	const settings = (await rawDb
		.prepare('SELECT pin, pin_hash, halaman_terkunci FROM pengaturan WHERE cabang_id = ? LIMIT 1')
		.bind(session.branch)
		.first()) as {
		pin?: string | null;
		pin_hash?: string | null;
		halaman_terkunci?: unknown;
	} | null;

	if (!settings) return;

	const pinConfigured = Boolean(settings.pin_hash || (settings.pin && settings.pin !== '1234'));
	if (!pinConfigured) {
		// PIN belum dikonfigurasi pemilik: auto-bypass agar operasional kasir tidak terblokir
		return;
	}

	let lockedPages: string[];
	try {
		lockedPages = parsePageList(settings.halaman_terkunci);
	} catch {
		throw kitError(500, 'Konfigurasi halaman terkunci tidak valid');
	}
	if (!lockedPages.includes(page)) return;

	if (
		Number(session.unlockExpiresAt || 0) > Date.now() &&
		(session.unlockedPages || []).includes(page)
	) {
		return;
	}

	throw kitError(403, 'PIN_REQUIRED');
}
