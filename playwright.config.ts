import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: {
		timeout: 10_000
	},
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:5173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: 'pnpm dev --force --host 127.0.0.1 --mode e2e',
		url: 'http://127.0.0.1:5173/login',
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
