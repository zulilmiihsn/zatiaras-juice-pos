const SESSION_STORAGE_KEY = 'zatiaras_session';

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
	storage.removeItem(SESSION_STORAGE_KEY);
}

export function isOfflinePosPath(pathname: string): boolean {
	return pathname === '/pos' || pathname.startsWith('/pos/');
}
