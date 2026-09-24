const encoder = new TextEncoder();
const decoder = new TextDecoder();

const EPOCH_VERSION = 1;
const DOMAIN = 'stock-policy-epoch:v1';

export class StockPolicyEpochError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StockPolicyEpochError';
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

function getSecret(env: App.Platform['env'] | undefined): string {
	const secret = (env as Record<string, unknown> | undefined)?.POS_PRICE_SIGNING_KEY;
	if (typeof secret !== 'string' || secret.trim().length < 32) {
		throw new StockPolicyEpochError('Kunci tanda tangan kebijakan stok belum dikonfigurasi');
	}
	return secret.trim();
}

async function importKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export async function signStockPolicyEpoch(
	env: App.Platform['env'] | undefined,
	input: { branch: string; mode: 'tracked' | 'ignored'; revision: number; now?: number }
): Promise<string> {
	const issuedAt = input.now ?? Date.now();
	const payload = JSON.stringify({
		v: EPOCH_VERSION,
		domain: DOMAIN,
		branch: input.branch,
		mode: input.mode,
		revision: input.revision,
		issued_at: issuedAt
	});
	const encoded = toBase64Url(encoder.encode(payload));
	const key = await importKey(getSecret(env));
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: 'HMAC' }, key, encoder.encode(encoded))
	);
	return `${encoded}.${toBase64Url(signature)}`;
}

export async function verifyStockPolicyEpoch(
	env: App.Platform['env'] | undefined,
	token: unknown,
	branch: string
): Promise<{ mode: 'tracked' | 'ignored'; revision: number; issued_at: number }> {
	if (typeof token !== 'string' || !token)
		throw new StockPolicyEpochError('Token epoch tidak valid');
	const [payload, signature, extra] = token.split('.');
	if (!payload || !signature || extra !== undefined)
		throw new StockPolicyEpochError('Token epoch tidak valid');
	let envelope: Record<string, unknown>;
	try {
		envelope = JSON.parse(decoder.decode(fromBase64Url(payload))) as Record<string, unknown>;
	} catch {
		throw new StockPolicyEpochError('Token epoch tidak valid');
	}
	if (
		envelope.v !== EPOCH_VERSION ||
		envelope.domain !== DOMAIN ||
		envelope.branch !== branch ||
		(envelope.mode !== 'tracked' && envelope.mode !== 'ignored') ||
		!Number.isInteger(envelope.revision) ||
		(envelope.revision as number) < 0 ||
		!Number.isFinite(envelope.issued_at)
	) {
		throw new StockPolicyEpochError('Token epoch tidak valid');
	}
	const key = await importKey(getSecret(env));
	const valid = await crypto.subtle.verify(
		{ name: 'HMAC' },
		key,
		fromBase64Url(signature),
		encoder.encode(payload)
	);
	if (!valid) throw new StockPolicyEpochError('Token epoch tidak valid');
	return {
		mode: envelope.mode as 'tracked' | 'ignored',
		revision: envelope.revision as number,
		issued_at: envelope.issued_at as number
	};
}
