import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { validateRenderedLoginResponse } from '../e2e-readiness.mjs';

const require = createRequire(import.meta.url);
const excluded = new Set(['_headers', '_redirects', '_routes.json']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Serve only a private immutable copy of public build bytes, never Worker source/config. */
export async function snapshotBuiltAssets(source, destination) {
	const hashes = {},
		publicFiles = [];
	async function walk(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert.ok(!entry.isSymbolicLink(), 'Build snapshot refuses symlinks');
			const file = join(directory, entry.name),
				name = relative(source, file).replaceAll('\\', '/');
			if (entry.isDirectory()) await walk(file);
			else {
				assert.ok(entry.isFile(), 'Build snapshot accepts regular files only');
				const bytes = await readFile(file);
				hashes[name] = digest(bytes);
				if (
					name.split('/').some((part) => part.startsWith('.') || part.startsWith('_worker')) ||
					excluded.has(name)
				)
					continue;
				await mkdir(join(destination, relative(source, directory)), { recursive: true });
				await writeFile(join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
				publicFiles.push(name);
			}
		}
	}
	await walk(source);
	assert.ok(
		publicFiles.some((name) => name.startsWith('_app/')),
		'Actual compiled client assets required'
	);
	await verifyBuiltSnapshot(source, hashes);
	return { hashes, publicFiles: publicFiles.sort() };
}

export async function verifyBuiltSnapshot(source, hashes) {
	const current = [];
	async function walk(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			assert.ok(!entry.isSymbolicLink(), 'Build changed to symlink after snapshot');
			const file = join(directory, entry.name);
			if (entry.isDirectory()) await walk(file);
			else {
				const name = relative(source, file).replaceAll('\\', '/');
				current.push(name);
				assert.equal(digest(await readFile(file)), hashes[name], 'Build bytes changed: ' + name);
			}
		}
	}
	await walk(source);
	assert.deepEqual(
		current.sort(),
		Object.keys(hashes).sort(),
		'Build inventory changed after snapshot'
	);
}

/** SDK-published development certificate only; private key stays inside the SDK. */
export async function compiledFixtureCertificate() {
	const sdk = await readFile(require.resolve('miniflare'), 'utf8');
	const certificate = /var CERT = `([\s\S]+?)`;/.exec(sdk)?.[1];
	assert.ok(
		certificate?.includes('-----BEGIN CERTIFICATE-----'),
		'SDK development certificate contract required'
	);
	return certificate;
}

export async function ensureCompiledTlsReady(baseURL, remainingMs, certificate) {
	const url = new URL(baseURL);
	assert.ok(
		url.protocol === 'https:' &&
			url.hostname === '127.0.0.1' &&
			url.port &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash &&
			url.pathname === '/',
		'Compiled readiness requires exact owned TLS loopback'
	);
	assert.ok(
		Number.isSafeInteger(remainingMs) && remainingMs > 0 && remainingMs <= 120000,
		'E2E application startup budget exhausted or invalid'
	);
	const response = await new Promise((resolveResponse, reject) => {
		const outgoing = httpsRequest(
			new URL('/login', url),
			{
				ca: certificate,
				signal: AbortSignal.timeout(remainingMs),
				headers: { Accept: 'text/html' }
			},
			(incoming) => {
				const headers = new Headers();
				for (const [name, value] of Object.entries(incoming.headers))
					if (value !== undefined)
						headers.set(name, Array.isArray(value) ? value.join(',') : value);
				resolveResponse(
					new Response(Readable.toWeb(incoming), { status: incoming.statusCode, headers })
				);
			}
		);
		outgoing.once('error', reject);
		outgoing.end();
	});
	await validateRenderedLoginResponse(response);
}

/** Same canonical password algorithm/fixture as the isolated dev runner, no workstation password. */
export async function seedCompiledBrowser(db) {
	const { default: bcrypt } = await import('bcryptjs');
	const password = `Uat9!${randomBytes(18).toString('hex')}`;
	const passwordHash = await bcrypt.hash(password, 10);
	const seed = (await readFile('scripts/seed-uat-samarinda.sql', 'utf8'))
		.split(/;\s*(?:\r?\n|$)/)
		.map((s) => s.trim())
		.filter(Boolean);
	await db.batch(seed.map((sql) => db.prepare(sql)));
	await db
		.prepare(
			"UPDATE profil SET password=? WHERE cabang_id='samarinda' AND id IN ('uat-pemilik-samarinda','uat-kasir-samarinda')"
		)
		.bind(passwordHash)
		.run();
	for (const slot of [1, 2, 3]) {
		await db
			.prepare(
				'INSERT INTO profil(id,cabang_id,username,password,role,nama_lengkap)VALUES(?,?,?,?,?,?)'
			)
			.bind(
				`compiled-owner-${slot}`,
				'samarinda',
				`pemilik-e2e-${slot}`,
				passwordHash,
				'pemilik',
				`Compiled owner ${slot}`
			)
			.run();
	}
	return password;
}

/** Exact loopback readiness and real child exit; no deadline reset, fake globals or dev-module imports. */
export async function runCompiledBrowser({ address, password, startupStarted, certificate }) {
	const baseURL = new URL(address).origin;
	await ensureCompiledTlsReady(
		baseURL,
		Math.floor(120000 - (performance.now() - startupStarted)),
		certificate
	);
	console.log(
		'COMPILED_BROWSER_READY anonymous rendered login; actual assets snapshot; original120s budget'
	);
	const artifactId = `compiled-${randomUUID()}`;
	console.log('COMPILED_BROWSER_ARTIFACTS ' + artifactId);
	const env = {
		...process.env,
		E2E_EXTERNAL_SERVER: '1',
		E2E_COMPILED_LOCAL_TLS: '1',
		E2E_BASE_URL: baseURL,
		E2E_OUTPUT_DIR: join('test-results', artifactId),
		PLAYWRIGHT_HTML_OUTPUT_DIR: join('playwright-report', artifactId),
		UAT_PASSWORD: password
	};
	// Explicit selection, not full-browser nor replacement of canonical full-suite inventory.
	const args = [
		require.resolve('@playwright/test/cli'),
		'test',
		'e2e/catat-recent.spec.ts',
		'e2e/ai-mutation.spec.ts',
		'e2e/ledger-callers.spec.ts',
		'--grep',
		'recent card shows five newest rows|malicious recommendations cannot mutate|compiled caller'
	];
	const child = spawn(process.execPath, args, { env, shell: false, stdio: 'inherit' });
	let timer;
	let failure;
	try {
		const status = await new Promise((resolveExit, reject) => {
			child.once('error', reject);
			child.once('exit', (code) => resolveExit(code));
			timer = setTimeout(
				() => reject(new Error('Owned compiled browser parent budget exhausted')),
				600000
			);
		});
		assert.equal(status, 0, 'Compiled browser selection must pass; no retry or skip');
		console.log('COMPILED_BROWSER_EXIT actual owned Playwright child exited0');
	} catch (error) {
		failure = error;
	} finally {
		clearTimeout(timer);
		if (child.exitCode === null && child.signalCode === null) {
			let stopTimer;
			try {
				const stopped = new Promise((resolveExit, reject) => {
					child.once('exit', resolveExit);
					stopTimer = setTimeout(
						() => reject(new Error('Owned compiled browser shutdown unconfirmed; retain state')),
						20000
					);
				});
				child.kill();
				await stopped;
			} catch (error) {
				error.retainOwnedState = true;
				failure = error;
			} finally {
				clearTimeout(stopTimer);
			}
		}
	}
	if (failure) throw failure;
}
