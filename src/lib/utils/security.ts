/**
 * Security utilities for Zatiaras POS
 * Client-side rate limiting, login protection, and security event logging.
 *
 * CSRF and session management are handled server-side (hooks.server.ts / sessionStore.ts).
 */
import { fetchWithCsrfRetry } from '$lib/utils/csrf';

// [CATATAN]: Security configuration
const SECURITY_CONFIG = {
	RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
	MAX_REQUESTS_PER_WINDOW: 100,
	MAX_LOGIN_ATTEMPTS: 5,
	LOGIN_BLOCK_DURATION: 30 * 60 * 1000 // 30 minutes
};

// [CATATAN]: Rate limiting storage
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

/**
 * Client-side rate limiting — provides immediate UX feedback before network round-trip.
 * Server-side rate limiting (rateLimit.ts) is the authoritative enforcement.
 */
export class RateLimiter {
	/** Check if request is allowed */
	static isAllowed(identifier: string): boolean {
		const now = Date.now();
		const record = rateLimitStore.get(identifier);

		if (!record || now > record.resetTime) {
			rateLimitStore.set(identifier, {
				count: 1,
				resetTime: now + SECURITY_CONFIG.RATE_LIMIT_WINDOW
			});
			return true;
		}

		if (record.count >= SECURITY_CONFIG.MAX_REQUESTS_PER_WINDOW) {
			return false;
		}

		record.count++;
		return true;
	}

	/** Get remaining requests for identifier */
	static getRemainingRequests(identifier: string): number {
		const record = rateLimitStore.get(identifier);
		if (!record) {
			return SECURITY_CONFIG.MAX_REQUESTS_PER_WINDOW;
		}

		const remaining = SECURITY_CONFIG.MAX_REQUESTS_PER_WINDOW - record.count;
		return Math.max(0, remaining);
	}

	/** Get reset time for identifier */
	static getResetTime(identifier: string): number {
		const record = rateLimitStore.get(identifier);
		return record ? record.resetTime : Date.now();
	}
}

/**
 * Login attempt tracking — blocks brute-force on client side.
 */
export class LoginSecurity {
	/** Check if login is blocked for IP/username */
	static isLoginBlocked(identifier: string): boolean {
		const record = loginAttempts.get(identifier);
		if (!record) {
			return false;
		}

		return Date.now() < record.blockedUntil;
	}

	/** Record failed login attempt */
	static recordFailedLogin(identifier: string): void {
		const record = loginAttempts.get(identifier);
		const now = Date.now();

		if (!record) {
			loginAttempts.set(identifier, {
				count: 1,
				blockedUntil: 0
			});
		} else {
			record.count++;

			if (record.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS) {
				record.blockedUntil = now + SECURITY_CONFIG.LOGIN_BLOCK_DURATION;
			}
		}
	}

	/** Get remaining login attempts */
	static getRemainingLoginAttempts(identifier: string): number {
		const record = loginAttempts.get(identifier);
		if (!record) {
			return SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS;
		}

		return Math.max(0, SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS - record.count);
	}
}

/**
 * Security utility facade — only methods with real consumers.
 * Used by: bayar, pos, login, catat, pengaturan, unauthorized, errorHandling.
 */
export const securityUtils = {
	checkFormRateLimit: (formName: string): boolean => {
		return RateLimiter.isAllowed(`form_${formName}`);
	},

	detectSuspiciousActivity: (_action: string, input: string): boolean => {
		const suspiciousPatterns = [
			/<script/i,
			/javascript:/i,
			/on\w+\s*=/i,
			/eval\s*\(/i,
			/alert\s*\(/i
		];

		return suspiciousPatterns.some((pattern) => pattern.test(input));
	},

	logSecurityEvent: (eventType: string, data: unknown): void => {
		if (typeof window === 'undefined') {
			return;
		}

		const payload = JSON.stringify({
			eventType,
			data,
			timestamp: Date.now()
		});

		try {
			void fetchWithCsrfRetry('/api/security-events', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: payload,
				keepalive: true,
				credentials: 'include'
			}).catch(() => undefined);
		} catch {
			// [CATATAN]: best-effort telemetry — failure is non-critical
		}
	}
};
