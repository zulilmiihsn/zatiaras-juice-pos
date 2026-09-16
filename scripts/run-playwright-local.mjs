import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const envPath = '.env.e2e.local';
const previousEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
const playwrightArgs = process.argv.slice(2);

function run(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		env,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} gagal dengan status ${result.status ?? 'unknown'}`
		);
	}
}

function findFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

function waitForUrl(url, timeoutMs = 120_000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = async () => {
			try {
				const res = await fetch(url);
				await res.text().catch(() => null);
				if (res.status < 500) return resolve();
			} catch {}
			if (Date.now() - start > timeoutMs) {
				reject(new Error(`dev server tidak siap di ${url}`));
				return;
			}
			setTimeout(tick, 1000);
		};
		tick();
	});
}

let devChild = null;
function stopDevServer() {
	if (!devChild || devChild.killed) return;
	try {
		if (process.platform === 'win32') {
			spawnSync('taskkill', ['/pid', String(devChild.pid), '/T', '/F'], { stdio: 'ignore' });
		} else {
			devChild.kill();
		}
	} catch {}
	devChild = null;
}
try {
	writeFileSync(
		envPath,
		[
			`POS_PRICE_SIGNING_KEY=${randomBytes(48).toString('base64url')}`,
			`POS_PRICE_SIGNING_KEY_ID=e2e-${Date.now()}`,
			''
		].join('\n'),
		'utf8'
	);
	// State bersih tiap run: E2E terisolasi dari D1 dev yang basi/terkunci parsial.
	run('node', ['scripts/setup-local-d1.mjs', '--fresh']);
	const port = await findFreePort();
	console.log(`[e2e] dev server di http://127.0.0.1:${port}`);
	devChild = spawn(
		'pnpm',
		['dev', '--force', '--host', '127.0.0.1', '--port', String(port), '--mode', 'e2e'],
		{
			cwd: process.cwd(),
			env: process.env,
			stdio: 'pipe',
			shell: process.platform === 'win32'
		}
	);
	devChild.stdout?.on('data', () => {});
	devChild.stderr?.on('data', () => {});
	await waitForUrl(`http://127.0.0.1:${port}/login`);
	run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
		...process.env,
		E2E_PORT: String(port),
		E2E_BASE_URL: `http://127.0.0.1:${port}`
	});
} finally {
	stopDevServer();
	if (previousEnv === null) rmSync(envPath, { force: true });
	else writeFileSync(envPath, previousEnv, 'utf8');
}
