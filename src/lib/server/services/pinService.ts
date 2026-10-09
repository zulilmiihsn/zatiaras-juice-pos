import type { BranchContext } from '$lib/server/branchResolver';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { hashPin, validateNewPin, verifyPinHash } from '$lib/server/pinHash';
import { constantTimeEqual } from '$lib/server/secureCompare';
import { appendAuditLog } from '$lib/server/auditLog';
import { grantSessionPageUnlock, revokeBranchPageUnlocks } from '$lib/server/sessionStore';
import { isProtectedPage, type ProtectedPage } from '$lib/server/pageAccess';
import { error as kitError } from '@sveltejs/kit';

export type SessionUser = App.Locals['authSession'];

const PIN_WINDOW_MS = 5 * 60 * 1000;
const PIN_MAX_ATTEMPTS = 10;
const UNLOCK_TTL_MS = 15 * 60 * 1000;
const PIN_CHANGE_WINDOW_MS = 15 * 60 * 1000;
const PIN_CHANGE_MAX_ATTEMPTS = 5;

type PinRow = {
	id: string;
	pin: string | null;
	pin_hash: string | null;
};

export type PinVerifyResult =
	| { ok: true; expiresAt: number }
	| { ok: false; message: string; status: number; retryAfterSeconds?: number };

/**
 * Verifikasi PIN kasir untuk buka halaman terkunci. Hasil non-ok dikembalikan
 * sebagai data (bukan throw) agar route memetakan status HTTP persis sama.
 */
export async function verifyPinForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: NonNullable<SessionUser>,
	pin: string,
	page: unknown
): Promise<PinVerifyResult> {
	if (!/^\d{4}$/.test(pin) || !isProtectedPage(page)) {
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
		return {
			ok: false,
			message: 'Verifikasi PIN sementara tidak tersedia',
			status: 503,
			retryAfterSeconds: 5
		};
	}
	if (!rateLimit.allowed) {
		return {
			ok: false,
			message: 'Terlalu banyak percobaan PIN',
			status: 429,
			retryAfterSeconds: rateLimit.retryAfterSeconds
		};
	}

	const settings = (await rawDb
		.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id = ? AND kunci IS NULL LIMIT 1')
		.bind(branch)
		.first()) as { pin?: string | null; pin_hash?: string | null } | null;
	if (!settings?.pin_hash && (!settings?.pin || settings.pin === '1234')) {
		return { ok: false, message: 'PIN belum dikonfigurasi', status: 409 };
	}

	const valid = settings.pin_hash
		? await verifyPinHash(pin, settings.pin_hash)
		: constantTimeEqual(pin, settings.pin || '');
	if (!valid) {
		return { ok: false, message: 'PIN salah', status: 403 };
	}
	if (!settings.pin_hash && settings.pin) {
		const migratedHash = await hashPin(pin);
		await rawDb
			.prepare(
				'UPDATE pengaturan SET pin_hash = ?, pin = NULL, updated_at = ? WHERE cabang_id = ? AND kunci IS NULL'
			)
			.bind(migratedHash, new Date().toISOString(), branch)
			.run();
	}

	const expiresAt = Date.now() + UNLOCK_TTL_MS;
	await grantSessionPageUnlock(platform, session, page as ProtectedPage, expiresAt);
	return { ok: true, expiresAt };
}

/**
 * Ganti PIN cabang (pemilik). Throw kitError dengan status persis kontrak route.
 */
export async function changePinForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: NonNullable<SessionUser>,
	currentPin: string,
	newPin: string
) {
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
		.prepare(
			'SELECT id, pin, pin_hash FROM pengaturan WHERE cabang_id = ? AND kunci IS NULL LIMIT 1'
		)
		.bind(branch)
		.first()) as PinRow | null;
	if (!settings) throw kitError(409, 'Pengaturan cabang belum tersedia');

	const hasLegacyPin = Boolean(settings.pin && settings.pin !== '1234');
	const hasConfiguredPin = Boolean(settings.pin_hash || hasLegacyPin);
	if (hasConfiguredPin) {
		if (!/^\d{4}$/.test(currentPin)) throw kitError(400, 'PIN lama wajib diisi');
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
	const updateResult = (await rawDb
		.prepare(
			`UPDATE pengaturan
			 SET pin_hash = ?, pin = NULL, updated_at = ?
			 WHERE cabang_id = ? AND id = ? AND kunci IS NULL`
		)
		.bind(pinHash, new Date().toISOString(), branch, String(settings.id))
		.run()) as unknown as { meta?: { changes?: number } };
	if (!Number(updateResult?.meta?.changes ?? 0)) throw kitError(409, 'Pengaturan cabang berubah');
	try {
		await revokeBranchPageUnlocks(platform, branch);
	} catch (e) {
		console.warn('[pin] revokeBranchPageUnlocks failed:', e);
	}
	try {
		await appendAuditLog(rawDb, branch, {
			action: hasConfiguredPin ? 'pin.changed' : 'pin.configured',
			entityType: 'pengaturan',
			entityId: String(settings.id),
			session
		});
	} catch (e) {
		console.warn('[pin] appendAuditLog failed:', e);
	}

	return { ok: true, pinConfigured: true };
}
