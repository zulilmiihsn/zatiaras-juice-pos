import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
};
const scriptNames = new Set(Object.keys(pkg.scripts));

/** Perintah builtin pnpm yang bukan script repo. */
const PNPM_BUILTINS = new Set([
	'install',
	'add',
	'remove',
	'dlx',
	'exec',
	'audit',
	'approve-builds',
	'init',
	'create',
	'run',
	'why',
	'list',
	'outdated',
	'store',
	'publish',
	'pack',
	'rebuild',
	'version',
	'--version'
]);

function checkPnpmTokens(source: string, text: string) {
	// Hanya perintah dalam backtick (prose seperti "pnpm terinstal" diabaikan).
	for (const span of text.matchAll(/`([^`]+)`/g)) {
		for (const m of span[1].matchAll(/pnpm\s+([a-z][a-z0-9:@_/-]*)/g)) {
			const token = m[1];
			if (PNPM_BUILTINS.has(token)) continue;
			assert.ok(
				scriptNames.has(token),
				`${source} menyebut \`pnpm ${token}\` tetapi script tidak ada di package.json`
			);
		}
	}
}

for (const doc of ['README.md', 'DEVELOPER-GUIDE.md', 'ENGINEERING-IMPROVEMENT-PLAN.md']) {
	checkPnpmTokens(doc, readFileSync(join(ROOT, doc), 'utf8'));
}

// Workflow: `run: pnpm <script>` harus ada; `pnpm exec <bin>` harus terinstal.
for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
	const text = readFileSync(join(ROOT, workflow), 'utf8');
	for (const m of text.matchAll(/run:\s*pnpm\s+([a-z0-9:@_/-]+)/g)) {
		const token = m[1];
		if (PNPM_BUILTINS.has(token)) continue;
		assert.ok(
			scriptNames.has(token),
			`${workflow} menjalankan \`pnpm ${token}\` tetapi script tidak ada`
		);
	}
	for (const m of text.matchAll(/pnpm\s+exec\s+([a-z0-9@_/-]+)/g)) {
		const bin = m[1].split('/')[0].replace(/^@/, '');
		const found =
			existsSync(join(ROOT, 'node_modules', '.bin', m[1])) ||
			existsSync(join(ROOT, 'node_modules', '.bin', `${bin}.cmd`)) ||
			existsSync(join(ROOT, 'node_modules', '.bin', bin));
		assert.ok(found, `${workflow} memakai binary \`${m[1]}\` yang tidak terinstal`);
	}
}

// Job CI wajib ada (gate Fase 1-3).
{
	const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
	for (const job of ['static:', 'operations:', 'unit:', 'quality:', 'e2e:', 'build:']) {
		assert.ok(ci.includes(`\n  ${job}`), `job CI hilang: ${job}`);
	}
}

console.log('docs-drift-tests: README/DEVELOPER-GUIDE/plan/workflows sinkron dengan package.json');
process.exit(0);
