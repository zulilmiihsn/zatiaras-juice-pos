const SESSION_STORAGE_KEY = 'zatiaras_session';
const SESSION_REVISION_KEY = 'zatiaras_session_revision';

/** Shared across tabs; late validation/IndexedDB work must not resurrect a cleared session. */
export function getOfflineSessionRevision(storage: StorageLike = localStorage): string | null {
	return storage.getItem(SESSION_REVISION_KEY);
}

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface OfflineSessionSnapshot {
	isAuthenticated: true;
	user: Record<string, unknown>;
	expiresAt: number;
	token: null;
}

export function readOfflineSessionSnapshot(
	storage: StorageLike = localStorage,
	now = Date.now()
): OfflineSessionSnapshot | null {
	try {
		const raw = storage.getItem(SESSION_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const user = parsed.user;
		const expiresAt = Number(parsed.expiresAt);
		if (
			parsed.isAuthenticated !== true ||
			!user ||
			typeof user !== 'object' ||
			Array.isArray(user) ||
			!Number.isFinite(expiresAt) ||
			expiresAt <= now
		) {
			return null;
		}
		return {
			isAuthenticated: true,
			user: user as Record<string, unknown>,
			expiresAt,
			token: null
		};
	} catch {
		return null;
	}
}

export function persistOfflineSessionSnapshot(
	user: Record<string, unknown>,
	expiresAt: number,
	storage: StorageLike = localStorage
): OfflineSessionSnapshot {
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
		throw new Error('Masa berlaku sesi offline tidak valid');
	}
	const snapshot: OfflineSessionSnapshot = {
		isAuthenticated: true,
		user,
		expiresAt,
		token: null
	};
	storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
	return snapshot;
}

export function clearOfflineSessionSnapshot(storage: StorageLike = localStorage): void {
	storage.setItem(SESSION_REVISION_KEY, crypto.randomUUID());
	storage.removeItem(SESSION_STORAGE_KEY);
}

export function isOfflinePosPath(pathname: string): boolean {
	return pathname === '/pos' || pathname.startsWith('/pos/');
}

export function isOfflineAntreanPath(pathname: string): boolean {
	return pathname === '/antrean' || pathname.startsWith('/antrean/');
}

const VALID_OFFLINE_BRANCHES = new Set([
	'samarinda',
	'samarinda2',
	'balikpapan',
	'balikpapan2',
	'berau'
]);

/** Cabang tervalidasi dari snapshot sesi offline; null bila tak ada/kedaluwarsa/invalid. */
export function getOfflineSessionBranch(snapshot: OfflineSessionSnapshot | null): string | null {
	if (!snapshot) return null;
	const raw = snapshot.user?.branch;
	const branch = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
	return branch && VALID_OFFLINE_BRANCHES.has(branch) ? branch : null;
}
