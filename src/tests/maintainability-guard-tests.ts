import assert from 'node:assert/strict';
import { computeMetrics } from '../../scripts/quality-baseline.mjs';

/**
 * Guard hutang maintainability (MNT-01/06/07).
 * Caps = baseline 22 Sep 2026 + headroom kecil. Menaikkan cap wajib
 * disertai alasan di commit, bukan penyesuaian diam-diam.
 */
const metrics = computeMetrics();

// `any` eksplisit: baseline 26, cap 30.
assert.ok(
	metrics.anyCount <= 30,
	`explicit any ${metrics.anyCount} melebihi cap 30 — rapikan dulu atau naikkan cap dengan alasan`
);

// Empty catch: baseline 41, cap 45. Tiap catch baru wajib best-effort + alasan.
assert.ok(metrics.emptyCatch <= 45, `empty catch ${metrics.emptyCatch} melebihi cap 45`);

// Direct DB import dari route: daftar allowlist eksplisit (baseline 26 file).
// Route BARU yang import DB langsung menggagalkan tes ini (target: BranchContext).
const ALLOWED_ROUTE_DB_IMPORTS = [
	'src/routes/api/aichat/+server.ts',
	'src/routes/api/archive/+server.ts',
	'src/routes/api/bahan-mutasi/+server.ts',
	'src/routes/api/bahan/+server.ts',
	'src/routes/api/buku-kas/+server.ts',
	'src/routes/api/dashboard/best-sellers/+server.ts',
	'src/routes/api/dashboard/pos-kas-7hari/+server.ts',
	'src/routes/api/dashboard/stats/+server.ts',
	'src/routes/api/dashboard/weekly/+server.ts',
	'src/routes/api/gantikeamanan/+server.ts',
	'src/routes/api/hpp-settings/+server.ts',
	'src/routes/api/monitoring/+server.ts',
	'src/routes/api/pengaturan/+server.ts',
	'src/routes/api/pengaturan/pajak/+server.ts',
	'src/routes/api/pin/+server.ts',
	'src/routes/api/pin/verify/+server.ts',
	'src/routes/api/pos/catalog/+server.ts',
	'src/routes/api/pos/quote/+server.ts',
	'src/routes/api/pos/transaction/+server.ts',
	'src/routes/api/produk/save-atomic/+server.ts',
	'src/routes/api/reports/aggregate/+server.ts',
	'src/routes/api/resep-produk/+server.ts',
	'src/routes/api/security-events/+server.ts',
	'src/routes/api/sesi-toko/+server.ts',
	'src/routes/api/transaksi-kasir/+server.ts',
	'src/routes/api/veriflogin/+server.ts'
];
assert.deepEqual(metrics.routeDbImportFiles, ALLOWED_ROUTE_DB_IMPORTS);

// Hotspot baris: cegah file raksasa baru (maksimum saat ini 2145).
const maxFile = metrics.topFiles[0];
assert.ok(
	maxFile.lines <= 2200,
	`hotspot baru ${maxFile.file} (${maxFile.lines} baris) melebihi cap 2200 — pecah dulu`
);

console.log(
	`maintainability-guard-tests: ${metrics.srcFiles} file, any=${metrics.anyCount}, emptyCatch=${metrics.emptyCatch}, routeDb=${metrics.routeDbImportCount}, max=${maxFile.file}:${maxFile.lines}`
);
process.exit(0);
