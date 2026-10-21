import assert from 'node:assert/strict';
import { computeMetrics } from '../../scripts/frontend-consistency.mjs';

/**
 * Ratchet konsistensi frontend. Angka di bawah adalah baseline hasil
 * `node scripts/frontend-consistency.mjs`, bukan target longgar: tiap kartu di
 * docs/FRONTEND-CONSISTENCY.md menurunkan ceiling miliknya di commit yang sama.
 * Menaikkan ceiling wajib disertai alasan di pesan commit.
 */
const CEILINGS: Record<string, number> = {
	nestedStyle: 2,
	effectAssignOnly: 0,
	appStoresImport: 3,
	pureGotoButton: 2,
	headerBackGoto: 6,
	consoleLogClient: 1,
	staleVersionText: 3,
	arbitraryDvh: 18,
	flexShrinkAlias: 28,
	lowercaseComponentFiles: 11,
	importPathCaseMismatch: 0,
	overlayFiles: 17,
	inlineToast: 3,
	roleButton: 14,
	duplicatedLongClassGroups: 36,
	brandHexClass: 118,
	canvasHex: 23,
	neutralNonSlate: 276,
	roleLiteralUI: 36,
	e2eWaitForTimeout: 18
};

const { metrics, details, parseFailures } = computeMetrics();

assert.deepEqual(parseFailures, [], `file .svelte gagal di-parse:\n${parseFailures.join('\n')}`);

// Metrik baru wajib punya ceiling; ceiling tanpa metrik berarti aturan terhapus diam-diam.
assert.deepEqual(
	Object.keys(metrics).sort(),
	Object.keys(CEILINGS).sort(),
	'daftar metrik di scripts/frontend-consistency.mjs dan CEILINGS harus sama'
);

for (const [name, ceiling] of Object.entries(CEILINGS)) {
	const value = metrics[name];
	assert.ok(
		value <= ceiling,
		`${name}: ${value} > ceiling ${ceiling}. Pelanggaran baru:\n  ${details[name].join('\n  ')}`
	);
	// Ratchet naik-turun: bila kartu menurunkan angka, ceiling wajib ikut diturunkan.
	assert.ok(
		value === ceiling,
		`${name}: sekarang ${value}, ceiling masih ${ceiling}. Turunkan ceiling di tes ini ke ${value}`
	);
}

console.log(
	`frontend-consistency-guard-tests: ${Object.keys(CEILINGS).length} metrik, ` +
		`${Object.values(metrics).reduce((a, b) => a + b, 0)} pelanggaran tercatat`
);
process.exit(0);
