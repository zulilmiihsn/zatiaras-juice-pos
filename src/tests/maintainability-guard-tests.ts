import assert from 'node:assert/strict';
import { computeMetrics } from '../../scripts/quality-baseline.mjs';

/**
 * Guard maintainability. Batas di bawah adalah ratchet: angka saat ini, bukan target
 * longgar. Menaikkan batas wajib disertai alasan di pesan commit.
 */
const metrics = computeMetrics();

// Tanpa `any` eksplisit.
assert.equal(
	metrics.anyCount,
	0,
	`explicit any ditemukan (${metrics.anyCount}); pakai tipe yang tepat`
);

// Tanpa catch kosong; jalur best-effort wajib menulis alasan di dalam catch.
assert.equal(metrics.emptyCatch, 0, `empty catch ditemukan (${metrics.emptyCatch})`);

// Route tidak boleh import DB langsung; SQL milik service/use case via BranchContext.
const ALLOWED_ROUTE_DB_IMPORTS: string[] = [];
assert.deepEqual(metrics.routeDbImportFiles, ALLOWED_ROUTE_DB_IMPORTS);

// File terbesar saat ini aiChatUseCase.ts (~1220 baris). Jangan biarkan tumbuh; pecah dulu.
const maxFile = metrics.topFiles[0];
assert.ok(
	maxFile.lines <= 1250,
	`hotspot ${maxFile.file} (${maxFile.lines} baris) melebihi cap 1250 — pecah dulu`
);

console.log(
	`maintainability-guard-tests: ${metrics.srcFiles} file, any=${metrics.anyCount}, emptyCatch=${metrics.emptyCatch}, routeDb=${metrics.routeDbImportCount}, max=${maxFile.file}:${maxFile.lines}`
);
process.exit(0);
