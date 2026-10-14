import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

const DOCS = ['README.md', 'DEVELOPER-GUIDE.md', 'AGENTS.md', 'docs/OPERATOR-RUNBOOK.md'];
for (const doc of DOCS) {
	const text = readFileSync(join(ROOT, doc), 'utf8');
	checkPnpmTokens(doc, text);
	// Tautan relatif antar dokumen wajib menunjuk file/folder yang ada.
	for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
		const target = join(ROOT, dirname(doc), m[1]);
		assert.ok(existsSync(target), `${doc} menautkan ${m[1]} yang tidak ada`);
	}
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

// Job CI wajib ada.
{
	const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
	// Job `quality` dihapus; ia mengulang check/lint/build job static dan build.
	for (const job of ['static:', 'operations:', 'unit:', 'e2e:', 'build:']) {
		assert.ok(ci.includes(`\n  ${job}`), `job CI hilang: ${job}`);
	}
	assert.ok(!ci.includes('\n  quality:'), 'job CI quality duplikat muncul lagi');
	assert.equal(ci.split('run: pnpm build').length - 1, 1, 'CI wajib build tepat sekali');
	assert.equal(ci.split('run: pnpm check').length - 1, 1, 'CI wajib check tepat sekali');
}

// Rantai test:operations wajib hidup: tiap entri adalah script yang target file-nya ada.
{
	const entries = String(pkg.scripts['test:operations'] ?? '')
		.split('&&')
		.map((s) => s.trim().replace(/^pnpm\s+/, ''));
	assert.ok(entries.length > 0, 'rantai test:operations kosong');
	for (const name of entries) {
		const command = pkg.scripts[name];
		assert.ok(command, `rantai test:operations memanggil script hilang: ${name}`);
		const file = command
			.split('&&')
			.map((s) => s.trim())
			.map((s) => s.match(/^(?:tsx|node --test)\s+(\S+)/)?.[1])
			.find(Boolean);
		if (file) assert.ok(existsSync(join(ROOT, file)), `target suite hilang: ${file}`);
	}
}

// test:unit menjalankan semua src/tests/*-tests.ts lewat glob. Agar tiap suite tetap
// bisa dijalankan sendiri dan terlihat di CI, setiap file wajib punya script test:*
// yang menunjuknya, dan script itu wajib dipanggil di workflow CI.
{
	assert.match(pkg.scripts['test:unit'] ?? '', /--test\b.*src\/tests\/\*-tests\.ts/);
	const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
	const suites = readdirSync(join(ROOT, 'src/tests')).filter((f) => f.endsWith('-tests.ts'));
	assert.ok(suites.length > 0, 'tidak ada suite unit');
	for (const suite of suites) {
		const script = Object.entries(pkg.scripts).find(
			([name, command]) => name.startsWith('test:') && command.includes(`src/tests/${suite}`)
		)?.[0];
		assert.ok(script, `${suite} belum punya script test:* di package.json`);
		assert.ok(
			new RegExp(`pnpm ${script}(?![\\w:-])`).test(ci) || ci.includes(`src/tests/${suite}`),
			`${script} (${suite}) tidak dijalankan di CI`
		);
	}
}

console.log('docs-drift-tests: dokumen, tautan, dan workflow sinkron dengan package.json');
process.exit(0);
