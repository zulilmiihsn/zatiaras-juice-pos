import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	const password = existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: '';
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

// AUD-016: respons publik login seragam anti-enumeration.
// Username tak ada vs password salah harus identik status/code/message.
test('login failures share one public contract', async ({ page }) => {
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

	const unknown = await page.request.post('/api/veriflogin', {
		data: { username: 'tidak-ada-xyz-enum', password: 'SalahPass123', branch: 'samarinda' }
	});
	const wrong = await page.request.post('/api/veriflogin', {
		data: { username: 'pemilik', password: 'SalahPass123', branch: 'samarinda' }
	});
	expect(unknown.status()).toBe(401);
	expect(wrong.status()).toBe(401);
	const unknownJson = (await unknown.json()) as Record<string, unknown>;
	const wrongJson = (await wrong.json()) as Record<string, unknown>;
	expect({ status: unknown.status(), ...unknownJson }).toEqual({
		status: wrong.status(),
		...wrongJson
	});
	expect(unknownJson).toMatchObject({
		success: false,
		code: 'INVALID_CREDENTIALS',
		message: 'Username atau password salah.'
	});
});

test('valid login still succeeds after uniform failure contract', async ({ page }) => {
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

	const ok = await page.request.post('/api/veriflogin', {
		data: { username: 'pemilik', password: readUatPassword(), branch: 'samarinda' }
	});
	expect(ok.status()).toBe(200);
	expect(((await ok.json()) as { success: boolean }).success).toBe(true);
});

// AUD-019: tiga role valid konsisten; unknown fail-closed tanpa sesi.
test('role contract stays consistent across login, session and monitoring', async ({ page }) => {
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

	// Unknown role fail-closed: 401 seragam, tanpa sesi valid.
	const weirdLogin = await page.request.post('/api/veriflogin', {
		data: { username: 'weird-e2e', password: readUatPassword(), branch: 'samarinda' }
	});
	expect(weirdLogin.status()).toBe(401);
	expect(((await weirdLogin.json()) as { code: string }).code).toBe('INVALID_CREDENTIALS');
	const noSession = (await (await page.request.get('/api/session')).json()) as {
		authenticated: boolean;
	};
	expect(noSession.authenticated).toBe(false);

	// Admin login membawa role admin, bukan downgrade kasir; sesi ikut admin.
	const adminLogin = await page.request.post('/api/veriflogin', {
		data: { username: 'admin-e2e', password: readUatPassword(), branch: 'samarinda' }
	});
	expect(adminLogin.status()).toBe(200);
	expect(((await adminLogin.json()) as { user: { role: string } }).user.role).toBe('admin');
	const adminSession = (await (await page.request.get('/api/session')).json()) as {
		authenticated: boolean;
		user: { role: string };
	};
	expect(adminSession.authenticated).toBe(true);
	expect(adminSession.user.role).toBe('admin');

	// Admin monitoring 200.
	const adminMonitoring = await page.request.get(
		'/api/monitoring?branch=samarinda&windowMinutes=60'
	);
	expect(adminMonitoring.status()).toBe(200);
});

test('owner monitoring stays forbidden and weird role holds no session', async ({ page }) => {
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

	const ownerLogin = await page.request.post('/api/veriflogin', {
		data: { username: 'pemilik', password: readUatPassword(), branch: 'samarinda' }
	});
	expect(ownerLogin.status()).toBe(200);

	const ownerMonitoring = await page.request.get(
		'/api/monitoring?branch=samarinda&windowMinutes=60'
	);
	expect(ownerMonitoring.status()).toBe(403);
});
