import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createE2eEnvironment } from './e2e-environment.mjs';

test('parallel E2E environments own different state and cleanup preserves neighbours', () => {
	const parent = mkdtempSync(
		join(process.env.ZATIARAS_TEST_TMPDIR || tmpdir(), 'zatiaras-isolation-test-')
	);
	try {
		const sentinel = join(parent, 'dev-state-sentinel');
		writeFileSync(sentinel, 'keep');
		const a = createE2eEnvironment(parent);
		const b = createE2eEnvironment(parent);
		assert.notEqual(a.persistPath, b.persistPath);
		assert.notEqual(a.password, b.password);
		const config = JSON.parse(readFileSync(a.configPath, 'utf8'));
		assert.equal(config.d1_databases.length, 3);
		assert.ok(!a.persistPath.includes('.wrangler'));
		a.cleanup();
		a.cleanup();
		assert.equal(existsSync(a.directory), false);
		assert.equal(existsSync(b.configPath), true);
		assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
		b.cleanup();
		assert.deepEqual(readdirSync(parent), ['dev-state-sentinel']);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test('configuration initialization failure does not touch project state', () => {
	assert.throws(
		() => createE2eEnvironment(join(tmpdir(), 'nonexistent-e2e-parent', 'nested')),
		/ENOENT/
	);
});
