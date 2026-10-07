import type { RequestHandler } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import { createAuthSession } from '$lib/server/sessionStore';
import { dev } from '$app/environment';
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

export const POST: RequestHandler = async ({ request, getClientAddress, cookies, platform }) => {
	let branchId: BranchId | null = null;
	let username = '';
	const clientIp = getClientAddress();
	const ipHash = await hashIdentifier(clientIp);

	try {
		const body = await request.json();
		const password = body?.password;
		username = String(body?.username || '').trim();
		const branch = body?.branch;

		if (!username || !password || !branch) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'VALIDATION_ERROR',
					message: 'Username dan password wajib diisi'
				}),
				{ status: 400 }
			);
		}

		try {
			branchId = normalizeBranch(branch);
		} catch {
			return new Response(
				JSON.stringify({ success: false, code: 'INVALID_BRANCH', message: 'Branch tidak valid' }),
				{ status: 400 }
			);
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
			return new Response(
				JSON.stringify({
					success: false,
					code: 'RATE_LIMITER_UNAVAILABLE',
					message: 'Login sementara tidak tersedia. Coba lagi beberapa saat.'
				}),
				{ status: 503, headers: { 'Retry-After': '5' } }
			);
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

			return new Response(
				JSON.stringify({
					success: false,
					code: 'RATE_LIMITED',
					message: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.',
					retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds)
				}),
				{ status: 429 }
			);
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
			return new Response(
				JSON.stringify({
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				}),
				{
					status: 401
				}
			);
		}
		// [CATATAN]: Aturan tepi spasi (terdokumentasi): password di-trim di
		// create/change/verify agar konsisten dengan hash tersimpan.
		// Pola HTML/SQL di DALAM password tidak diubah/ditolak.
		const passwordTrimmed = typeof password === 'string' ? password.trim() : password;
		const match = await bcrypt.compare(passwordTrimmed, user.password);
		if (!match) {
			await appendAuditLog(rawDb, branchId, {
				action: 'login.failed',
				entityType: 'profil',
				entityId: user.id,
				ipHash,
				metadata: { reason: 'password_mismatch', username }
			});

			return new Response(
				JSON.stringify({
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				}),
				{
					status: 401
				}
			);
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

			return new Response(
				JSON.stringify({
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Username atau password salah.'
				}),
				{
					status: 401
				}
			);
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

		cookies.set('zatiaras_sid', authSession.id, {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
			secure: !dev,
			maxAge: 60 * 60 * 24
		});

		// [CATATAN]: Sukses login
		return new Response(
			JSON.stringify({
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
			}),
			{ status: 200 }
		);
	} catch (e) {
		await recordErrorEvent(platform, branchId, {
			source: 'POST /api/veriflogin',
			error: e,
			status: 500,
			context: { username, ipHash }
		});

		return new Response(
			JSON.stringify({
				success: false,
				code: 'SERVER_ERROR',
				message: 'Terjadi error pada server'
			}),
			{
				status: 500
			}
		);
	}
};
