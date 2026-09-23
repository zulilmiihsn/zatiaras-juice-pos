import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (['node_modules', '.svelte-kit'].includes(entry.name)) continue;
			walk(full, out);
		} else if (/\.(ts|js|svelte|mjs)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

const files = walk(SRC);
/** @param {string} f @returns {number} */
const linesOf = (f) => readFileSync(f, 'utf8').split('\n').length;
const byLines = files
	.map((f) => ({ file: relative(ROOT, f).replace(/\\/g, '/'), lines: linesOf(f) }))
	.sort((a, b) => b.lines - a.lines);

/** @param {RegExp} re @returns {number} */
const countMatches = (re) => {
	let n = 0;
	for (const f of files) {
		const text = readFileSync(f, 'utf8');
		const m = text.match(re);
		if (m) n += m.length;
	}
	return n;
};

const anyCount = countMatches(/:\s*any\b|<any\b|\bas\s+any\b/g);
const emptyCatch = countMatches(/catch\s*{\s*}/g);

const routeDbImports = files
	.filter((f) => {
		const rel = relative(ROOT, f);
		if (!rel.startsWith(`src${sep}routes`)) return false;
		const text = readFileSync(f, 'utf8');
		return /getD1Database|getRawDb|getDrizzleDb/.test(text);
	})
	.map((f) => relative(ROOT, f).replace(/\\/g, '/'))
	.sort();

const codes = new Set();
for (const f of files) {
	const text = readFileSync(f, 'utf8');
	for (const m of text.matchAll(/code:\s*'([A-Z_]+)'/g)) codes.add(m[1]);
}

const testFiles = files.filter((f) => /tests\//.test(relative(ROOT, f).replace(/\\/g, '/'))).length;

export function computeMetrics() {
	return {
		srcFiles: files.length,
		totalLines: byLines.reduce((s, f) => s + f.lines, 0),
		topFiles: byLines.slice(0, 12),
		anyCount,
		emptyCatch,
		routeDbImportFiles: routeDbImports,
		routeDbImportCount: routeDbImports.length,
		errorCodes: [...codes].sort(),
		errorCodeCount: codes.size,
		testFiles
	};
}

const invokedAsMain =
	process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/quality-baseline.mjs');
if (invokedAsMain) {
	console.log(JSON.stringify(computeMetrics(), null, 2));
	for (const f of ['pnpm-lock.yaml', 'package.json']) {
		try {
			statSync(join(ROOT, f));
		} catch {
			console.error(`missing ${f}`);
			process.exitCode = 1;
		}
	}
}
