import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { csrfMutate, gotoHydrated, ownerUsernameForTest } from './helpers';
import type { createTaxSettingsState } from '../src/lib/stores/taxSettingsState.svelte';

declare global {
	interface Window {
		auditTaxState: ReturnType<typeof createTaxSettingsState>;
	}
}
const settings = {
	isTaxEnabled: true,
	taxes: [{ id: 'pph', nama: 'PPh', tipe: 'pph_final', persentase: 0.5, isEnabled: true }]
};

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

// Login ASLI (bukan mockSession): halaman pajak memakai guard server
// (+page.server.ts) yang hanya lolos sesi server nyata. API pajak tetap mock.
async function loginAsOwner(page: Page, title: string) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(title));
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok()).toBe(true);
	await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
}

async function mockSession(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('selectedBranch', 'samarinda');
		localStorage.setItem(
			'zatiaras_session',
			JSON.stringify({
				isAuthenticated: true,
				user: { id: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' },
				expiresAt: Date.now() + 3600000
			})
		);
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated: true,
						user: { id: 'u', username: 'owner', role: 'pemilik' },
						expiresAt: Date.now() + 3600000
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: [];
		await route.fulfill({ json: data });
	});
}

test('latest tax draft survives an older success and a newer failed save', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	const requests: Array<{ rate: number; reply: (status: number) => Promise<void> }> = [];
	await page.route('**/api/pengaturan/pajak*', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({ json: { ok: true, schema_version: 2, revision: 1, settings } });
			return;
		}
		const body = route.request().postDataJSON();
		await new Promise<void>((resolve) => {
			requests.push({
				rate: body.settings.taxes[0].persentase,
				reply: async (status) => {
					await route.fulfill({
						status,
						json:
							status === 200
								? {
										ok: true,
										branch: 'samarinda',
										schema_version: 2,
										revision: 2,
										settings: body.settings
									}
								: { message: 'Second save failed' }
					});
					resolve();
				}
			});
		});
	});
	await page.goto('/pengaturan/pemilik/pajak');
	await expect(
		page.getByRole('button', { name: 'Simpan Pengaturan Pajak', exact: true })
	).toBeVisible();
	await page.evaluate(async () => {
		const path = '/src/lib/stores/taxSettingsState.svelte.ts';
		const { createTaxSettingsState } = await import(/* @vite-ignore */ path);
		window.auditTaxState = createTaxSettingsState();
		await window.auditTaxState.syncWithServer();
		window.auditTaxState.updateTaxPercentage('pph', 1);
	});
	await expect.poll(() => requests.length).toBe(1);
	await page.evaluate(() => window.auditTaxState.updateTaxPercentage('pph', 2));
	await requests[0].reply(200);
	await expect.poll(() => requests.length).toBe(2);
	expect(requests.map((r) => r.rate)).toEqual([1, 2]);
	expect(
		await page.evaluate(() => ({
			rate: window.auditTaxState.settings.taxes[0].persentase,
			saving: window.auditTaxState.isSaving
		}))
	).toEqual({ rate: 2, saving: true });
	await requests[1].reply(500);
	await page.waitForFunction(() => Boolean(window.auditTaxState.saveError));
	expect(
		await page.evaluate(() => ({
			rate: window.auditTaxState.settings.taxes[0].persentase,
			saved: window.auditTaxState.persisted.taxes[0].persentase,
			saving: window.auditTaxState.isSaving,
			success: window.auditTaxState.saveSuccessMessage
		}))
	).toEqual({ rate: 2, saved: 1, saving: false, success: null });
});

