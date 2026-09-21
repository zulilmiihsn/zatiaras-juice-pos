import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createE2eEnvironment } from './e2e-environment.mjs';

const require = createRequire(import.meta.url);
const environment = createE2eEnvironment();
/** @type {import('node:child_process').ChildProcess | undefined} */
let server;
/** @type {import('node:child_process').ChildProcess | undefined} */
let tests;
let exitCode = 1;
let stopped = true;

try {
	const initialized = await environment.initialize();
	console.log(
		`[e2e] ${initialized.migrations} migrations x ${initialized.databases} isolated D1 databases ready`
	);
	const env = {
		...process.env,
		ZATIARAS_E2E_CONFIG: environment.configPath,
		ZATIARAS_E2E_STATE: environment.persistPath
	};
	const child = fork(new URL('./e2e-server.mjs', import.meta.url), [], {
		env,
		execArgv: [],
		stdio: ['ignore', 'inherit', 'inherit', 'ipc']
	});
	server = child;
	stopped = false;
	const port = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('E2E server startup timed out')), 120000);
		child.once('error', reject);
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`E2E server exited during startup (${code})`));
		});
		child.once('message', (message) => {
			clearTimeout(timer);
			if (
				!message ||
				typeof message !== 'object' ||
				!('port' in message) ||
				typeof message.port !== 'number'
			) {
				reject(new Error('Invalid E2E server ready message'));
				return;
			}
			resolve(message.port);
		});
	});
	const baseURL = `http://127.0.0.1:${port}`;
	console.log(`[e2e] ${baseURL}; persistence ${environment.persistPath}`);
	exitCode = await new Promise((resolve, reject) => {
		tests = spawn(
			process.execPath,
			[require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)],
			{
				stdio: 'inherit',
				shell: false,
				env: {
					...env,
					E2E_PORT: String(port),
					E2E_BASE_URL: baseURL,
					E2E_EXTERNAL_SERVER: '1',
					UAT_PASSWORD: environment.password
				}
			}
		);
		tests.once('error', reject);
		tests.once('exit', (code) => resolve(code ?? 1));
	});
} catch (error) {
	console.error('[e2e]', error instanceof Error ? error.message : String(error));
} finally {
	if (tests && tests.exitCode === null) {
		tests.kill();
		await once(tests, 'exit').catch(() => {});
	}
	if (server) {
		let timer;
		try {
			if (server.exitCode === null && server.signalCode === null) {
				const exit = once(server, 'exit');
				if (server.connected) server.send('shutdown');
				else server.kill();
				await Promise.race([
					exit,
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(new Error('E2E server shutdown timed out')), 20000);
					})
				]);
			}
			stopped = true;
		} catch (error) {
			exitCode = 1;
			console.error('[e2e] Shutdown failed; isolated run retained:', environment.directory, error);
		} finally {
			clearTimeout(timer);
		}
	}
	if (stopped) {
		try {
			environment.cleanup();
			console.log('[e2e] Owned temporary state removed; dev state untouched.');
		} catch (error) {
			exitCode = 1;
			console.error('[e2e] Cleanup failed; run retained:', environment.directory, error);
		}
	}
}
process.exit(exitCode);
