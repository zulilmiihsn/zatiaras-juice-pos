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
// AUD-006 menambahkan purchase route (BranchContext + use case tipis, preseden
// checkout): kenaikan eksplisit ini disetujui. Target tetap mengecilkan daftar.
// AUD-040 menambahkan archive download route (branch-scoped job lookup +
// R2 streaming, pola route tipis sama): kenaikan eksplisit ini disetujui.
// AUD-053 menghapus reports aggregate route (BranchContext + use case tipis,
// preseden sama): penurunan eksplisit ini disetujui. Target tetap mengecilkan daftar.
// AUD-053 lanjutan menghapus 4 route dashboard (stats, best-sellers, pos-kas-7hari,
// weekly) via wrapper BranchContext yang sama: penurunan eksplisit disetujui.
// AUD-053 lanjutan menghapus route transaksi-kasir via wrapper service yang sama.
// AUD-053 lanjutan menghapus route sesi-toko via wrapper service yang sama.
// AUD-053 lanjutan menghapus route bahan-mutasi via wrapper service yang sama.
// AUD-053 lanjutan menghapus 2 route arsip via wrapper use case yang sama.
// AUD-053 lanjutan menghapus route bahan + resep-produk via wrapper service yang sama.
// AUD-053 lanjutan menghapus route pengaturan + hpp-settings + pajak via wrapper
// service yang sama.
// AUD-053 lanjutan menghapus route pos catalog + transaction + quote via use case
// yang sama.
// AUD-053 lanjutan menghapus route monitoring via snapshot boundary yang sama.
// AUD-053 lanjutan menghapus route buku-kas via wrapper service yang sama.
// AUD-053 lanjutan menghapus route security-events via observability yang sama.
// AUD-053 lanjutan menghapus route save-atomic via service yang sama.
const ALLOWED_ROUTE_DB_IMPORTS = [
	'src/routes/api/aichat/+server.ts',
	'src/routes/api/bahan/purchase/+server.ts',
	'src/routes/api/gantikeamanan/+server.ts',
	'src/routes/api/pin/+server.ts',
	'src/routes/api/pin/verify/+server.ts',
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
