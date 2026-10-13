import { defineConfig, devices } from '@playwright/test';

// Runner E2E (scripts/run-playwright-local.mjs) mengisi E2E_PORT dengan port
// bebas + menjalankan dev server sendiri. Tanpa env ini perilaku lama dipakai.
const e2ePort = Number(process.env.E2E_PORT || 5173);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${e2ePort}`;
const compiledLocalTLS = process.env.E2E_COMPILED_LOCAL_TLS === '1';
if (compiledLocalTLS) {
	const origin = new URL(baseURL);
	if (
		process.env.E2E_EXTERNAL_SERVER !== '1' ||
		origin.protocol !== 'https:' ||
		origin.hostname !== '127.0.0.1' ||
		!origin.port ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	)
		throw new Error('Compiled TLS exception is restricted to the owned loopback fixture');
}

export default defineConfig({
	testDir: './e2e',
	outputDir: process.env.E2E_OUTPUT_DIR || 'test-results',
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: {
		timeout: 10_000
	},
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL,
		// Only the owned SDK development certificate; never relax production/browser auth policy.
		ignoreHTTPSErrors: compiledLocalTLS,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		...devices['Desktop Chrome']
	},
	webServer:
		process.env.E2E_EXTERNAL_SERVER === '1'
			? undefined
			: {
					command: `pnpm dev --force --host 127.0.0.1 --port ${e2ePort} --mode e2e`,
					url: `${baseURL}/login`,
					reuseExistingServer: Boolean(process.env.E2E_PORT),
					timeout: 120_000,
					stdout: 'pipe',
					stderr: 'pipe'
				}
});
