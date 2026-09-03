import type { RequestHandler } from '@sveltejs/kit';
import bcrypt from 'bcryptjs';
import { and, eq, ne } from 'drizzle-orm';
import { profil } from '$lib/database/schema';
import {
	getDrizzleDb,
	getD1Database,
	normalizeBranch,
	type BranchId
} from '$lib/server/branchResolver';
import { publishBranchEvent } from '$lib/server/realtimePublisher';
import { appendAuditLog } from '$lib/server/auditLog';
import { consumeRateLimit } from '$lib/server/rateLimit';

const SECURITY_WINDOW_MS = 15 * 60 * 1000;
const SECURITY_MAX_ATTEMPTS = 5;

async function hashIdentifier(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function isStrongPassword(password: string): boolean {
	if (password.length < 8) return false;
	if (!/[A-Z]/.test(password)) return false;
	if (!/[a-z]/.test(password)) return false;
	if (!/\d/.test(password)) return false;

	const lowered = password.toLowerCase();
	const commonPasswords = ['password', '123456', 'admin123', 'kasir123'];
	return !commonPasswords.some((item) => lowered.includes(item));
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals, platform }) => {
	try {
		const requesterRole = locals.authSession?.role;
		if (requesterRole !== 'pemilik' && requesterRole !== 'admin') {
			return new Response(
				JSON.stringify({ success: false, code: 'FORBIDDEN', message: 'Forbidden' }),
				{ status: 403 }
			);
		}

		const body = await request.json();
		const { usernameLama, usernameBaru, passwordLama, passwordBaru, branch, targetRole } = body;

		if (!usernameLama || !passwordLama || !branch) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'VALIDATION_ERROR',
					message: 'Username saat ini, password saat ini, dan cabang wajib diisi.'
				}),
				{ status: 400 }
			);
		}

		const hasNewUsername = typeof usernameBaru === 'string' && usernameBaru.trim().length > 0;
		const hasNewPassword = typeof passwordBaru === 'string' && passwordBaru.trim().length > 0;

		if (!hasNewUsername && !hasNewPassword) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'VALIDATION_ERROR',
					message: 'Masukkan username baru atau password baru yang ingin diubah.'
				}),
				{ status: 400 }
			);
		}

		let branchId: BranchId;
		try {
			branchId = normalizeBranch(branch);
		} catch {
			return new Response(
				JSON.stringify({ success: false, code: 'INVALID_BRANCH', message: 'Branch tidak valid.' }),
				{ status: 400 }
			);
		}

		const sessionBranch = normalizeBranch(locals.authSession!.branch);
		if (branchId !== sessionBranch && requesterRole !== 'admin') {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'BRANCH_FORBIDDEN',
					message: 'Tidak boleh mengubah kredensial cabang lain.'
				}),
				{ status: 403 }
			);
		}

		const rawDb = getD1Database(platform?.env as Record<string, unknown> | undefined, branchId);
		const ipHash = await hashIdentifier(getClientAddress());
		const ipLimit = await consumeRateLimit(
			rawDb,
			branchId,
			`security:ip:${ipHash}`,
			SECURITY_MAX_ATTEMPTS,
			SECURITY_WINDOW_MS,
			platform
		);
		const userLimit = await consumeRateLimit(
			rawDb,
			branchId,
			`security:user:${String(usernameLama).trim().toLowerCase()}`,
			SECURITY_MAX_ATTEMPTS,
			SECURITY_WINDOW_MS,
			platform
		);
		if (!ipLimit.available || !userLimit.available) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'RATE_LIMITER_UNAVAILABLE',
					message: 'Perubahan keamanan sementara tidak tersedia. Coba lagi beberapa saat.'
				}),
				{ status: 503, headers: { 'Retry-After': '5' } }
			);
		}

		if (!ipLimit.allowed || !userLimit.allowed) {
			const retryAfterSeconds = Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds);
			return new Response(
				JSON.stringify({
					success: false,
					code: 'RATE_LIMITED',
					message: 'Terlalu banyak percobaan. Coba lagi nanti.',
					retryAfterSeconds
				}),
				{ status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
			);
		}

		const VALID_ROLES = ['pemilik', 'kasir', 'admin'];
		if (targetRole && !VALID_ROLES.includes(targetRole)) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'INVALID_ROLE',
					message: 'Target role tidak valid.'
				}),
				{ status: 400 }
			);
		}

		if (hasNewPassword && !isStrongPassword(passwordBaru.trim())) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'WEAK_PASSWORD',
					message:
						'Password baru harus minimal 8 karakter dan mengandung huruf besar, huruf kecil, dan angka.'
				}),
				{ status: 400 }
			);
		}

		const db = getDrizzleDb(platform, branchId);
		const filters = [
			eq(profil.cabang_id, branchId),
			eq(profil.username, String(usernameLama).trim())
		];
		if (targetRole) filters.push(eq(profil.role, targetRole));

		const user = await db
			.select({
				id: profil.id,
				username: profil.username,
				password: profil.password,
				role: profil.role
			})
			.from(profil)
			.where(and(...filters))
			.get();

		if (!user) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'NOT_FOUND',
					message: 'Akun dengan username tersebut tidak ditemukan.'
				}),
				{ status: 404 }
			);
		}

		// Verifikasi password saat ini
		const match = await bcrypt.compare(String(passwordLama), user.password);
		if (!match) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'INVALID_CREDENTIALS',
					message: 'Password saat ini salah.'
				}),
				{ status: 401 }
			);
		}

		const cleanNewUsername = hasNewUsername ? usernameBaru.trim() : user.username;
		const cleanNewPassword = hasNewPassword ? passwordBaru.trim() : null;

		// Bila username baru disediakan, pastikan belum dipakai akun lain di cabang yang sama
		if (hasNewUsername && cleanNewUsername !== user.username) {
			const existingUser = await db
				.select({ id: profil.id })
				.from(profil)
				.where(
					and(
						eq(profil.cabang_id, branchId),
						eq(profil.username, cleanNewUsername),
						ne(profil.id, user.id)
					)
				)
				.get();

			if (existingUser) {
				return new Response(
					JSON.stringify({
						success: false,
						code: 'USERNAME_EXISTS',
						message: 'Username baru sudah digunakan oleh akun lain di cabang ini.'
					}),
					{ status: 400 }
				);
			}
		}

		// Hash password jika ada perubahan password
		const finalHashedPassword = cleanNewPassword
			? await bcrypt.hash(cleanNewPassword, 10)
			: user.password;

		// Perubahan kredensial dan pencabutan seluruh sesi user secara atomik
		await rawDb.batch([
			rawDb
				.prepare(
					`UPDATE profil
					 SET username = ?, password = ?, updated_at = ?
					 WHERE cabang_id = ? AND id = ?`
				)
				.bind(cleanNewUsername, finalHashedPassword, new Date().toISOString(), branchId, user.id),
			rawDb
				.prepare('DELETE FROM auth_sessions WHERE cabang_id = ? AND user_id = ?')
				.bind(branchId, user.id)
		]);

		await publishBranchEvent(
			platform?.env as Record<string, unknown> | undefined,
			branchId,
			'profil',
			'update',
			{ id: user.id }
		);

		await appendAuditLog(rawDb, branchId, {
			action: 'credential_change',
			entityType: 'profil',
			entityId: user.id,
			metadata: {
				usernameLama,
				usernameBaru: cleanNewUsername,
				isPasswordChanged: hasNewPassword,
				targetRole: targetRole ?? null
			},
			session: {
				userId: locals.authSession?.userId,
				username: locals.authSession?.username,
				role: locals.authSession?.role
			}
		});

		let successMsg = 'Kredensial berhasil diperbarui.';
		if (hasNewUsername && hasNewPassword) {
			successMsg = 'Username dan password berhasil diperbarui.';
		} else if (hasNewUsername) {
			successMsg = 'Username berhasil diperbarui.';
		} else if (hasNewPassword) {
			successMsg = 'Password berhasil diperbarui.';
		}

		return new Response(JSON.stringify({ success: true, message: successMsg }), { status: 200 });
	} catch (e) {
		return new Response(
			JSON.stringify({
				success: false,
				code: 'SERVER_ERROR',
				message: 'Terjadi error pada server.'
			}),
			{ status: 500 }
		);
	}
};
