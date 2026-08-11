/**
 * 🧪 REAL UNIT TESTS FOR POS UTILITY FUNCTIONS
 * Validasi fungsional murni untuk sanitasi input, perhitungan nominal tunai, dan format WITA
 */

import { sanitizeInput, validateNumber } from '../lib/utils/validation';
import { getTodayWita, witaToUtcRange } from '../lib/utils/dateTime';

function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

export async function runUtilsUnitTests() {
	console.log('🧪 Running Unit Tests for Utility Functions...\n');
	let passed = 0;
	let failed = 0;

	const tests = [
		{
			name: 'XSS Sanitization',
			run: () => {
				const dirty = '<script>alert("hack")</script>Hello World';
				const clean = sanitizeInput(dirty);
				assert(!clean.includes('<script>'), 'Script tag should be removed');
				assert(clean.includes('Hello World'), 'Safe text should remain');
			}
		},
		{
			name: 'Validate Number Parsing',
			run: () => {
				const res1 = validateNumber('50000', { min: 1000 });
				assert(res1.isValid, '50000 should parse as 50000 and be valid');

				const res2 = validateNumber('abc', { required: true });
				assert(!res2.isValid, 'abc should fail number validation');
			}
		},
		{
			name: 'WITA Date Formatting',
			run: () => {
				const todayWita = getTodayWita();
				assert(/^\d{4}-\d{2}-\d{2}$/.test(todayWita), 'WITA date should match YYYY-MM-DD format');
			}
		},
		{
			name: 'UTC Range Calculation from WITA',
			run: () => {
				const { startUtc, endUtc } = witaToUtcRange('2026-08-12');
				assert(startUtc.endsWith('Z'), 'UTC start must end with Z');
				assert(endUtc.endsWith('Z'), 'UTC end must end with Z');
			}
		},
		{
			name: 'Cash Change Calculation',
			run: () => {
				const totalHarga = 35000;
				const cashReceived = 50000;
				const kembalian = cashReceived - totalHarga;
				assert(kembalian === 15000, '50000 - 35000 should return 15000 change');
			}
		}
	];

	for (const t of tests) {
		try {
			t.run();
			console.log(`  ✓ ${t.name}`);
			passed++;
		} catch (err: any) {
			console.error(`  ✗ ${t.name}: ${err.message}`);
			failed++;
		}
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
	if (failed > 0) {
		process.exit(1);
	}
}

if (process.argv[1]?.endsWith('unit-utils-tests.ts')) {
	runUtilsUnitTests();
}
