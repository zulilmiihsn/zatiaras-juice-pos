import bcrypt from 'bcryptjs';
import type { SqlStorage } from '@cloudflare/workers-types';
import { MS_PER_HOUR } from '$lib/constants/time';

const WINDOW = MS_PER_HOUR / 4;
const DENIED = { ok: false } as const;

async function digest(token: string) {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0')).join('');
}

/** Private per-branch storage. Enrollment requires a current D1 cashier profile supplied by the trusted caller,
 * never a profile from a browser. */
export class CoordinatedCashierAuth {
	constructor(private sql: SqlStorage) {
		sql.exec(`CREATE TABLE IF NOT EXISTS cashier_device (
			device TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, verifier TEXT NOT NULL,
			until_ms INTEGER NOT NULL, sid TEXT, session_end INTEGER NOT NULL DEFAULT 0,
			attempts INTEGER NOT NULL DEFAULT 0, reset_ms INTEGER NOT NULL DEFAULT 0)`);
	}

	async enroll(profile: {
		userId: string;
		username: string;
		role: string;
		verifier: string;
		previousToken?: unknown;
	}) {
		if (
			!['kasir', 'pemilik'].includes(profile.role) ||
			!profile.userId ||
			!profile.username ||
			!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(profile.verifier)
		)
			return DENIED;
		const token = crypto.randomUUID();
		const now = Date.now();
		const device = await digest(token);
		const previous =
			typeof profile.previousToken === 'string' && profile.previousToken.length === 36
				? await digest(profile.previousToken)
				: null;
		this.sql.exec('DELETE FROM cashier_device WHERE until_ms <= ?', now);
		this.sql.exec(
			'INSERT INTO cashier_device(device,user_id,username,verifier,until_ms) VALUES(?,?,?,?,?)',
			device,
			profile.userId,
			profile.username,
			profile.verifier,
			now + 48 * MS_PER_HOUR
		);
		if (previous) this.sql.exec('DELETE FROM cashier_device WHERE device=?', previous);
		return { ok: true, token };
	}

	async login(token: string, username: string, password: string) {
		if (
			typeof token !== 'string' ||
			token.length !== 36 ||
			typeof username !== 'string' ||
			typeof password !== 'string' ||
			!password ||
			password.length > 1024
		)
			return DENIED;
		const device = await digest(token);
		const now = Date.now();
		// Reserve before the async password check; concurrent requests cannot share one attempt.
		const rows = this.sql
			.exec(
				`UPDATE cashier_device SET attempts=CASE WHEN reset_ms<=? THEN 1 ELSE attempts+1 END,
			reset_ms=CASE WHEN reset_ms<=? THEN ? ELSE reset_ms END
			WHERE device=? AND until_ms>? AND (reset_ms<=? OR attempts<5) RETURNING verifier, username`,
				now,
				now,
				now + WINDOW,
				device,
				now,
				now
			)
			.toArray();
		const row = rows[0];
		if (
			!row ||
			row.username !== username.trim() ||
			!(await bcrypt.compare(password.trim(), String(row.verifier)))
		)
			return DENIED;
		const sid = crypto.randomUUID();
		const key = await digest(sid);
		const verifiedAt = Date.now();
		const result = this.sql
			.exec(
				`UPDATE cashier_device SET sid=?, session_end=MIN(until_ms,?), attempts=0,reset_ms=0
			WHERE device=? AND until_ms>? RETURNING session_end`,
				key,
				verifiedAt + 6 * MS_PER_HOUR,
				device,
				verifiedAt
			)
			.toArray();
		return result.length ? { ok: true, sid, expiresAt: result[0].session_end } : DENIED;
	}

	async session(token: string, sid: string) {
		if (
			typeof token !== 'string' ||
			token.length !== 36 ||
			typeof sid !== 'string' ||
			sid.length !== 36
		)
			return DENIED;
		const [device, key] = await Promise.all([digest(token), digest(sid)]);
		const now = Date.now();
		const row = this.sql
			.exec(
				'SELECT user_id,username,session_end FROM cashier_device WHERE device=? AND sid=? AND until_ms>? AND session_end>?',
				device,
				key,
				now,
				now
			)
			.toArray()[0];
		return row
			? {
					ok: true,
					scope: 'operasional' as const,
					userId: String(row.user_id),
					username: String(row.username),
					expiresAt: Number(row.session_end)
				}
			: DENIED;
	}

	async logout(token: string, sid: string) {
		const [device, key] = await Promise.all([digest(token), digest(sid)]);
		this.sql.exec(
			'UPDATE cashier_device SET sid=NULL, session_end=0 WHERE device=? AND sid=?',
			device,
			key
		);
		return { ok: true };
	}

	async revoke(token: string) {
		this.sql.exec('DELETE FROM cashier_device WHERE device=?', await digest(token));
		return { ok: true };
	}
}
