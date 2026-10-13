import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.svelte-kit/cloudflare');
export const interceptMarker = '// ZATIARAS_REALTIME_MODULE_WRAPPER_V2';
const adapterFile = '_worker.sveltekit.js';
const authFile = '_worker.auth.js';

// No dependency on generated variable names or SvelteKit's internal fetch formatting.
export function renderRealtimeWorker() {
	return `${interceptMarker}
import adapter from './${adapterFile}';
import { handleRealtimeRequest } from './${authFile}';
export * from './${adapterFile}';
export default {
  ...adapter,
  async fetch(request, env, context) {
    const response = await handleRealtimeRequest(request, env);
    if (response) return response;
    return adapter.fetch(request, env, context);
  }
};
`;
}

export function verifyPatchedWorker(worker) {
	if (worker !== renderRealtimeWorker())
		throw new Error('Realtime module wrapper contract mismatch');
	return true;
}

export function validateAdapterModule(worker) {
	const ast = ts.createSourceFile(
		'adapter.js',
		worker,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.JS
	);
	if (
		ast.parseDiagnostics.length ||
		!ast.statements.some(
			(statement) =>
				(ts.isExportAssignment(statement) && !statement.isExportEquals) ||
				(ts.isExportDeclaration(statement) &&
					statement.exportClause &&
					ts.isNamedExports(statement.exportClause) &&
					statement.exportClause.elements.some((element) => element.name.text === 'default')) ||
				((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
					statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
		)
	)
		throw new Error('SvelteKit adapter must be valid ESM with a default export');
	return true;
}

export async function compileRealtimeEntry() {
	const built = await build({
		root,
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		resolve: { alias: { $lib: resolve(root, 'src/lib') } },
		ssr: { noExternal: true },
		build: {
			ssr: resolve(root, 'src/lib/server/realtimeRequestHandler.ts'),
			write: false,
			minify: false,
			rolldownOptions: { output: { codeSplitting: false } }
		}
	});
	const bundles = Array.isArray(built) ? built : [built];
	const chunks = bundles.flatMap((bundle) => ('output' in bundle ? bundle.output : []));
	if (chunks.length !== 1 || chunks[0].type !== 'chunk') {
		throw new Error('Canonical realtime entry must compile into one self-contained module');
	}
	return chunks[0].code;
}

export async function main(directory = output) {
	const workerPath = resolve(directory, '_worker.js');
	const worker = await readFile(workerPath, 'utf8');
	let adapter = worker;
	if (worker.includes(interceptMarker)) {
		verifyPatchedWorker(worker);
		adapter = await readFile(resolve(directory, adapterFile), 'utf8');
	}
	if (adapter.includes('ZATIARAS_REALTIME_WORKER_INTERCEPT')) {
		throw new Error(
			'Legacy session-only intercept refused; rebuild the untouched SvelteKit adapter first'
		);
	}
	validateAdapterModule(adapter);
	// Compilation failure leaves the existing entry untouched; build failures cannot authorize release.
	const canonical = await compileRealtimeEntry();
	await writeFile(resolve(directory, adapterFile), adapter);
	await writeFile(resolve(directory, authFile), canonical);
	await writeFile(workerPath, renderRealtimeWorker());
	verifyPatchedWorker(await readFile(workerPath, 'utf8'));
	console.log('[durable-object-export] canonical realtime module wrapper verified');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		console.error('[durable-object-export] failed:', error);
		process.exitCode = 1;
	});
}