for (const [storedBase, display] of [
	[500, '0,5'],
	[1125, '1,125'],
	[10125, '10,125'],
	[1234125, '1.234,125']
] as const) {
	test(`bahan decimal ${display} survives typing, blur and save`, async ({ page }) => {
		await mockSession(page);
		const ingredient = {
			id: 'b-uji',
			nama: 'Gula Uji',
			satuan: 'gram',
			tipe_satuan: 'berat',
			satuan_beli: 'kg',
			isi_per_kemasan: 1,
			kategori: 'Bahan Baku',
			stok_saat_ini: 1000,
			ambang_stok: 10,
			yield_persen: 100,
			biaya_per_satuan: 20,
			jumlah_beli_terakhir: storedBase,
			biaya_beli_terakhir: 20000,
			is_active: true
		};
		let patched: Record<string, unknown> | null = null;
		await page.route('**/api/bahan*', async (route) => {
			if (route.request().method() === 'PATCH') {
				patched = route.request().postDataJSON()?.payload as Record<string, unknown>;
				await route.fulfill({ json: { ok: true } });
				return;
			}
			await route.fulfill({ json: [ingredient] });
		});
		// Tunggu hidrasi + data (tombol Ubah hanya ada sesudah render client).
		await gotoHydrated(page, '/stok', 'button:has-text("Ubah")');
		await page.getByRole('button', { name: 'Ubah', exact: true }).first().click();
		const qty = page.locator('#modal-bahan-beli-qty');
		await expect(qty).toHaveValue(display);
		await qty.fill('');
		await qty.pressSequentially(display, { delay: 50 });
		await expect(qty).toHaveValue(display);
		await qty.press('Tab');
		await expect(qty).toHaveValue(display);
		await page
			.locator('#stok-bahan-form')
			.evaluate((form: HTMLFormElement) => form.requestSubmit());
		await expect.poll(() => patched?.jumlah_beli_terakhir, { timeout: 10000 }).toBe(storedBase);
	});
}

test('bahan add flow keeps typed fraction and posts base qty', async ({ page }) => {
	await mockSession(page);
	let posted: Record<string, unknown> | null = null;
	await page.route('**/api/bahan*', async (route) => {
		if (route.request().method() === 'POST') {
			posted = route.request().postDataJSON()?.payload as Record<string, unknown>;
			await route.fulfill({ json: { ok: true, data: [{ id: 'b-baru' }] } });
			return;
		}
		await route.fulfill({ json: [] });
	});
	await gotoHydrated(page, '/stok', 'text=Belum Ada Stok Bahan');
	await page.getByRole('button', { name: 'Tambah Bahan Baku' }).click();
	await page.locator('#modal-bahan-nama').fill('Gula E2E');
	const qty = page.locator('#modal-bahan-beli-qty');
	await qty.pressSequentially('0,5');
	await expect(qty).toHaveValue('0,5');
	await page.locator('#modal-bahan-beli-cost').fill('20000');
	await page.locator('button[type="submit"][form="stok-bahan-form"]').click();
	await expect.poll(() => posted?.jumlah_beli_terakhir, { timeout: 10000 }).toBe(500);
});

async function seedConsentLedger(page: Page, id: string) {
	const response = await csrfMutate(page, 'POST', '/api/buku-kas', {
		branch: 'samarinda',
		payload: {
			id,
			transaction_id: id,
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			sumber: 'catat',
			nominal: 10000,
			deskripsi: 'Sebelum consent',
			waktu: '2026-07-01T00:00:00.000Z',
			metode_bayar: 'tunai'
		}
	});
	expect(response.ok()).toBe(true);
}

async function readConsentLedger(page: Page, id: string) {
	const response = await page.request.get(`/api/buku-kas?id=${encodeURIComponent(id)}&limit=1`);
	expect(response.ok()).toBe(true);
	const rows = (await response.json()) as Array<{
		revision: number;
		nominal: number;
		deskripsi: string;
	}>;
	expect(rows).toHaveLength(1);
	return rows[0];
}

async function requestConsent(page: Page) {
	await page
		.getByPlaceholder('Ceritakan transaksi Anda...')
		.fill('Koreksi transaksi yang ditampilkan');
	await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
	await expect(page.getByTestId('ai-update-before')).toBeVisible();
}

async function cleanupConsentLedger(page: Page, id: string) {
	// Unconfirmed route shutdown must not race a late mutation or mask the original assertion.
	await page.unrouteAll({ behavior: 'wait' });
	const removed = await csrfMutate(
		page,
		'DELETE',
		`/api/buku-kas?id=${encodeURIComponent(id)}`,
		undefined
	);
	expect(removed.ok()).toBe(true);
}

function consentModel(id: string) {
	return {
		recommendations: [
			{
				action: 'update_transaction',
				title: 'MODEL MISLEADING TITLE',
				deskripsi: 'MODEL MISLEADING DESCRIPTION',
				priority: 'high',
				data: {
					id,
					type: 'pemasukan',
					amount: 50000,
					deskripsi: 'Sesudah consent',
					category: 'pendapatan_usaha',
					revision: 999999,
					branch: 'berau',
					mutation_token: 'MODEL-NOT-AUTHORITY'
				}
			}
		]
	};
}

