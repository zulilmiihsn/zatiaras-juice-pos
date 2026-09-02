import { constantTimeEqual } from '$lib/server/secureCompare';

const PIN_HASH_ALGORITHM = 'PBKDF2';
const PIN_HASH_DIGEST = 'SHA-256';
const PIN_HASH_ITERATIONS = 210_000;
const PIN_HASH_BYTES = 32;
const PIN_SALT_BYTES = 16;
const PIN_HASH_PREFIX = 'pbkdf2-sha256';
const DISALLOWED_PINS = new Set(['0000', '1111', '1234', '4321']);

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < value.length; index += 2) {
		bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
	}
	return bytes;
}

async function derivePin(
	pin: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pin),
		{ name: PIN_HASH_ALGORITHM },
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: PIN_HASH_ALGORITHM,
			hash: PIN_HASH_DIGEST,
			salt,
			iterations
		},
		key,
		PIN_HASH_BYTES * 8
	);
	return new Uint8Array(bits);
}

export function validateNewPin(pin: unknown): string | null {
	if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
		return 'PIN harus 4-6 digit angka';
	}
	if (DISALLOWED_PINS.has(pin)) {
		return 'Gunakan PIN yang tidak mudah ditebak';
	}
	return null;
}

export async function hashPin(pin: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES));
	const hash = await derivePin(pin, salt, PIN_HASH_ITERATIONS);
	return `${PIN_HASH_PREFIX}$${PIN_HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPinHash(pin: string, encoded: string): Promise<boolean> {
	const [prefix, iterationsRaw, saltHex, expectedHex, extra] = encoded.split('$');
	if (prefix !== PIN_HASH_PREFIX || extra !== undefined) return false;
	const iterations = Number.parseInt(iterationsRaw, 10);
	const salt = hexToBytes(saltHex);
	if (
		!Number.isInteger(iterations) ||
		iterations < 100_000 ||
		iterations > 1_000_000 ||
		!salt ||
		salt.length < 16 ||
		expectedHex.length !== PIN_HASH_BYTES * 2
	) {
		return false;
	}
	const actual = bytesToHex(await derivePin(pin, salt, iterations));
	return constantTimeEqual(actual, expectedHex.toLowerCase());
}
