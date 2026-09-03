import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { hashPin, validateNewPin, verifyPinHash } from '$lib/server/pinHash';
import { constantTimeEqual } from '$lib/server/secureCompare';
import { appendAuditLog } from '$lib/server/auditLog';
import { revokeBranchPageUnlocks } from '$lib/server/sessionStore';
import type { RequestHandler } from './$types';

const PIN_CHANGE_WINDOW_MS = 15 * 60 * 1000;
const PIN_CHANGE_MAX_ATTEMPTS = 5;

type PinRow = {
	id: number;
	pin: string | null;
	pin_hash: string | null;
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	const branch = requireSessionBranch(locals);
	const body = (await request.json().catch(() => null)) as {
		currentPin?: unknown;
		newPin?: unknown;
	} | null;
	const currentPin = typeof body?.currentPin === 'string' ? body.currentPin : '';
	const newPin = typeof body?.newPin === 'string' ? body.newPin : '';
	const validationError = validateNewPin(newPin);
	if (validationError) throw kitError(400, validationError);

	const rawDb = getRawDb(platform, branch);
	const rateLimit = await consumeRateLimit(
		rawDb,
		branch,
		`pin-change:session:${session.id}`,
		PIN_CHANGE_MAX_ATTEMPTS,
		PIN_CHANGE_WINDOW_MS,
		platform
	);
	if (!rateLimit.available) throw kitError(503, 'Perubahan PIN sementara tidak tersedia');
	if (!rateLimit.allowed) {
		throw kitError(429, `Terlalu banyak percobaan. Coba lagi ${rateLimit.retryAfterSeconds} detik`);
	}

	const settings = (await rawDb
		.prepare('SELECT id, pin, pin_hash FROM pengaturan WHERE cabang_id = ? LIMIT 1')
		.bind(branch)
		.first()) as PinRow | null;
	if (!settings) throw kitError(409, 'Pengaturan cabang belum tersedia');

	const hasLegacyPin = Boolean(settings.pin && settings.pin !== '1234');
	const hasConfiguredPin = Boolean(settings.pin_hash || hasLegacyPin);
	if (hasConfiguredPin) {
		if (!/^\d{4,6}$/.test(currentPin)) throw kitError(400, 'PIN lama wajib diisi');
		const currentValid = settings.pin_hash
			? await verifyPinHash(currentPin, settings.pin_hash)
			: constantTimeEqual(currentPin, settings.pin || '');
		if (!currentValid) throw kitError(401, 'PIN lama salah');
	}

	const unchanged = settings.pin_hash
		? await verifyPinHash(newPin, settings.pin_hash)
		: hasLegacyPin && constantTimeEqual(newPin, settings.pin || '');
	if (unchanged) throw kitError(400, 'PIN baru harus berbeda');

	const pinHash = await hashPin(newPin);
	await rawDb
		.prepare(
			`UPDATE pengaturan
			 SET pin_hash = ?, pin = NULL, updated_at = ?
			 WHERE cabang_id = ? AND id = ?`
		)
		.bind(pinHash, new Date().toISOString(), branch, settings.id)
		.run();
	await revokeBranchPageUnlocks(platform, branch);
	await appendAuditLog(rawDb, branch, {
		action: hasConfiguredPin ? 'pin.changed' : 'pin.configured',
		entityType: 'pengaturan',
		entityId: String(settings.id),
		session
	});

	return json({ ok: true, pinConfigured: true });
};