test('AI update binds displayed live revision; valid once, stale409, cancel and context ABA no mutation', async ({
	page
}) => {
	await loginAsOwner(page, test.info().title);
	const id = `owned-consent-${crypto.randomUUID()}`;
	await seedConsentLedger(page, id);
	await page.route('**/api/aichat?action=analyze', (route) =>
		route.fulfill({ json: consentModel(id) })
	);
	let patches = 0;
	let hasFailure = false;
	let primaryFailure: unknown;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/buku-kas' && request.method() === 'PATCH')
			patches++;
	});
	try {
		await page.getByRole('button', { name: 'Buka AI Assistant' }).first().click();
		await requestConsent(page);
		await expect(page.getByTestId('ai-update-before')).toContainText('Revisi 0');
		await expect(page.getByTestId('ai-update-before')).toContainText('Sebelum consent');
		await expect(page.getByTestId('ai-update-after')).toContainText('Sesudah consent');
		await expect(page.getByText('MODEL MISLEADING TITLE', { exact: true })).toHaveCount(0);
		const committed = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname === '/api/buku-kas' &&
				r.request().method() === 'PATCH' &&
				r.status() === 200
		);
		await page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true }).click();
		await committed;
		await expect(
			page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true })
		).toHaveCount(0);
		expect(await readConsentLedger(page, id)).toMatchObject({
			revision: 1,
			nominal: 50000,
			deskripsi: 'Sesudah consent'
		});

		await requestConsent(page);
		await expect(page.getByTestId('ai-update-before')).toContainText('Revisi 1');
		const external = await csrfMutate(page, 'PATCH', '/api/buku-kas', {
			branch: 'samarinda',
			where: { id },
			payload: { revision: 1, nominal: 60000, deskripsi: 'External current' }
		});
		expect(external.ok()).toBe(true);
		const stale = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname === '/api/buku-kas' &&
				r.request().method() === 'PATCH' &&
				r.status() === 409
		);
		await page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true }).click();
		await stale;
		await expect(page.getByText(/1 rekomendasi gagal diterapkan/)).toBeVisible();
		expect(await readConsentLedger(page, id)).toMatchObject({
			revision: 2,
			nominal: 60000,
			deskripsi: 'External current'
		});
		const patchCount = patches;
		await page.getByRole('button', { name: 'Batal', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true })
		).toHaveCount(0);
		expect(patches).toBe(patchCount);
		await requestConsent(page);
		await expect(page.getByTestId('ai-update-before')).toContainText('Revisi 2');
		await page.getByRole('button', { name: 'Tutup modal', exact: true }).click();

		const contextResult = await page.evaluate(async (id) => {
			await import('/@vite/env');
			const { AutoApplyService } = await import('/src/lib/services/autoApplyService.ts');
			const { selectedBranch } = await import('/src/lib/stores/selectedBranch.svelte.ts');
			const service = AutoApplyService.getInstance();
			const rec = {
				id: `context-${id}`,
				action: 'update_transaction' as const,
				title: 'x',
				deskripsi: 'x',
				priority: 'high' as const,
				data: {
					id,
					type: 'pemasukan',
					amount: 50000,
					deskripsi: 'No context write',
					category: 'pendapatan_usaha'
				}
			};
			const unprepared = await service.applyRecommendations([rec]);
			const forged = await service.applyRecommendations([rec], {
				recommendations: [rec],
				updates: {}
			});
			const cancelled = await service.prepareRecommendations([rec]);
			service.cancelConsent(cancelled);
			const afterCancel = await service.applyRecommendations([rec], cancelled);
			const consent = await service.prepareRecommendations([rec]);
			const frozen =
				Object.isFrozen(consent) &&
				Object.isFrozen(consent.updates[rec.id]) &&
				Object.isFrozen(consent.recommendations[0].data);
			selectedBranch.value = 'berau';
			selectedBranch.value = 'samarinda';
			const result = await service.applyRecommendations([rec], consent);
			service.cancelConsent(consent);
			return {
				success: result.success,
				applied: result.appliedRecommendations.length,
				unprepared: unprepared.success,
				forged: forged.success,
				cancelled: afterCancel.success,
				frozen
			};
		}, id);
		expect(contextResult).toEqual({
			success: false,
			applied: 0,
			unprepared: false,
			forged: false,
			cancelled: false,
			frozen: true
		});
		expect(patches).toBe(patchCount);
		expect(await readConsentLedger(page, id)).toMatchObject({
			revision: 2,
			nominal: 60000,
			deskripsi: 'External current'
		});
	} catch (error) {
		hasFailure = true;
		primaryFailure = error;
	} finally {
		const [cleanup] = await Promise.allSettled([cleanupConsentLedger(page, id)]);
		if (!hasFailure && cleanup.status === 'rejected') {
			hasFailure = true;
			primaryFailure = cleanup.reason;
		}
	}
	if (hasFailure) throw primaryFailure;
});

