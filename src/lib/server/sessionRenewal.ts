import type { Cookies } from '@sveltejs/kit';
import { branchFromObservation, recordErrorEvent } from '$lib/server/observability';
import {
	renewAuthSession,
	SESSION_COOKIE,
	sessionCookieOptions,
	type AuthSession
} from '$lib/server/sessionStore';

/**
 * Perpanjang sesi (sliding) beserta cookie-nya. Kegagalan tidak boleh menggagalkan
 * request: sesi lama tetap berlaku, kegagalannya dicatat agar logout dini bisa ditelusuri.
 */
export async function refreshSessionCookie(
	platform: App.Platform | undefined,
	cookies: Cookies,
	session: AuthSession,
	secure: boolean
): Promise<AuthSession> {
	try {
		const renewed = await renewAuthSession(platform, session);
		if (!renewed) return session;
		cookies.set(
			SESSION_COOKIE,
			renewed.id,
			sessionCookieOptions(secure, renewed.expiresAt - Date.now())
		);
		return renewed;
	} catch (error) {
		await recordErrorEvent(platform, branchFromObservation(platform, session), {
			source: 'session.renew',
			error,
			session
		});
		return session;
	}
}
