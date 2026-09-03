import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const envPath = '.env.e2e.local';
const previousEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
const playwrightArgs = process.argv.slice(2);

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} gagal dengan status ${result.status ?? 'unknown'}`
		);
	}
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
	run('pnpm', ['d1:setup:local']);
	run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs]);
} finally {
	if (previousEnv === null) rmSync(envPath, { force: true });
	else writeFileSync(envPath, previousEnv, 'utf8');
}
