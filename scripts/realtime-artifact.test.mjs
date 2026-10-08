import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	patchWorkerText,
	verifyPatchedWorker,
	interceptMarker
} from './export-durable-objects.mjs';

const FAKE_WORKER = `var worker_default = {
	async fetch(req, env2) {
		await initialized;
    let pragma = req.headers.get("cache-control") || "";
		return new Response('ok');
	}
};`;

await test('patch tepat-sekali + idempoten + fail-closed', () => {
	const once = patchWorkerText(FAKE_WORKER);
	assert.equal(verifyPatchedWorker(once), true);
	assert.equal(once.split(interceptMarker).length - 1, 1);
	// Idempoten: patch kedua no-op byte-identik.
	assert.equal(patchWorkerText(once), once);
	// Insertion point hilang = throw, bukan patch buta.
	assert.throws(() => patchWorkerText('tidak ada worker di sini'), /insertion point/);
	assert.throws(() => verifyPatchedWorker(FAKE_WORKER), /Hookup realtime hilang|muncul 0x/);
});

await test('intercept tolak sesi asing/cabang salah (kontrak)', () => {
	const patched = patchWorkerText(FAKE_WORKER);
	// Kebijakan sesi kanonik ada di artifact: cookie sid + prefix cabang + expiry + 401/503.
	for (const snippet of [
		'zatiarasCookie(req',
		'zatiarasSessionBranch(sessionId)',
		'expires_at > ?',
		'Login diperlukan',
		'REALTIME_HUB'
	]) {
		assert.ok(patched.includes(snippet), snippet);
	}
});

await test('deploy:check hijau termasuk paritas shard + cron', () => {
	// Env dummy non-placeholder: checker file-level deterministik tanpa secret.
	const r = spawnSync('node', ['scripts/verify-cloudflare-deploy-config.mjs'], {
		encoding: 'utf8',
		stdio: 'pipe',
		env: {
			...process.env,
			CLOUDFLARE_API_TOKEN: 'dummy-ci-token-32-karakter-xxxx',
			POS_PRICE_SIGNING_KEY: 'dummy-ci-signing-key-32-karakter-x'
		}
	});
	assert.equal(r.status, 0, r.stderr || r.stdout);
	assert.match(r.stdout, /deploy config looks ready/);
});
