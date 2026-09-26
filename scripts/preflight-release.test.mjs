import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	ARTIFACT_ROOT,
	RUNTIME_ROOTS,
	buildManifest,
	hashFiles,
	readManifest,
	verifyManifest
} from './preflight-release.mjs';

const SHA = 'a'.repeat(40);

function fixture(fileCount = 3) {
	const root = mkdtempSync(join(tmpdir(), 'zatiaras-preflight-test-'));
	const artifact = join(root, ARTIFACT_ROOT);
	mkdirSync(join(artifact, 'nested'), { recursive: true });
	for (let i = 0; i < fileCount; i++) {
		writeFileSync(join(artifact, `file-${i}.txt`), `content-${i}\n`);
	}
	writeFileSync(join(artifact, 'nested', 'deep.txt'), 'deep\n');
	for (const runtimeRoot of RUNTIME_ROOTS) {
		mkdirSync(join(root, runtimeRoot), { recursive: true });
		writeFileSync(join(root, runtimeRoot, 'index.js'), 'runtime\n');
	}
	for (const file of ['wrangler.jsonc', 'wrangler.pages.jsonc', 'wrangler.realtime.jsonc']) {
		writeFileSync(join(root, file), '{}\n');
	}
	mkdirSync(join(root, 'drizzle', 'meta'), { recursive: true });
	writeFileSync(join(root, 'drizzle', 'meta', 'manifest.json'), '{}\n');
	writeFileSync(join(root, 'drizzle', 'meta', '_journal.json'), '{}\n');
	const cwd = process.cwd();
	process.chdir(root);
	const manifest = buildManifest({ headSha: SHA, branch: 'main' });
	return {
		root,
		cwd,
		manifest,
		done() {
			process.chdir(cwd);
			rmSync(root, { recursive: true, force: true });
		}
	};
}

test('manifest segar lulus verifikasi', () => {
	const fx = fixture();
	try {
		assert.deepEqual(verifyManifest(fx.manifest, SHA), []);
	} finally {
		fx.done();
	}
});

test('hash mencakup seluruh file tanpa batas 50 (REL-T08)', () => {
	const fx = fixture(60);
	try {
		assert.equal(Object.keys(fx.manifest.files).length, 61);
		assert.deepEqual(Object.keys(fx.manifest.files), [...Object.keys(fx.manifest.files)].sort());
		assert.deepEqual(verifyManifest(fx.manifest, SHA), []);
	} finally {
		fx.done();
	}
});

test('satu file diubah ditolak (REL-T05)', () => {
	const fx = fixture();
	try {
		writeFileSync(join(ARTIFACT_ROOT, 'file-0.txt'), 'tampered\n');
		const errors = verifyManifest(fx.manifest, SHA);
		assert.ok(
			errors.some((e) => e.includes('berubah: file-0.txt')),
			errors.join('; ')
		);
	} finally {
		fx.done();
	}
});

test('file hilang dan file tambahan ditolak', () => {
	const fx = fixture();
	try {
		rmSync(join(ARTIFACT_ROOT, 'file-1.txt'));
		writeFileSync(join(ARTIFACT_ROOT, 'extra.txt'), 'x\n');
		const errors = verifyManifest(fx.manifest, SHA);
		assert.ok(
			errors.some((e) => e.includes('hilang: file-1.txt')),
			errors.join('; ')
		);
		assert.ok(
			errors.some((e) => e.includes('tak tercatat: extra.txt')),
			errors.join('; ')
		);
	} finally {
		fx.done();
	}
});

test('runtime server dan manifest adapter hilang atau berubah ditolak', () => {
	const fx = fixture();
	try {
		writeFileSync(join(RUNTIME_ROOTS[0], 'index.js'), 'tampered\n');
		rmSync(join(RUNTIME_ROOTS[1], 'index.js'));
		const errors = verifyManifest(fx.manifest, SHA);
		assert.ok(errors.some((e) => e.includes(`berubah: ${RUNTIME_ROOTS[0]}/index.js`)));
		assert.ok(errors.some((e) => e.includes(`hilang: ${RUNTIME_ROOTS[1]}/index.js`)));
	} finally {
		fx.done();
	}
});

test('runtime tidak terpaket ditolak saat manifest dibuat', () => {
	const fx = fixture();
	try {
		rmSync(RUNTIME_ROOTS[1], { recursive: true });
		assert.throws(() => buildManifest({ headSha: SHA, branch: 'main' }), /Runtime root hilang/);
	} finally {
		fx.done();
	}
});

test('SHA berbeda ditolak (REL-T03)', () => {
	const fx = fixture();
	try {
		const errors = verifyManifest(fx.manifest, 'b'.repeat(40));
		assert.ok(
			errors.some((e) => e.includes('ekspektasi')),
			errors.join('; ')
		);
	} finally {
		fx.done();
	}
});

test('config berubah setelah manifest ditolak (REL-T06)', () => {
	const fx = fixture();
	try {
		writeFileSync('wrangler.pages.jsonc', '{"changed":true}\n');
		const errors = verifyManifest(fx.manifest, SHA);
		assert.ok(errors.some((e) => e.includes('Config') && e.includes('wrangler.pages.jsonc')));
	} finally {
		fx.done();
	}
});

test('hash direktori konsisten dengan manifest', () => {
	const fx = fixture(5);
	try {
		assert.deepEqual(hashFiles(ARTIFACT_ROOT), fx.manifest.files);
	} finally {
		fx.done();
	}
});

test('manifest hilang ditolak', () => {
	const root = mkdtempSync(join(tmpdir(), 'zatiaras-preflight-missing-'));
	const cwd = process.cwd();
	try {
		process.chdir(root);
		assert.throws(() => readManifest('tidak-ada.json'), /Manifest hilang/);
	} finally {
		process.chdir(cwd);
		rmSync(root, { recursive: true, force: true });
	}
});
