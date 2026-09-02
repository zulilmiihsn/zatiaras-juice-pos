const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 64 * 1024;

export type PosPricingTokenKind = 'catalog_product' | 'catalog_add_on' | 'checkout_quote';

export interface PosPricingTokenEnvelope<T> {
	v: number;
	kid: string;
	kind: PosPricingTokenKind;
	branch: string;
	issued_at: number;
	expires_at: number;
	data: T;
}

export class PosPricingTokenError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'SIGNING_KEY_UNAVAILABLE'
			| 'TOKEN_INVALID'
			| 'TOKEN_EXPIRED'
			| 'TOKEN_BRANCH_MISMATCH'
			| 'TOKEN_KIND_MISMATCH'
	) {
		super(message);
		this.name = 'PosPricingTokenError';
	}
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizeKeyId(value: unknown, fallback: string): string {
	return typeof value === 'string' && /^[a-zA-Z0-9._-]{1,32}$/.test(value.trim())
		? value.trim()
		: fallback;
}

function getSigningSecrets(env: App.Platform['env'] | undefined) {
	const currentSecret = env?.POS_PRICE_SIGNING_KEY?.trim();
	if (!currentSecret || currentSecret.length < 32) {
		throw new PosPricingTokenError(
			'POS price signing key tidak tersedia',
			'SIGNING_KEY_UNAVAILABLE'
		);
	}
	const current = {
		id: normalizeKeyId(env?.POS_PRICE_SIGNING_KEY_ID, 'current'),
		secret: currentSecret
	};

	const keyMap = new Map<string, { id: string; secret: string }>();
	keyMap.set(current.id, current);

	const previousSecret = env?.POS_PRICE_SIGNING_KEY_PREVIOUS?.trim();
	if (previousSecret && previousSecret.length >= 32) {
		const prevId = normalizeKeyId(env?.POS_PRICE_SIGNING_KEY_PREVIOUS_ID, 'previous');
		keyMap.set(prevId, { id: prevId, secret: previousSecret });
	}

	// Support multi-key rotation list if provided via JSON or indexed env
	const rawKeysJson = (env as Record<string, unknown> | undefined)?.POS_PRICE_SIGNING_KEYS_JSON;
	if (typeof rawKeysJson === 'string' && rawKeysJson.trim()) {
		try {
			const parsed = JSON.parse(rawKeysJson);
			if (Array.isArray(parsed)) {
				for (const k of parsed) {
					if (
						k &&
						typeof k === 'object' &&
						'id' in k &&
						'secret' in k &&
						typeof k.secret === 'string' &&
						k.secret.length >= 32
					) {
						keyMap.set(String(k.id), { id: String(k.id), secret: String(k.secret) });
					}
				}
			}
		} catch {}
	}

	return { current, keyMap };
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export function getPosPricingKeyId(env: App.Platform['env'] | undefined): string {
	return getSigningSecrets(env).current.id;
}

export async function signPosPricingToken<T>(
	env: App.Platform['env'] | undefined,
	input: {
		kind: PosPricingTokenKind;
		branch: string;
		data: T;
		ttlMs: number;
		now?: number;
	}
): Promise<string> {
	const now = input.now ?? Date.now();
	const signing = getSigningSecrets(env);
	const envelope: PosPricingTokenEnvelope<T> = {
		v: TOKEN_VERSION,
		kid: signing.current.id,
		kind: input.kind,
		branch: input.branch,
		issued_at: now,
		expires_at: now + input.ttlMs,
		data: input.data
	};
	const payload = toBase64Url(encoder.encode(JSON.stringify(envelope)));
	const key = await importSigningKey(signing.current.secret);
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: 'HMAC' }, key, encoder.encode(payload))
	);
	const token = `${payload}.${toBase64Url(signature)}`;
	if (token.length > MAX_TOKEN_LENGTH) {
		throw new PosPricingTokenError('Token harga terlalu besar', 'TOKEN_INVALID');
	}
	return token;
}

export async function verifyPosPricingToken<T>(
	env: App.Platform['env'] | undefined,
	token: unknown,
	input: {
		kind: PosPricingTokenKind;
		branch: string;
		now?: number;
	}
): Promise<PosPricingTokenEnvelope<T>> {
	if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
		throw new PosPricingTokenError('Token harga tidak valid', 'TOKEN_INVALID');
	}
	const [payload, signature, extra] = token.split('.');
	if (!payload || !signature || extra !== undefined) {
		throw new PosPricingTokenError('Token harga tidak valid', 'TOKEN_INVALID');
	}

	let signatureBytes: Uint8Array<ArrayBuffer>;
	let envelope: PosPricingTokenEnvelope<T>;
	try {
		signatureBytes = fromBase64Url(signature);
		envelope = JSON.parse(decoder.decode(fromBase64Url(payload))) as PosPricingTokenEnvelope<T>;
	} catch {
		throw new PosPricingTokenError('Token harga tidak valid', 'TOKEN_INVALID');
	}

	const signing = getSigningSecrets(env);
	const selected = signing.keyMap.get(envelope.kid);
	if (!selected) {
		throw new PosPricingTokenError('Key token harga tidak dikenal', 'TOKEN_INVALID');
	}
	const key = await importSigningKey(selected.secret);
	const valid = await crypto.subtle.verify(
		{ name: 'HMAC' },
		key,
		signatureBytes,
		encoder.encode(payload)
	);
	if (!valid || envelope.v !== TOKEN_VERSION) {
		throw new PosPricingTokenError('Token harga tidak valid', 'TOKEN_INVALID');
	}
	if (envelope.kind !== input.kind) {
		throw new PosPricingTokenError('Jenis token harga tidak valid', 'TOKEN_KIND_MISMATCH');
	}
	if (envelope.branch !== input.branch) {
		throw new PosPricingTokenError('Token harga berasal dari cabang lain', 'TOKEN_BRANCH_MISMATCH');
	}
	const validationTime = input.now ?? Date.now();
	if (!Number.isFinite(envelope.issued_at) || envelope.issued_at > validationTime + 30_000) {
		throw new PosPricingTokenError('Token harga belum berlaku', 'TOKEN_INVALID');
	}
	if (!Number.isFinite(envelope.expires_at) || envelope.expires_at <= validationTime) {
		throw new PosPricingTokenError('Token harga kedaluwarsa', 'TOKEN_EXPIRED');
	}
	return envelope;
}
