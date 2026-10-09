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

export interface CredentialChangeResult {
	status: number;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
}

function fail(
	status: number,
	body: Record<string, unknown>,
	headers?: Record<string, string>
): CredentialChangeResult {
	return { status, body, headers };
}

/**
 * Ganti username/password akun cabang + cabut sesi user atomik.
 * UNIQUE (cabang_id, username) di DB otoritas race; pelanggaran unik -> 400.
 * Route hanya gate role, parsing body, dan Response.
 */
export async function changeCredentials(input: {
	platform: App.Platform | undefined;
	session: App.Locals['authSession'];
	clientIp: string;
	rawBody: unknown;
}): Promise<CredentialChangeResult> {
	const { platform, session, clientIp, rawBody } = input;
	const requesterRole = session?.role;
	try {
		const body = rawBody as {
			usernameLama?: unknown;
			usernameBaru?: unknown;
			passwordLama?: unknown;
			passwordBaru?: unknown;
			branch?: unknown;
			targetRole?: unknown;
		} | null;
		const { usernameLama, usernameBaru, passwordLama, passwordBaru, branch, targetRole } =
			body ?? {};

		if (!usernameLama || !passwordLama || !branch) {
			return fail(400, {
				success: false,
				code: 'VALIDATION_ERROR',
				message: 'Username saat ini, password saat ini, dan cabang wajib diisi.'
			});
		}

		const hasNewUsername = typeof usernameBaru === 'string' && usernameBaru.trim().length > 0;
		const hasNewPassword = typeof passwordBaru === 'string' && passwordBaru.trim().length > 0;

		if (!hasNewUsername && !hasNewPassword) {
			return fail(400, {
				success: false,
				code: 'VALIDATION_ERROR',
				message: 'Masukkan username baru atau password baru yang ingin diubah.'
			});
		}

		let branchId: BranchId;
		try {
			branchId = normalizeBranch(branch);
		} catch {
			return fail(400, {
				success: false,
				code: 'INVALID_BRANCH',
				message: 'Branch tidak valid.'
			});
		}

		const sessionBranch = normalizeBranch(session!.branch);
		if (branchId !== sessionBranch && requesterRole !== 'admin') {
			return fail(403, {
				success: false,
				code: 'BRANCH_FORBIDDEN',
				message: 'Tidak boleh mengubah kredensial cabang lain.'
			});
		}

		const rawDb = getD1Database(platform?.env as Record<string, unknown> | undefined, branchId);
		const ipHash = await hashIdentifier(clientIp);
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
			return fail(
				503,
				{
					success: false,
					code: 'RATE_LIMITER_UNAVAILABLE',
					message: 'Perubahan keamanan sementara tidak tersedia. Coba lagi beberapa saat.'
				},
				{ 'Retry-After': '5' }
			);
		}

		if (!ipLimit.allowed || !userLimit.allowed) {
			const retryAfterSeconds = Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds);
			return fail(
				429,
				{
					success: false,
					code: 'RATE_LIMITED',
					message: 'Terlalu banyak percobaan. Coba lagi nanti.',
					retryAfterSeconds
				},
				{ 'Retry-After': String(retryAfterSeconds) }
			);
		}

		const VALID_ROLES = ['pemilik', 'kasir', 'admin'];
		if (targetRole && !VALID_ROLES.includes(targetRole as string)) {
			return fail(400, {
				success: false,
				code: 'INVALID_ROLE',
				message: 'Target role tidak valid.'
			});
		}

		if (hasNewPassword && !isStrongPassword((passwordBaru as string).trim())) {
			return fail(400, {
				success: false,
				code: 'WEAK_PASSWORD',
				message:
					'Password baru harus minimal 8 karakter dan mengandung huruf besar, huruf kecil, dan angka.'
			});
		}

		const db = getDrizzleDb(platform, branchId);
		const filters = [
			eq(profil.cabang_id, branchId),
			eq(profil.username, String(usernameLama).trim())
		];
		if (targetRole) filters.push(eq(profil.role, targetRole as string));

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
			return fail(404, {
				success: false,
				code: 'NOT_FOUND',
				message: 'Akun dengan username tersebut tidak ditemukan.'
			});
		}

		// Verifikasi password saat ini (trim konsisten dengan create/change/verify).
		const match = await bcrypt.compare(String(passwordLama).trim(), user.password);
		if (!match) {
			return fail(401, {
				success: false,
				code: 'INVALID_CREDENTIALS',
				message: 'Password saat ini salah.'
			});
		}

		const cleanNewUsername = hasNewUsername ? (usernameBaru as string).trim() : user.username;
		const cleanNewPassword = hasNewPassword ? (passwordBaru as string).trim() : null;

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
				return fail(400, {
					success: false,
					code: 'USERNAME_EXISTS',
					message: 'Username baru sudah digunakan oleh akun lain di cabang ini.'
				});
			}
		}

		// Hash password jika ada perubahan password
		const finalHashedPassword = cleanNewPassword
			? await bcrypt.hash(cleanNewPassword, 10)
			: user.password;

		// Perubahan kredensial dan pencabutan seluruh sesi user secara atomik.
		// UNIQUE (cabang_id, username) di DB adalah otoritas race; check-before-update
		// di atas hanya fast-path ramah. Pelanggaran unik dipetakan ke USERNAME_EXISTS.
		try {
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
		} catch (error) {
			const message = String((error as { message?: unknown })?.message ?? error).toUpperCase();
			if (message.includes('UNIQUE') || message.includes('CONSTRAINT')) {
				return fail(400, {
					success: false,
					code: 'USERNAME_EXISTS',
					message: 'Username baru sudah digunakan oleh akun lain di cabang ini.'
				});
			}
			throw error;
		}

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
				targetRole: (targetRole as string | undefined) ?? null
			},
			session: {
				userId: session?.userId,
				username: session?.username,
				role: session?.role
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

		return { status: 200, body: { success: true, message: successMsg } };
	} catch {
		return fail(500, {
			success: false,
			code: 'SERVER_ERROR',
			message: 'Terjadi error pada server.'
		});
	}
}
