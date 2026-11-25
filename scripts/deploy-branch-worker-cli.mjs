import { spawnSync } from 'node:child_process';
import { wranglerInvocation } from './wrangler-cli.mjs';

export function wrangler(name, config, token, args, input) {
	const run = wranglerInvocation([...args, '--config', config]);
	// Only the credential of the current deployment crosses the subprocess boundary.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) =>
			/^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA)$/i.test(name)
		)
	);
	const result = spawnSync(run.command, run.args, {
		...run.options,
		env: {
			...env,
			CLOUDFLARE_API_TOKEN: token,
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_WRITE_LOGS: 'false'
		},
		input,
		timeout: 90_000
	});
	if (result.error || result.status !== 0) {
		// Secret upload receives derived values on stdin; never include its CLI output in logs.
		const details =
			input === undefined
				? (result.stderr ?? '')
						.replaceAll(token, '[REDACTED]')
						.replaceAll('\u001b', '')
						.replace(/https?:\/\/[^\s)\]"']+/g, '[URL]')
						.replaceAll('\r', '')
						.trim()
						.slice(-1800)
				: '';
		throw new Error(
			`${name}: Wrangler ${args.join(' ')} gagal (${result.error?.code ?? result.status})${details ? `\n${details}` : ''}`
		);
	}
}
