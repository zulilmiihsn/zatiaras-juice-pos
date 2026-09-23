import assert from 'node:assert/strict';
import { computeMetrics } from '../../scripts/quality-baseline.mjs';

/**
 * Kontrak error code API (MNT-05).
 * UI dan operator boleh bergantung pada `code`, bukan teks pesan.
 * Menambah/menghapus code = review kompatibilitas + update registry ini.
 */
const APPROVED_ERROR_CODES = [
	'BRANCH_FORBIDDEN',
	'CSRF_INVALID',
	'FORBIDDEN',
	'INVALID_BRANCH',
	'INVALID_CREDENTIALS',
	'INVALID_JSON',
	'INVALID_ROLE',
	'NOT_FOUND',
	'NO_DATA',
	'PAYLOAD_TOO_LARGE',
	'RATE_LIMITED',
	'RATE_LIMITER_UNAVAILABLE',
	'SERVER_ERROR',
	'SERVICE_UNAVAILABLE',
	'UNAUTHORIZED',
	'UNSUPPORTED_EVENT_TYPE',
	'USERNAME_EXISTS',
	'VALIDATION_ERROR',
	'WEAK_PASSWORD'
];

const { errorCodes } = computeMetrics();
assert.deepEqual(
	errorCodes,
	APPROVED_ERROR_CODES,
	`error code berubah: tambah/hapus code hanya lewat review kompatibilitas. Aktual: ${errorCodes.join(', ')}`
);

// Code kritis yang dipakai UI/auth wajib tetap ada.
for (const required of [
	'VALIDATION_ERROR',
	'BRANCH_FORBIDDEN',
	'RATE_LIMITED',
	'NO_DATA',
	'SERVER_ERROR',
	'SERVICE_UNAVAILABLE',
	'UNAUTHORIZED'
]) {
	assert.ok(errorCodes.includes(required), `error code kritis hilang: ${required}`);
}

console.log(`error-code-contract-tests: ${errorCodes.length} code terdaftar, kontrak stabil`);
process.exit(0);
