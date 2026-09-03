import { error as kitError, json } from '@sveltejs/kit';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { grantSessionPageUnlock } from '$lib/server/sessionStore';
import { isProtectedPage } from '$lib/server/pageAccess';
import { constantTimeEqual } from '$lib/server/secureCompare';
import { hashPin, verifyPinHash } from '$lib/server/pinHash';
import type { RequestHandler } from './$types';

const PIN_WINDOW_MS = 5 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 10;
const UNLOCK_TTL_MS = 15 * 60 * 1000;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	const branch = requireSessionBranch(locals);
	if (session.role !== 'kasir') throw kitError(403, 'Verifikasi PIN hanya untuk kasir');

	const body = (await request.json().catch(() => null)) as { pin?: unknown; page?: unknown } | null;
	const pin = typeof body?.pin === 'string' ? body.pin : '';
	if (!/^\d{4,6}$/.test(pin) || !isProtectedPage(body?.page)) {
		throw kitError(400, 'PIN atau halaman tidak valid');
	}

	const rawDb = getRawDb(platform, branch);
	const rateLimit = await consumeRateLimit(
		rawDb,
		branch,
		`pin:session:${session.id}`,
		PIN_MAX_ATTEMPTS,
		PIN_WINDOW_MS,
		platform
	);
	if (!rateLimit.available) {
		return json(
			{ ok: false, message: 'Verifikasi PIN sementara tidak tersedia' },
			{ status: 503, headers: { 'Retry-After': '5' } }
		);
	}
	if (!rateLimit.allowed) {
		return json(
			{ ok: false, message: 'Terlalu banyak percobaan PIN' },
			{
				status: 429,
				headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
			}
		);
	}

	const settings = (await rawDb
		.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id = ? LIMIT 1')
		.bind(branch)
		.first()) as { pin?: string | null; pin_hash?: string | null } | null;
	if (!settings?.pin_hash && (!settings?.pin || settings.pin === '1234')) {
		return json({ ok: false, message: 'PIN belum dikonfigurasi' }, { status: 409 });
	}

	const valid = settings.pin_hash
		? await verifyPinHash(pin, settings.pin_hash)
		: constantTimeEqual(pin, settings.pin || '');
	if (!valid) {
		return json({ ok: false, message: 'PIN salah' }, { status: 403 });
	}
	if (!settings.pin_hash && settings.pin) {
		const migratedHash = await hashPin(pin);
		await rawDb
			.prepare('UPDATE pengaturan SET pin_hash = ?, pin = NULL, updated_at = ? WHERE cabang_id = ?')
			.bind(migratedHash, new Date().toISOString(), branch)
			.run();
	}

	const expiresAt = Date.now() + UNLOCK_TTL_MS;
	await grantSessionPageUnlock(platform, session, body.page, expiresAt);
	return json({ ok: true, expiresAt });
};
