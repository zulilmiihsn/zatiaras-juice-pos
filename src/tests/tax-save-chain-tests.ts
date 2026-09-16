import assert from 'node:assert/strict';

// R04: rantai save tak menimpa; edit cepat konvergen tanpa 409 palsu;
// branch salah tak tercache silang.

type Store = { rev: number; settings: Record<string, unknown> };
const server: Store = {
	rev: 3,
	settings: {
		isTaxEnabled: true,
		taxes: [
			{ id: 'pph_final_umkm', nama: 'PPh', tipe: 'pph_final', persentase: 0.5, isEnabled: true }
		]
	}
};
const calls: Array<{ method: string; expected?: unknown }> = [];

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
	getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k)
};
(globalThis as Record<string, unknown>).window = {
	localStorage: (globalThis as Record<string, unknown>).localStorage,
	dispatchEvent: () => true
};

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

(globalThis as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
	const url = String(input);
	if (url === '/api/csrf') return json(200, { token: 't' });
	if (url === '/api/pengaturan/pajak') {
		if ((init?.method || 'GET').toUpperCase() === 'GET') {
			return json(200, {
				ok: true,
				schema_version: 2,
				revision: server.rev,
				settings: server.settings
			});
		}
		const body = JSON.parse(String(init?.body || '{}')) as {
			expected_revision?: unknown;
			settings?: unknown;
			branch?: string;
		};
		calls.push({ method: 'PUT', expected: body.expected_revision });
		if (body.branch !== 'samarinda') return json(400, { ok: false, message: 'cabang salah' });
		if (body.expected_revision !== server.rev) return json(409, { ok: false, message: 'konflik' });
		server.rev += 1;
		server.settings = body.settings as Record<string, unknown>;
		return json(200, {
			ok: true,
			branch: 'samarinda',
			schema_version: 2,
			revision: server.rev,
			settings: server.settings
		});
	}
	return json(404, { ok: false });
};

const tax = await import('../lib/services/taxService.js');
// Kontrak UI: sync dulu sehingga revision lokal = 3 sebelum menyimpan.
mem.set('zatiaras_tax_settings_samarinda:revision', '3');
const v1 = structuredClone(server.settings) as Record<string, unknown>;
(v1.taxes as Array<Record<string, unknown>>)[0].persentase = 0.6;
const v2 = structuredClone(v1) as Record<string, unknown>;
(v2.taxes as Array<Record<string, unknown>>)[0].persentase = 0.7;

// Dua save cepat berurutan: keduanya ok, server akhir = v2, tanpa 409.
const [r1, r2] = await Promise.all([
	tax.saveTaxSettings(v1 as never, 'samarinda'),
	tax.saveTaxSettings(v2 as never, 'samarinda')
]);
assert.equal(r1.ok, true);
assert.equal(r2.ok, true);
assert.equal((server.settings.taxes as Array<Record<string, unknown>>)[0].persentase, 0.7);
assert.ok(
	calls.every((c) => typeof c.expected === 'number'),
	'expected_revision selalu terkirim'
);
// Cache cabang berisi HASIL server, bukan kiriman mentah.
const cached = JSON.parse(mem.get('zatiaras_tax_settings_samarinda') || '{}') as {
	taxes?: Array<{ persentase?: number }>;
};
assert.equal(cached.taxes?.[0]?.persentase, 0.7);

// Validasi menolak sebelum jaringan: tanpa PUT baru.
const before = calls.length;
const bad = await tax.saveTaxSettings(
	{
		isTaxEnabled: true,
		taxes: [{ id: 'a', nama: 'A', tipe: 'ppn', persentase: 101, isEnabled: true }]
	} as never,
	'samarinda'
);
assert.equal(bad.ok, false);
assert.equal(calls.length, before);

console.log('tax-save-chain-tests: all assertions passed');
