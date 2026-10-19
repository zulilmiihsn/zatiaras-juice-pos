import { expect, test } from '@playwright/test';
import { calculateTaxes } from '../src/lib/services/taxService';
import type { TaxSettings } from '../src/lib/types/pajak';
import { csrfMutate, csrfPost } from './helpers';

test.describe('Tax Settings Behavioral Flows', () => {
	test('tax API rejects malformed identities and foreign branch writes without changing configuration', async ({
		page
	}) => {
		const branch = 'samarinda2';
		const settings = {
			isTaxEnabled: true,
			taxes: [{ id: 'tax-api-test', nama: 'Pajak', tipe: 'ppn', persentase: 11, isEnabled: true }]
		};
		const anonymous = await csrfMutate(page, 'PUT', '/api/pengaturan/pajak', {
			branch,
			schema_version: 2,
			expected_revision: 0,
			settings
		});
		expect(anonymous.status()).toBe(401);
		const login = await csrfPost(page, '/api/veriflogin', {
			username: 'owner-e2e',
			password: process.env.UAT_PASSWORD,
			branch
		});
		expect(login.status()).toBe(200);
		const read = async () => {
			const response = await page.request.get(`/api/pengaturan/pajak?branch=${branch}`);
			expect(response.status()).toBe(200);
			return response.json() as Promise<{ revision: number; settings: TaxSettings }>;
		};
		const before = await read();
		for (const patch of [
			{ id: 1 },
			{ id: { toString: 'invalid' }, persentase: 101 },
			{ tipe: { toString: 'invalid' } },
			{ id: ' ' }
		]) {
			const response = await csrfMutate(page, 'PUT', '/api/pengaturan/pajak', {
				branch,
				schema_version: 2,
				expected_revision: before.revision,
				settings: { ...settings, taxes: [{ ...settings.taxes[0], ...patch }] }
			});
			expect(response.status()).toBe(400);
			const after = await read();
			expect(after.revision).toBe(before.revision);
			expect(after.settings).toEqual(before.settings);
		}
		const csrf = (await (await page.request.get('/api/csrf')).json()) as { token: string };
		const foreign = await page.request.put('/api/pengaturan/pajak', {
			headers: { 'X-CSRF-Token': csrf.token },
			data: {
				branch: 'berau',
				schema_version: 2,
				expected_revision: before.revision,
				settings
			}
		});
		expect(foreign.status()).toBe(403);
		expect((await read()).settings).toEqual(before.settings);
	});

	test('tax settings route protects unauthorized access and enforces security boundary', async ({
		page
	}) => {
		await page.goto('/pengaturan/pemilik/pajak');
		await expect(page).toHaveURL(/\/login/);
	});

	test('validates real app calculateTaxes() with PP 55/2022 threshold rules', () => {
		const taxSettings: TaxSettings = {
			isTaxEnabled: true,
			taxes: [
				{
					id: 'pph_final_umkm',
					nama: 'PPh Final UMKM',
					tipe: 'pph_final',
					persentase: 0.5,
					isEnabled: true,
					deskripsi: 'Pajak PP 55/2022 0.5%',
					useThreshold500Juta: true
				}
			]
		};

		// Case 1: Omzet 300M, YTD cumulative 300M (<= 500M) -> 0% tax applied
		const resultBelow = calculateTaxes(300_000_000, 150_000_000, taxSettings, 300_000_000);
		expect(resultBelow.totalPajak).toBe(0);
		expect(resultBelow.labaBersih).toBe(150_000_000);

		// Case 2: Omzet 300M, YTD cumulative 600M -> 100M taxable * 0.5% = 500_000
		const resultStraddle = calculateTaxes(300_000_000, 150_000_000, taxSettings, 600_000_000);
		expect(resultStraddle.totalPajak).toBe(500_000);
		expect(resultStraddle.labaBersih).toBe(149_500_000);

		// Case 3: Omzet 100M, YTD cumulative 700M -> all 100M taxable * 0.5% = 500_000
		const resultAbove = calculateTaxes(100_000_000, 50_000_000, taxSettings, 700_000_000);
		expect(resultAbove.totalPajak).toBe(500_000);
		expect(resultAbove.labaBersih).toBe(49_500_000);
	});
});
