import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Directives = Record<string, string[]>;

const { default: config } = (await import(
	pathToFileURL(join(process.cwd(), 'svelte.config.js')).href
)) as { default: { kit: { csp: { directives: Directives } } } };
const csp = config.kit.csp.directives;

const sources = (name: string): string[] => csp[name] ?? [];
const remoteHosts = (name: string) => sources(name).filter((s) => /^https?:\/\//.test(s));

// Skrip: hanya kode aplikasi sendiri; inline dijaga nonce/hash otomatis oleh SvelteKit.
assert.deepEqual(sources('script-src'), ['self']);
assert.ok(!sources('script-src').includes('unsafe-eval'), 'script-src tidak boleh unsafe-eval');

// Permukaan koneksi klien: tanpa CDN, tanpa OpenRouter (AI dipanggil dari server),
// dan ws: polos (cleartext ke host mana pun) tidak boleh kembali.
assert.deepEqual(remoteHosts('connect-src'), [], 'connect-src tidak boleh membuka host https');
assert.ok(!sources('connect-src').includes('ws:'), 'connect-src tidak boleh membuka ws: polos');
for (const source of sources('connect-src').filter((s) => s.startsWith('ws://'))) {
	assert.match(source, /^ws:\/\/(localhost|127\.0\.0\.1):\*$/, `ws non-loopback: ${source}`);
}

// Worker tidak boleh memuat kode dari CDN.
assert.deepEqual(remoteHosts('worker-src'), [], 'worker-src tidak boleh membuka host https');

// Satu-satunya host pihak ketiga: Google Fonts (stylesheet + berkas font).
assert.deepEqual(remoteHosts('style-src'), ['https://fonts.googleapis.com']);
assert.deepEqual(remoteHosts('font-src'), ['https://fonts.gstatic.com']);

// Gambar: tanpa https: bebas; satu host luar untuk gambar menu lama Samarinda.
assert.ok(!sources('img-src').includes('https:'), 'img-src tidak boleh membuka https: bebas');
assert.deepEqual(remoteHosts('img-src'), ['https://qmlzwklzahcfigjpoavz.supabase.co']);

// Pengunci dasar.
assert.deepEqual(sources('default-src'), ['self']);
assert.deepEqual(sources('object-src'), ['none']);
assert.deepEqual(sources('frame-ancestors'), ['none']);
assert.deepEqual(sources('base-uri'), ['self']);
assert.deepEqual(sources('form-action'), ['self']);

console.log('csp-policy-tests: kebijakan CSP tetap minimal dan tanpa host tak terpakai');
process.exit(0);
