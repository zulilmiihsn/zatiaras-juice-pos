import bcrypt from 'bcryptjs';
import { createAuthSession } from '$lib/server/sessionStore';
import {
	getD1Database,
	getDrizzleDb,
	normalizeBranch,
	type BranchId
} from '$lib/server/branchResolver';
import { profil } from '$lib/database/schema';
import { and, eq } from 'drizzle-orm';
import { appendAuditLog } from '$lib/server/auditLog';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { recordErrorEvent } from '$lib/server/observability';
import { normalizeRole } from '$lib/utils/roles';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_IP_ATTEMPTS = 60;
const LOGIN_MAX_USER_ATTEMPTS = 15;

async function hashIdentifier(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export interface LoginAttemptResult {
	status: number;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
	/** Id sesi untuk cookie; hanya ada saat sukses. */
	sessionId?: string;
	/** Username untuk konteks error route (tak masuk respons). */
	username: string;
}

/**
 * Login username+password. Pesan publik seragam anti-enumeration (AUD-016);
 * alasan rinci hanya di audit log. Unknown role fail-closed (AUD-019).
 * Route hanya parsing body mentah, set cookie, dan Response.
 */
export async function attemptLogin(
	platform: App.Platform | undefined,
	rawBody: unknown,
	clientIp: string
): Promise<LoginAttemptResult> {
	let branchId: BranchId | null = null;
	let username = '';
	const ipHash = await hashIdentifier(clientIp);

	try {
		const body = rawBody as { username?: unknown; password?: unknown; branch?: unknown } | null;
		const password = body?.password;
		username = String(body?.username || '').trim();
		const branch = body?.branch;

		if (!username || !password || !branch) {
			return {
				status: 400,
				body: {
					success: false,
					code: 'VALIDATION_ERROR',
					message: 'Username dan password wajib diisi'
				},
				username
			};
		}

		try {
			branchId = normalizeBranch(branch);
		} catch {
			return {
				status: 400,
				body: { success: false, code: 'INVALID_BRANCH', message: 'Branch tidak valid' },
				username
			};
		}

		const rawDb = getD1Database(platform?.env as Record<string, unknown> | undefined, branchId);
		const ipLimit = await consumeRateLimit(
			rawDb,
			branchId,
			`login:ip:${ipHash}`,
			LOGIN_MAX_IP_ATTEMPTS,
			LOGIN_WINDOW_MS,
			platform
		);
		const userLimit = await consumeRateLimit(
			rawDb,
			branchId,
			`login:user:${username.toLowerCase()}`,
			LOGIN_MAX_USER_ATTEMPTS,
			LOGIN_WINDOW_MS,
			platform
		);
		if (!ipLimit.available || !userLimit.available) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.rate_limiter_unavailable',
				entityType: 'profil',
				entityId: username,
				ipHash,
				metadata: { username }
			});
			return {
				status: 503,
				body: {
					success: false,
					code: 'RATE_LIMITER_UNAVAILABLE',
					message: 'Login sementara tidak tersedia. Coba lagi beberapa saat.'
				},
				headers: { 'Retry-After': '5' },
				username
			};
		}

		if (!ipLimit.allowed || !userLimit.allowed) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.rate_limited',
				entityType: 'profil',
				entityId: username,
				ipHash,
				metadata: {
					username,
					retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds)
				}
			});

			return {
				status: 429,
				body: {
					success: false,
					code: 'RATE_LIMITED',
					message: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.',
					retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds)
				},
				username
			};
		}

		const db = getDrizzleDb(platform, branchId);
		const user = await db
			.select({
				id: profil.id,
				username: profil.username,
				password: profil.password,
				role: profil.role
			})
			.from(profil)
			.where(and(eq(profil.cabang_id, branchId), eq(profil.username, username)))
			.get();

		if (!user) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.failed',
				entityType: 'profil',
				entityId: username,
				ipHash,
				metadata: { reason: 'user_not_found', username }
			});

			// Pesan publik seragam anti-enumeration (AUD-016).
			// Alasan rinci hanya di audit log server.
			return {
				status: 401,
				body: {
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				},
				username
			};
		}
		// [CATATAN]: Aturan tepi spasi (terdokumentasi): password di-trim di
		// create/change/verify agar konsisten dengan hash tersimpan.
		// Pola HTML/SQL di DALAM password tidak diubah/ditolak.
		const passwordTrimmed = typeof password === 'string' ? password.trim() : (password as string);
		const match = await bcrypt.compare(passwordTrimmed, user.password);
		if (!match) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.failed',
				entityType: 'profil',
				entityId: user.id,
				ipHash,
				metadata: { reason: 'password_mismatch', username }
			});

			return {
				status: 401,
				body: {
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				},
				username
			};
		}

		// [CATATAN]: Role user dari database wajib lolos kebijakan kanonik
		// (AUD-019). Unknown fail-closed tanpa sesi, pesan publik seragam
		// anti-enumeration; alasan rinci hanya di audit log.
		const normalizedRole = normalizeRole(user.role);
		if (!normalizedRole) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.failed',
				entityType: 'profil',
				entityId: user.id,
				ipHash,
				metadata: { reason: 'unknown_role', username }
			});

			return {
				status: 401,
				body: {
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				},
				username
			};
		}

		const authSession = await createAuthSession(platform, {
			userId: user.id,
			username: user.username,
			role: normalizedRole,
			branch: branchId
		});

		await appendAuditLog(rawDb, branchId, {
			action: 'login.success',
			entityType: 'profil',
			entityId: user.id,
			ipHash,
			session: {
				userId: user.id,
				username: user.username,
				role: normalizedRole
			},
			metadata: { username: user.username }
		});

		// [CATATAN]: Sukses login
		return {
			status: 200,
			body: {
				success: true,
				session: {
					expiresAt: authSession.expiresAt
				},
				user: {
					id: user.id,
					username: user.username,
					role: normalizedRole,
					branch: branchId
				}
			},
			sessionId: authSession.id,
			username
		};
	} catch (e) {
		await recordErrorEvent(platform, branchId, {
			source: 'POST /api/veriflogin',
			error: e,
			status: 500,
			context: { username, ipHash }
		});

		return {
			status: 500,
			body: {
				success: false,
				code: 'SERVER_ERROR',
				message: 'Terjadi error pada server'
			},
			username
		};
	}
}