test('manual ledger native HTTP boundaries and legacy offline replay stay canonical', async ({
	page
}) => {
	const row = {
		id: 'aud005-native',
		sumber: 'catat',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal: '100000.123456',
		metode_bayar: 'qris',
		deskripsi: 'Owned AUD005 fixture',
		waktu: '2026-10-05T00:00:00.000Z'
	};
	async function rawPost(payload: unknown) {
		const csrfResponse = await page.request.get('/api/csrf');
		expect(csrfResponse.status()).toBe(200);
		const csrf = (await csrfResponse.json()) as { token: string };
		return page.request.post('/api/buku-kas', {
			data: { payload },
			headers: { 'X-CSRF-Token': csrf.token }
		});
	}
	expect((await rawPost(row)).status()).toBe(401);
	await loginAsOwner(page, test.info().title);
	const created = await csrfMutate(page, 'POST', '/api/buku-kas', { payload: row });
	expect(created.status()).toBe(200);
	expect((await created.json()).data[0]).toMatchObject({
		nominal: 100000,
		metode_bayar: 'non-tunai',
		cabang_id: 'samarinda'
	});
	async function ledger() {
		const response = await page.request.get('/api/buku-kas?limit=500');
		expect(response.status()).toBe(200);
		return response.json();
	}
	const before = await ledger();
	for (const [payload, status] of [
		[[{ ...row, id: 'aud005-head' }, null], 400],
		[
			[
				{ ...row, id: 'aud005-head' },
				{ ...row, id: 'aud005-tail', nominal: true }
			],
			400
		],
		[{ ...row, id: 'aud005-range', nominal: '9007199254740991.1' }, 400],
		[{ ...row, id: 'aud005-negative', nominal: '-1e-999' }, 400],
		[{ ...row, id: 'aud005-direction', tipe: 'out' }, 400],
		[{ ...row, id: 'aud005-scope', cabang_id: 'berau' }, 403],
		[{ ...row, id: 'aud005-scope', branch: 'berau' }, 403]
	] as const) {
		const response = await rawPost(payload);
		expect(response.status()).toBe(status);
		if (status === 403)
			expect((await response.json()).message).toMatch(/Branch tidak sesuai session/);
		expect(await ledger()).toEqual(before);
	}
	const deniedCsrf = await page.request.post('/api/buku-kas', {
		data: { payload: { ...row, id: 'aud005-csrf' } },
		headers: { 'X-CSRF-Token': 'owned-invalid-token' }
	});
	expect(deniedCsrf.status()).toBe(403);
	expect((await deniedCsrf.json()).code).toBe('CSRF_INVALID');
	expect(await ledger()).toEqual(before);
	const invalidPatch = await csrfMutate(page, 'PATCH', '/api/buku-kas', {
		where: { id: row.id },
		payload: { revision: 0, nominal: false }
	});
	expect(invalidPatch.status()).toBe(400);
	expect(await ledger()).toEqual(before);
	const changed = await csrfMutate(page, 'PATCH', '/api/buku-kas', {
		where: { id: row.id },
		payload: { revision: 0, nominal: '2.50006e4' }
	});
	expect(changed.status()).toBe(200);
	expect((await ledger()).find((item: { id: string }) => item.id === row.id)).toMatchObject({
		nominal: 25001,
		revision: 1
	});

	let lostResponses = 0;
	await page.route('**/api/buku-kas', async (route) => {
		if (
			route.request().method() !== 'POST' ||
			!route.request().postData()?.includes('aud005-offline')
		)
			return route.continue();
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		await response.body();
		lostResponses++;
		await route.abort('failed');
	});
	try {
		const pending = await page.evaluate(async (row) => {
			const envPath = '/@vite/env';
			await import(/* @vite-ignore */ envPath);
			const offlinePath = '/src/lib/utils/offline.ts',
				syncPath = '/src/lib/services/offlineSync.ts';
			const offline = (await import(
				/* @vite-ignore */ offlinePath
			)) as typeof import('../src/lib/utils/offline');
			const sync = (await import(
				/* @vite-ignore */ syncPath
			)) as typeof import('../src/lib/services/offlineSync');
			const queued = await offline.addPendingTransaction(
				{ ...row, id: 'aud005-offline', nominal: '2.50006e4' },
				'samarinda'
			);
			await Promise.all([
				sync.syncPendingTransactions({ force: true, queueIds: [queued.queue_id] }),
				sync.syncPendingTransactions({ force: true, queueIds: [queued.queue_id] })
			]);
			return (await offline.getPendingTransactions())
				.filter((item) => item.id === 'aud005-offline')
				.map((item) => ({ queue_id: item.queue_id, id: item.id, nominal: item.nominal }));
		}, row);
		expect(lostResponses).toBe(1);
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ id: 'aud005-offline', nominal: '2.50006e4' });
		expect(
			(await ledger()).filter((item: { id: string }) => item.id === 'aud005-offline')
		).toHaveLength(1);
	} finally {
		await page.unrouteAll({ behavior: 'wait' });
	}
	await page.evaluate(async () => {
		const path = '/src/lib/services/offlineSync.ts';
		const sync = (await import(
			/* @vite-ignore */ path
		)) as typeof import('../src/lib/services/offlineSync');
		await sync.syncPendingTransactions({ force: true });
	});
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const path = '/src/lib/utils/offline.ts';
				const offline = (await import(
					/* @vite-ignore */ path
				)) as typeof import('../src/lib/utils/offline');
				return (await offline.getPendingTransactions()).filter(
					(item) => item.id === 'aud005-offline'
				).length;
			})
		)
		.toBe(0);
	const final = (await ledger()).filter((item: { id: string }) => item.id === 'aud005-offline');
	expect(final).toHaveLength(1);
	expect(final[0]).toMatchObject({ nominal: 25001, cabang_id: 'samarinda' });
	const cookies = await page.context().cookies();
	expect((await csrfMutate(page, 'POST', '/api/logout', {})).status()).toBe(200);
	await page.context().addCookies(cookies);
	expect((await rawPost({ ...row, id: 'aud005-revoked' })).status()).toBe(401);
});

