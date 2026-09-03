import { expect, test } from '@playwright/test';
import { calculateTaxes } from '../src/lib/services/taxService';
import type { TaxSettings } from '../src/lib/types/pajak';

test.describe('Tax Settings Behavioral Flows', () => {
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
