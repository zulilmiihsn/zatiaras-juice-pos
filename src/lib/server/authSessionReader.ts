import { getD1Database, normalizeBranch, type BranchId } from './branchResolver';
import { normalizeRole } from '../utils/roles';
import type { AuthSession } from './sessionStore';

export function parseSessionBranch(sessionId: string | undefined): BranchId | null {
	if (!sessionId) return null;
	const separator = sessionId.indexOf('.');
	if (separator <= 0) return null;
	try {
		return normalizeBranch(sessionId.slice(0, separator));
	} catch {
		return null;
	}
}

// Both HTTP hooks and the compiled upgrade entry must observe current profile authority.
export async function getAuthSession(
	platform: App.Platform | undefined,
	sessionId: string | undefined
): Promise<AuthSession | null> {
	const branch = parseSessionBranch(sessionId);
	if (!branch || !sessionId) return null;
	const row = await getD1Database(platform?.env as Record<string, unknown> | undefined, branch)
		.prepare(
			`SELECT s.id, s.cabang_id, s.user_id, p.username, p.role,
			s.created_at, s.expires_at, s.unlocked_pages, s.unlock_expires_at
			FROM auth_sessions s INNER JOIN profil p
				ON p.cabang_id = s.cabang_id AND p.id = s.user_id
			WHERE s.id = ? AND s.cabang_id = ? AND s.expires_at > ? LIMIT 1`
		)
		.bind(sessionId, branch, Date.now())
		.first<{
			id: string;
			cabang_id: BranchId;
			user_id: string;
			username: string;
			role: string;
			created_at: number;
			expires_at: number;
			unlocked_pages: string;
			unlock_expires_at: number;
		}>();
	if (!row) return null;
	const role = normalizeRole(row.role);
	if (!role) return null;
	let unlockedPages: string[] = [];
	try {
		const parsed: unknown = JSON.parse(row.unlocked_pages || '[]');
		if (Array.isArray(parsed))
			unlockedPages = parsed.filter((item): item is string => typeof item === 'string');
	} catch {
		// Corrupt legacy unlock metadata grants no page access, but does not invent a role.
		unlockedPages = [];
	}
	return {
		id: row.id,
		branch: row.cabang_id,
		userId: row.user_id,
		username: row.username,
		role,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		unlockedPages,
		unlockExpiresAt: Number(row.unlock_expires_at || 0)
	};
}