test('closing AI consent during target read cannot resurrect the consent or write', async ({
	page
}) => {
	await loginAsOwner(page, test.info().title);
	const id = `owned-consent-close-${crypto.randomUUID()}`;
	await seedConsentLedger(page, id);
	await page.route('**/api/aichat?action=analyze', (route) =>
		route.fulfill({ json: consentModel(id) })
	);
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	let readStarted = false;
	let readFinished = false;
	let writes = 0;
	let hasFailure = false;
	let primaryFailure: unknown;
	await page.route('**/api/buku-kas?*', async (route) => {
		if (
			route.request().method() !== 'GET' ||
			new URL(route.request().url()).searchParams.get('id') !== id
		) {
			await route.continue();
			return;
		}
		const response = await route.fetch();
		readStarted = true;
		await hold;
		await route.fulfill({ response });
		readFinished = true;
	});
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/buku-kas' && request.method() === 'PATCH')
			writes++;
	});
	try {
		await page.getByRole('button', { name: 'Buka AI Assistant' }).first().click();
		await page.getByPlaceholder('Ceritakan transaksi Anda...').fill('Tinjau lalu tutup');
		await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
		await expect.poll(() => readStarted).toBe(true);
		await page.getByRole('button', { name: 'Tutup modal', exact: true }).click();
		release();
		await expect.poll(() => readFinished).toBe(true);
		await page.unrouteAll({ behavior: 'wait' });
		await page.getByRole('button', { name: 'Buka AI Assistant' }).first().click();
		await expect(page.getByTestId('ai-update-before')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true })
		).toHaveCount(0);
		expect(writes).toBe(0);
		expect(await readConsentLedger(page, id)).toMatchObject({
			revision: 0,
			nominal: 10000,
			deskripsi: 'Sebelum consent'
		});
	} catch (error) {
		hasFailure = true;
		primaryFailure = error;
	} finally {
		release();
		const [cleanup] = await Promise.allSettled([cleanupConsentLedger(page, id)]);
		if (!hasFailure && cleanup.status === 'rejected') {
			hasFailure = true;
			primaryFailure = cleanup.reason;
		}
	}
	if (hasFailure) throw primaryFailure;
});
