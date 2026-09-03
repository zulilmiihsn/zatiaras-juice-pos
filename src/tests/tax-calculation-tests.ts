import assert from 'node:assert/strict';
import { calculateTaxes, DEFAULT_TAX_SETTINGS } from '../lib/services/taxService.js';
import type { TaxSettings } from '../lib/types/pajak.js';

console.log('--- Running Tax Calculation Tests ---');

// Test 1: Default PPh Final UMKM (0.5%) on 10,000,000 omzet, 6,000,000 gross profit
{
	const omzet = 10_000_000;
	const labaKotor = 6_000_000;
	const res = calculateTaxes(omzet, labaKotor, DEFAULT_TAX_SETTINGS);

	assert.equal(res.isTaxEnabled, true, 'Tax should be enabled by default');
	assert.equal(res.totalPajak, 50_000, '0.5% of 10M should be 50,000');
	assert.equal(res.labaBersih, 5_950_000, 'Laba Bersih should be 6M - 50k = 5,950,000');
	assert.equal(res.breakdowns.length, 1, 'Should have 1 active tax breakdown');
	assert.equal(res.breakdowns[0].persentase, 0.5);
	console.log('✓ Test 1: Default PPh Final UMKM 0.5% passed');
}

// Test 2: PBJT / PB1 Restoran 10%
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pbjt',
				nama: 'PBJT Restoran',
				tipe: 'pbjt_restoran',
				persentase: 10,
				isEnabled: true
			}
		]
	};
	const omzet = 25_000_000;
	const labaKotor = 15_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.totalPajak, 2_500_000, '10% of 25M should be 2,500,000');
	assert.equal(res.labaBersih, 12_500_000, 'Laba Bersih should be 15M - 2.5M = 12,500,000');
	console.log('✓ Test 2: PBJT Restoran 10% passed');
}

// Test 3: Multi-tax (PBJT 10% + PPh Final 0.5% = 10.5%)
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph',
				nama: 'PPh Final',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true
			},
			{
				id: 'pbjt',
				nama: 'PBJT Restoran',
				tipe: 'pbjt_restoran',
				persentase: 10,
				isEnabled: true
			}
		]
	};
	const omzet = 10_000_000;
	const labaKotor = 5_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.totalPajak, 1_050_000, '10.5% of 10M should be 1,050,000 (50k + 1M)');
	assert.equal(res.labaBersih, 3_950_000, 'Laba Bersih should be 5M - 1.05M = 3,950,000');
	assert.equal(res.breakdowns.length, 2);
	console.log('✓ Test 3: Multi-tax calculation passed');
}

// Test 4: Custom Tax
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'custom_retribusi',
				nama: 'Retribusi Kebersihan',
				tipe: 'custom',
				persentase: 1.5,
				isEnabled: true
			}
		]
	};
	const omzet = 20_000_000;
	const labaKotor = 10_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.totalPajak, 300_000, '1.5% of 20M should be 300,000');
	assert.equal(res.labaBersih, 9_700_000);
	console.log('✓ Test 4: Custom Tax passed');
}

// Test 5: Tax Disabled
{
	const settings: TaxSettings = {
		isTaxEnabled: false,
		taxes: DEFAULT_TAX_SETTINGS.taxes
	};
	const omzet = 50_000_000;
	const labaKotor = 30_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.isTaxEnabled, false);
	assert.equal(res.totalPajak, 0, 'Disabled tax should yield 0 tax');
	assert.equal(res.labaBersih, 30_000_000, 'Laba bersih should equal laba kotor when tax disabled');
	console.log('✓ Test 5: Disabled Tax passed');
}

// Test 6: Zero / Negative Gross Profit Edge Case
{
	const omzet = 0;
	const labaKotor = 0;
	const res = calculateTaxes(omzet, labaKotor, DEFAULT_TAX_SETTINGS);

	assert.equal(res.totalPajak, 0);
	assert.equal(res.labaBersih, 0);
	console.log('✓ Test 6: Zero profit/omzet edge case passed');
}

// Test 7: Threshold 500 Juta below limit (omzet 400M -> 0 tax)
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph_threshold',
				nama: 'PPh Final UMKM (Bebas 500Jt)',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true,
				useThreshold500Juta: true
			}
		]
	};
	const omzet = 400_000_000;
	const labaKotor = 200_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.totalPajak, 0, 'Omzet below 500M should yield 0 tax with threshold');
	assert.equal(res.labaBersih, 200_000_000);
	console.log('✓ Test 7: Threshold 500 Juta below limit passed');
}

// Test 8: Threshold 500 Juta above limit (omzet 600M -> tax on 100M excess = 500,000)
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph_threshold',
				nama: 'PPh Final UMKM (Bebas 500Jt)',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true,
				useThreshold500Juta: true
			}
		]
	};
	const omzet = 600_000_000;
	const labaKotor = 300_000_000;
	const res = calculateTaxes(omzet, labaKotor, settings);

	assert.equal(res.totalPajak, 500_000, '0.5% of (600M - 500M) = 500,000');
	assert.equal(res.labaBersih, 299_500_000);
	console.log('✓ Test 8: Threshold 500 Juta above limit passed');
}

// Test 9: Progressive Multi-Period YTD Threshold
{
	const settings: TaxSettings = {
		isTaxEnabled: true,
		taxes: [
			{
				id: 'pph_threshold',
				nama: 'PPh Final UMKM (Bebas 500Jt)',
				tipe: 'pph_final',
				persentase: 0.5,
				isEnabled: true,
				useThreshold500Juta: true
			}
		]
	};

	// Month 1: Omzet 300M, YTD 300M -> 0 tax
	const resM1 = calculateTaxes(300_000_000, 150_000_000, settings, 300_000_000);
	assert.equal(resM1.totalPajak, 0);

	// Month 2: Omzet 300M, YTD 600M -> tax on 100M excess = 500,000
	const resM2 = calculateTaxes(300_000_000, 150_000_000, settings, 600_000_000);
	assert.equal(resM2.totalPajak, 500_000);

	// Month 3: Omzet 200M, YTD 800M -> all 200M is taxable = 1,000,000
	const resM3 = calculateTaxes(200_000_000, 100_000_000, settings, 800_000_000);
	assert.equal(resM3.totalPajak, 1_000_000);

	console.log('✓ Test 9: Progressive Multi-Period YTD Threshold passed');
}

console.log('All 9 Tax Calculation Test cases passed successfully!');
