import {
	branchContext,
	getD1Database,
	normalizeBranch,
	type BranchId
} from '$lib/server/branchResolver';
import { MS_PER_DAY, MS_PER_HOUR } from '$lib/constants/time';
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

// Sliding: sesi aktif diperpanjang TTL penuh, tetapi tulis D1 paling sering sekali per jam.
const SESSION_TTL_MS = 6 * MS_PER_HOUR;
const SESSION_RENEW_AFTER_MS = MS_PER_HOUR;
// Batas mutlak sejak login, agar cookie yang bocor tidak hidup selamanya.
const SESSION_MAX_LIFETIME_MS = 30 * MS_PER_DAY;

export const SESSION_COOKIE = 'zatiaras_sid';

export function sessionCookieOptions(secure: boolean, maxAgeMs = SESSION_TTL_MS) {
	return {
		httpOnly: true,
		path: '/',
		sameSite: 'lax',
		secure,
		maxAge: Math.max(1, Math.floor(maxAgeMs / 1000))
	} as const;
}

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

/**
 * Kebijakan sliding: expiry baru, atau null bila belum waktunya (throttle)
 * atau batas mutlak sejak login sudah tercapai.
 */
export function nextSessionExpiry(
	session: Pick<AuthSession, 'createdAt' | 'expiresAt'>,
	now: number
): number | null {
	if (session.expiresAt - now > SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) return null;
	const expiresAt = Math.min(now + SESSION_TTL_MS, session.createdAt + SESSION_MAX_LIFETIME_MS);
	return expiresAt > session.expiresAt ? expiresAt : null;
}

/**
 * Simpan perpanjangan sesi yang masih berlaku. Mengembalikan sesi baru bila
 * diperpanjang, null bila belum waktunya atau sesi sudah tidak berlaku.
 */
export async function renewAuthSession(
	platform: App.Platform | undefined,
	session: AuthSession
): Promise<AuthSession | null> {
	const now = Date.now();
	const expiresAt = nextSessionExpiry(session, now);
	if (expiresAt === null) return null;

	const branch = normalizeBranch(session.branch);
	const result = await getSessionDb(platform, branch)
		.prepare(
			'UPDATE auth_sessions SET expires_at = ? WHERE id = ? AND cabang_id = ? AND expires_at > ?'
		)
		.bind(expiresAt, session.id, branch, now)
		.run();
	if (!result.meta?.changes) return null;
	return { ...session, expiresAt };
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
