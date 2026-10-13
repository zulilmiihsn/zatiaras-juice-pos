import {
	branchContext,
	getD1Database,
	normalizeBranch,
	type BranchId
} from '$lib/server/branchResolver';
import { MS_PER_DAY } from '$lib/constants/time';
import { parseSessionBranch } from './authSessionReader';
export { getAuthSession } from './authSessionReader';
import { revokeNotificationSession } from '$lib/server/orderNotifications/useCase';

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

const SESSION_TTL_MS = MS_PER_DAY;

function buildSessionId(branch: BranchId): string {
	return `${branch}.${crypto.randomUUID()}`;
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
	await revokeNotificationSession(platform, branchContext(branch), sessionId);
}
