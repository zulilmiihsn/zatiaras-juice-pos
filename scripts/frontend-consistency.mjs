import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from 'svelte/compiler';

/**
 * Metrik konsistensi frontend. Dipakai `frontend-consistency-guard-tests.ts` sebagai ratchet
 * dan dijalankan langsung untuk melihat angka + lokasi:
 *   node scripts/frontend-consistency.mjs [--details] [--json]
 * Tiap metrik = jumlah pelanggaran satu pola; target akhir hampir semuanya 0.
 * Daftar kartu dan resep perbaikan ada di docs/FRONTEND-CONSISTENCY.md.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

/** AST dari svelte/compiler tak punya tipe longgar yang stabil; hanya dibaca secara defensif. */
/** @typedef {any} AstNode */

/** @param {string} dir @param {RegExp} pattern @param {string[]} [out] @returns {string[]} */
function walk(dir, pattern, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (['node_modules', '.svelte-kit'].includes(entry.name)) continue;
			walk(full, pattern, out);
		} else if (pattern.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/** @param {string} p @returns {string} */
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
/** @param {string} text @param {number} index @returns {number} */
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** @type {Map<string, string>} */
const cache = new Map();
/** @param {string} file @returns {string} */
function read(file) {
	let text = cache.get(file);
	if (text === undefined) {
		text = readFileSync(file, 'utf8');
		cache.set(file, text);
	}
	return text;
}

export function computeMetrics() {
	const svelteFiles = walk(SRC, /\.svelte$/).filter((f) => !rel(f).startsWith('src/tests/'));
	const srcCodeFiles = walk(SRC, /\.(svelte|ts)$/).filter((f) => !rel(f).startsWith('src/tests/'));
	const e2eFiles = walk(join(ROOT, 'e2e'), /\.ts$/);
	const storeFiles = walk(join(SRC, 'lib', 'stores'), /\.ts$/);

	/** @type {Record<string, string[]>} */
	const details = {};
	/** @param {string} name @param {string} where */
	const hit = (name, where) => (details[name] ??= []).push(where);

	/** Cocokkan regex global per file; tiap kecocokan = satu pelanggaran. */
	/** @param {string} name @param {string[]} files @param {RegExp} re */
	function scan(name, files, re) {
		details[name] ??= [];
		for (const file of files) {
			const text = read(file);
			for (const m of text.matchAll(re)) hit(name, `${rel(file)}:${lineOf(text, m.index ?? 0)}`);
		}
	}

	// ---- Pola berbasis teks ----------------------------------------------------------------
	scan('effectAssignOnly', srcCodeFiles, /\$effect\(\(\) => \{\s*[\w.]+\s*=\s*[^;{}]+;\s*\}\)/g);
	scan('appStoresImport', srcCodeFiles, /from\s+'\$app\/stores'/g);
	scan(
		'consoleLogClient',
		srcCodeFiles.filter((f) => {
			const p = rel(f);
			if (p.includes('.server.') || p.includes('/api/') || p.includes('+server')) return false;
			return /^src\/(routes|lib\/(components|stores|services|utils))\//.test(p);
		}),
		/console\.log\(/g
	);
	scan('staleVersionText', svelteFiles, /v1\.0\b|©\s*2024/g);
	scan('arbitraryDvh', svelteFiles, /(?:min-)?h-\[100dvh\]/g);
	scan('flexShrinkAlias', svelteFiles, /(?<![\w-])flex-shrink-/g);
	scan('roleButton', svelteFiles, /role="button"/g);
	scan('brandHexClass', svelteFiles, /\[#(?:db2777|ec4899|f43f5e)\]/gi);
	scan('canvasHex', svelteFiles, /\[#faf7f8\]/gi);
	scan('neutralNonSlate', svelteFiles, /-(?:gray|stone|zinc|neutral)-\d{2,3}\b/g);
	scan(
		'roleLiteralUI',
		[...svelteFiles, ...storeFiles],
		/[Rr]ole(?:\.value)?\s*[!=]==\s*'(?:pemilik|admin|kasir)'/g
	);
	scan('e2eWaitForTimeout', e2eFiles, /waitForTimeout\(/g);

	// Gradien merek di app.css masih memakai hex yang sama dengan kelas arbitrer di atas.
	const appCss = join(SRC, 'app.css');
	if (existsSync(appCss)) {
		const lines = read(appCss).split('\n');
		lines.forEach((text, i) => {
			if (/gradient\(.*#(?:db2777|ec4899|f43f5e)/i.test(text))
				hit('brandHexClass', `src/app.css:${i + 1}`);
		});
	}

	// ---- Pola berbasis file / nama ---------------------------------------------------------
	details.lowercaseComponentFiles = walk(join(SRC, 'lib', 'components'), /\.svelte$/)
		.filter((f) => /^[a-z]/.test(basename(f)))
		.map(rel);

	details.inlineToast = svelteFiles
		.filter((f) => basename(f).toLowerCase() !== 'toastnotification.svelte')
		.filter((f) => read(f).includes('z-toast'))
		.map(rel);

	// Import `.svelte` yang beda huruf besar/kecil dari nama file di disk lolos di Windows/macOS
	// tetapi gagal di CI Linux.
	details.importPathCaseMismatch = [];
	for (const file of srcCodeFiles) {
		const text = read(file);
		for (const m of text.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+\.svelte)['"]/g)) {
			const spec = m[1];
			const target = spec.startsWith('$lib/')
				? join(SRC, 'lib', spec.slice(5))
				: spec.startsWith('.')
					? resolve(dirname(file), spec)
					: null;
			if (target && hasCaseMismatch(target)) {
				hit('importPathCaseMismatch', `${rel(file)}:${lineOf(text, m.index ?? 0)} ${spec}`);
			}
		}
	}

	// ---- Pola berbasis AST Svelte ----------------------------------------------------------
	for (const name of ['nestedStyle', 'pureGotoButton', 'headerBackGoto', 'overlayFiles']) {
		details[name] ??= [];
	}
	/** @type {Map<string, string[]>} */
	const classGroups = new Map();
	/** @type {string[]} */
	const parseFailures = [];

	for (const file of svelteFiles) {
		const src = read(file);
		/** @type {AstNode} */
		let ast;
		try {
			ast = parse(src, { modern: true });
		} catch (error) {
			parseFailures.push(`${rel(file)}: ${error instanceof Error ? error.message : error}`);
			continue;
		}
		const guardsFocus = src.includes('use:modalFocus');

		/** @param {AstNode} node @returns {string} */
		const where = (node) => `${rel(file)}:${lineOf(src, node.start)}`;
		/** @param {AstNode} node @param {string} name @returns {AstNode} */
		const attr = (node, name) =>
			node.attributes?.find(
				(/** @type {AstNode} */ a) => a.type === 'Attribute' && a.name === name
			);
		/** @param {AstNode} a @returns {string} isi atribut apa adanya, tanpa kurung kurawal */
		const attrExpr = (a) => {
			if (!a || a.value === true) return '';
			const parts = Array.isArray(a.value) ? a.value : [a.value];
			return parts
				.map((/** @type {AstNode} */ v) => src.slice(v.start, v.end))
				.join('')
				.replace(/^\{|\}$/g, '')
				.trim();
		};
		/** @param {AstNode} a @returns {string | null} kelas statis; ekspresi disisipkan apa adanya */
		const classText = (a) => {
			if (!a || a.value === true) return null;
			const parts = Array.isArray(a.value) ? a.value : [a.value];
			return parts
				.map((/** @type {AstNode} */ v) =>
					v.type === 'Text' ? v.data : ` ${src.slice(v.start, v.end)} `
				)
				.join('');
		};

		/** @param {AstNode} node */
		const visit = (node) => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) {
				node.forEach(visit);
				return;
			}
			if (node.type === 'RegularElement') {
				if (node.name === 'style') hit('nestedStyle', where(node));
				const cls = classText(attr(node, 'class'));
				if (cls !== null) {
					const tokens = cls.split(/\s+/);
					if (tokens.includes('fixed') && tokens.includes('inset-0') && !guardsFocus) {
						hit('overlayFiles', where(node));
					}
					const flat = cls.replace(/\s+/g, ' ').trim();
					if (flat.length >= 90 && !flat.includes('{')) {
						const list = classGroups.get(flat) ?? [];
						list.push(where(node));
						classGroups.set(flat, list);
					}
				}
				if (node.name === 'button') {
					const onclick = attrExpr(attr(node, 'onclick'));
					if (/^\(\)\s*=>\s*goto\(\s*(['"])[^'"`$]*\1\s*\)$/.test(onclick)) {
						hit('pureGotoButton', where(node));
					}
				}
			}
			if (node.type === 'Component' && node.name === 'HeaderBackButton') {
				if (/^\(\)\s*=>\s*goto\(/.test(attrExpr(attr(node, 'onclick')))) {
					hit('headerBackGoto', where(node));
				}
			}
			for (const [key, value] of Object.entries(node)) {
				if (key === 'parent' || key === 'metadata') continue;
				if (value && typeof value === 'object') visit(value);
			}
		};
		visit(ast.fragment);
	}

	details.duplicatedLongClassGroups = [...classGroups.entries()]
		.filter(([, places]) => places.length >= 3)
		.sort((a, b) => b[1].length - a[1].length)
		.map(([text, places]) => `${places.length}x ${text.slice(0, 80)} @ ${places[0]}`);

	/** @type {Record<string, number>} */
	const metrics = {};
	for (const [name, list] of Object.entries(details)) metrics[name] = list.length;
	return { metrics, details, parseFailures };
}

/** @param {string} target path absolut ke file `.svelte` @returns {boolean} */
function hasCaseMismatch(target) {
	const parts = relative(ROOT, target).split(/[\\/]/);
	let current = ROOT;
	for (const part of parts) {
		if (!existsSync(current)) return false;
		const entries = readdirSync(current);
		if (!entries.includes(part)) {
			return entries.some((e) => e.toLowerCase() === part.toLowerCase());
		}
		current = join(current, part);
	}
	return false;
}

const invokedAsMain =
	process.argv[1] &&
	process.argv[1].replace(/\\/g, '/').endsWith('scripts/frontend-consistency.mjs');
if (invokedAsMain) {
	const { metrics, details, parseFailures } = computeMetrics();
	if (process.argv.includes('--json')) {
		console.log(
			JSON.stringify({ metrics, ...(process.argv.includes('--details') && { details }) }, null, 2)
		);
	} else {
		const width = Math.max(...Object.keys(metrics).map((k) => k.length));
		for (const [name, value] of Object.entries(metrics)) {
			console.log(`${name.padEnd(width)}  ${value}`);
			if (process.argv.includes('--details')) {
				for (const where of details[name]) console.log(`    ${where}`);
			}
		}
	}
	for (const failure of parseFailures) console.error(`parse gagal: ${failure}`);
	if (parseFailures.length) process.exitCode = 1;
}
