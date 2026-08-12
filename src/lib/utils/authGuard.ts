import { goto } from '$app/navigation';
import { LoginSecurity, RateLimiter } from './security';
import { setUserRole } from '$lib/stores/userRole.svelte';
import {
	clearOfflineSessionSnapshot,
	isOfflinePosPath,
	persistOfflineSessionSnapshot,
	readOfflineSessionSnapshot
} from '$lib/auth/offlineSession';

type SessionPayload = {
	authenticated: boolean;
	user?: Record<string, unknown>;
	expiresAt?: number | string;
};

function isSessionPayload(value: unknown): value is SessionPayload {
	if (typeof value !== 'object' || value === null || !('authenticated' in value)) return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.authenticated !== 'boolean') return false;
	if (!candidate.authenticated) return true;
	return (
		typeof candidate.user === 'object' &&
		candidate.user !== null &&
		!Array.isArray(candidate.user) &&
		Number.isFinite(Number(candidate.expiresAt))
	);
}

/**
 * Enhanced auth guard dengan security features
 * Implements session validation, rate limiting, dan security checks
 */
export class AuthGuard {
	private static instance: AuthGuard;
	private loginAttempts: Map<string, number> = new Map();

	private constructor() {}

	static getInstance(): AuthGuard {
		if (!AuthGuard.instance) {
			AuthGuard.instance = new AuthGuard();
		}
		return AuthGuard.instance;
	}

	/**
	 * Fetch session payload from server
	 */
	private async fetchSessionPayload(): Promise<SessionPayload | null> {
		const response = await fetch('/api/session', {
			method: 'GET',
			credentials: 'include'
		});

		if (!response.ok) {
			return null;
		}

		const payload: unknown = await response.json();
		return isSessionPayload(payload) ? payload : null;
	}

	private allowOfflinePosAccess(): boolean {
		if (!isOfflinePosPath(window.location.pathname)) {
			goto('/offline');
			return false;
		}
		const snapshot = readOfflineSessionSnapshot();
		if (!snapshot) {
			clearOfflineSessionSnapshot();
			goto('/login?reason=offline_session_expired');
			return false;
		}
		setUserRole(String(snapshot.user.role || ''), snapshot.user);
		return true;
	}

	private persistValidatedSession(payload: SessionPayload): void {
		if (!payload?.authenticated || !payload?.user || !Number.isFinite(Number(payload.expiresAt))) {
			return;
		}
		const user = payload.user;
		persistOfflineSessionSnapshot(user, Number(payload.expiresAt));
		setUserRole(String(user.role || ''), user);
		window.dispatchEvent(new CustomEvent('auth-session-refreshed'));
	}

	/**
	 * Check authentication dengan security validation
	 */
	async requireAuth(): Promise<boolean> {
		if (typeof window === 'undefined') return true;
		if (!navigator.onLine) return this.allowOfflinePosAccess();

		try {
			// Rate limiting check
			const clientId = this.getClientIdentifier();
			if (!RateLimiter.isAllowed(`auth_${clientId}`)) {
				goto('/login?reason=rate_limit');
				return false;
			}

			const payload = await this.fetchSessionPayload();
			if (!payload) {
				this.recordFailedAuth(clientId);
				goto('/login');
				return false;
			}

			if (!payload?.authenticated || !payload?.user) {
				this.recordFailedAuth(clientId);
				localStorage.removeItem('zatiaras_session');
				localStorage.removeItem('selectedBranch');
				goto('/login?reason=session_expired');
				return false;
			}

			this.persistValidatedSession(payload);
			return true;
		} catch {
			return this.allowOfflinePosAccess();
		}
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		if (typeof window === 'undefined') return false;

		try {
			const payload = await this.fetchSessionPayload();
			if (!payload) return false;
			return Boolean(payload?.authenticated && payload?.user);
		} catch (error) {
			return false;
		}
	}

	/**
	 * Get client identifier for rate limiting
	 */
	private getClientIdentifier(): string {
		// Use user agent hash for client identification
		const userAgent = navigator.userAgent;
		const hash = this.simpleHash(userAgent);
		return `client_${hash}`;
	}

	/**
	 * Simple hash function for user agent
	 */
	private simpleHash(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash);
	}

	/**
	 * Record failed authentication attempt
	 */
	private recordFailedAuth(clientId: string): void {
		const attempts = this.loginAttempts.get(clientId) || 0;
		this.loginAttempts.set(clientId, attempts + 1);

		// Block after 5 failed attempts
		if (attempts >= 4) {
			LoginSecurity.recordFailedLogin(clientId);
		}
	}
}

// Export singleton instance
export const authGuard = AuthGuard.getInstance();

// Legacy function exports for backward compatibility
export async function requireAuth(): Promise<boolean> {
	return authGuard.requireAuth();
}

export async function isAuthenticated(): Promise<boolean> {
	return authGuard.isAuthenticated();
}
