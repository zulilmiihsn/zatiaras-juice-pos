import { getD1Database, normalizeBranch, type BranchId } from '$lib/server/branchResolver';

export interface AuthSession {
	id: string;
	userId: string;
	username: string;
	role: string;
	branch?: string;
	createdAt: number;
	expiresAt: number;
	unlockedPages: string[];
	unlockExpiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function buildSessionId(branch: BranchId): string {
	return `${branch}.${crypto.randomUUID()}`;
}

function parseSessionBranch(sessionId: string | undefined): BranchId | null {
	if (!sessionId) return null;
	const separatorIndex = sessionId.indexOf('.');
	if (separatorIndex <= 0) return null;

	try {
		return normalizeBranch(sessionId.slice(0, separatorIndex));
	} catch {
		return null;
	}
}

function getSessionDb(platform: App.Platform | undefined, branch: BranchId) {
	return getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
}

export async function createAuthSession(
	platform: App.Platform | undefined,
	payload: {
		branch: BranchId;
		userId: string;
		username: string;
		role: string;
	}
): Promise<AuthSession> {
	const now = Date.now();
	const session: AuthSession = {
		id: buildSessionId(payload.branch),
		userId: payload.userId,
		username: payload.username,
		role: payload.role,
		branch: payload.branch,
		createdAt: now,
		expiresAt: now + SESSION_TTL_MS,
		unlockedPages: [],
		unlockExpiresAt: 0
	};

	const db = getSessionDb(platform, payload.branch);
	await db
		.prepare(
			`INSERT INTO auth_sessions (
				id,
				cabang_id,
				user_id,
				username,
				role,
				created_at,
				expires_at,
				unlocked_pages,
				unlock_expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			session.id,
			payload.branch,
			payload.userId,
			payload.username,
			payload.role,
			session.createdAt,
			session.expiresAt,
			JSON.stringify(session.unlockedPages),
			session.unlockExpiresAt
		)
		.run();
	await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now).run();

	return session;
}

export async function getAuthSession(
	platform: App.Platform | undefined,
	sessionId: string | undefined
): Promise<AuthSession | null> {
	const branch = parseSessionBranch(sessionId);
	if (!branch || !sessionId) {
		return null;
	}

	const row = (await getSessionDb(platform, branch)
		.prepare(
			`SELECT
				s.id,
				s.cabang_id,
				s.user_id,
				p.username,
				p.role,
				s.created_at,
				s.expires_at,
				s.unlocked_pages,
				s.unlock_expires_at
			FROM auth_sessions s
			INNER JOIN profil p
				ON p.cabang_id = s.cabang_id AND p.id = s.user_id
			WHERE s.id = ? AND s.expires_at > ?
			LIMIT 1`
		)
		.bind(sessionId, Date.now())
		.first()) as {
		id: string;
		cabang_id: BranchId;
		user_id: string;
		username: string;
		role: string;
		created_at: number;
		expires_at: number;
		unlocked_pages: string;
		unlock_expires_at: number;
	} | null;

	if (!row) {
		return null;
	}

	let unlockedPages: string[] = [];
	try {
		const parsed = JSON.parse(row.unlocked_pages || '[]') as unknown;
		if (Array.isArray(parsed)) {
			unlockedPages = parsed.filter((item): item is string => typeof item === 'string');
		}
	} catch {
		unlockedPages = [];
	}

	const normalizedRole =
		row.role === 'pemilik' || row.role === 'kasir' || row.role === 'admin' ? row.role : 'kasir';

	return {
		id: row.id,
		branch: row.cabang_id,
		userId: row.user_id,
		username: row.username,
		role: normalizedRole,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		unlockedPages,
		unlockExpiresAt: Number(row.unlock_expires_at || 0)
	};
}

export async function grantSessionPageUnlock(
	platform: App.Platform | undefined,
	session: AuthSession,
	page: string,
	expiresAt: number
): Promise<void> {
	const branch = normalizeBranch(session.branch);
	const pages =
		session.unlockExpiresAt > Date.now() ? new Set(session.unlockedPages || []) : new Set<string>();
	pages.add(page);
	await getSessionDb(platform, branch)
		.prepare(
			`UPDATE auth_sessions
			 SET unlocked_pages = ?, unlock_expires_at = ?
			 WHERE id = ? AND cabang_id = ? AND expires_at > ?`
		)
		.bind(JSON.stringify([...pages]), expiresAt, session.id, branch, Date.now())
		.run();
}

export async function revokeBranchPageUnlocks(
	platform: App.Platform | undefined,
	branchValue: string
): Promise<void> {
	const branch = normalizeBranch(branchValue);
	await getSessionDb(platform, branch)
		.prepare(
			`UPDATE auth_sessions
			 SET unlocked_pages = '[]', unlock_expires_at = 0
			 WHERE cabang_id = ?`
		)
		.bind(branch)
		.run();
}

export async function deleteAuthSession(
	platform: App.Platform | undefined,
	sessionId: string | undefined
): Promise<void> {
	const branch = parseSessionBranch(sessionId);
	if (!branch || !sessionId) {
		return;
	}

	await getSessionDb(platform, branch)
		.prepare('DELETE FROM auth_sessions WHERE id = ?')
		.bind(sessionId)
		.run();
}
