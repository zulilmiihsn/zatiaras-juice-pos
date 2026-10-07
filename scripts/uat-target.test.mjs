import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolveUatTarget } from './uat-target.mjs';

await test('loopback exact diterima', () => {
	for (const raw of ['http://127.0.0.1:5173', 'http://localhost:3000/', 'http://[::1]:8080/x']) {
		const { baseUrl, local } = resolveUatTarget(raw);
		assert.equal(local, true);
		assert.ok(baseUrl.startsWith('http://'));
	}
});

await test('lookalike/userinfo/skema ditolak tanpa akses kredensial', () => {
	for (const raw of [
		'http://localhost.audit.invalid',
		'http://127.0.0.1.evil.com',
		'http://127.0.0.1@evil.invalid/',
		'http://user:pass@127.0.0.1:5173/',
		'ftp://127.0.0.1/',
		'https://127.0.0.1:5173/',
		'http://evil.invalid/',
		'bukan-url'
	]) {
		assert.throws(() => resolveUatTarget(raw), Error, raw);
	}
});

await test('remote https hanya dengan otorisasi eksplisit', () => {
	assert.throws(() => resolveUatTarget('https://pos.example.com'));
	const { baseUrl, local } = resolveUatTarget('https://pos.example.com', { allowRemote: true });
	assert.equal(local, false);
	assert.equal(baseUrl, 'https://pos.example.com');
});

await test('CLI asli menolak lookalike sebelum kirim apa pun', () => {
	for (const raw of ['http://localhost.audit.invalid:9', 'http://127.0.0.1@evil.invalid/']) {
		const r = spawnSync(process.execPath, ['scripts/uat-pos-integrity.mjs', raw], {
			encoding: 'utf8',
			stdio: 'pipe'
		});
		assert.notEqual(r.status, 0, raw);
		assert.match(r.stderr + r.stdout, /loopback|userinfo|Target UAT/);
	}
});
