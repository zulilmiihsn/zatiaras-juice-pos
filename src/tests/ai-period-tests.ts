import assert from 'node:assert/strict';
import { resolveAiPeriod, hasPeriodQualifier, detectAiIntent } from '../lib/server/aiPeriod.js';

// R11: qualifier eksplisit dihormati; ambigu/tak dikenal -> null (analyzer).
const ref = '2026-09-15';
assert.deepEqual(resolveAiPeriod('menu terlaris bulan lalu', ref), {
	start: '2026-08-01',
	end: '2026-08-31',
	type: 'monthly'
});
assert.deepEqual(resolveAiPeriod('menu terlaris bulan ini', ref), {
	start: '2026-09-01',
	end: ref,
	type: 'monthly'
});
assert.deepEqual(resolveAiPeriod('penjualan kemarin', ref), {
	start: '2026-09-14',
	end: '2026-09-14',
	type: 'daily'
});
// Tanggal eksplisit hari-bulan: satu hari, bukan sebulan penuh.
assert.deepEqual(resolveAiPeriod('laporan tanggal 15 Agustus 2026', ref), {
	start: '2026-08-15',
	end: '2026-08-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('menu terlaris 1 agustus 2026', ref), {
	start: '2026-08-01',
	end: '2026-08-01',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('laporan August 15, 2026', ref), {
	start: '2026-08-15',
	end: '2026-08-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('laporan 29 Februari 2024', ref), {
	start: '2024-02-29',
	end: '2024-02-29',
	type: 'daily'
});
// Tanggal mustahil tak dilebarkan diam-diam ke sebulan.
assert.equal(resolveAiPeriod('laporan 29 Februari 2025', ref), null);
// "August 2026" tanpa hari tetap sebulan (bukan tanggal 20 imajiner).
assert.deepEqual(resolveAiPeriod('rekap August 2026', ref), {
	start: '2026-08-01',
	end: '2026-08-31',
	type: 'monthly'
});
// Bulan bernama tanpa hari tetap sebulan penuh.
assert.deepEqual(resolveAiPeriod('menu terlaris bulan Agustus 2026', ref), {
	start: '2026-08-01',
	end: '2026-08-31',
	type: 'monthly'
});
// Rentang hari dalam sebulan, bukan satu hari saja.
assert.deepEqual(resolveAiPeriod('laporan 1 sampai 15 Agustus 2026', ref), {
	start: '2026-08-01',
	end: '2026-08-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('1-15 Agustus', ref), {
	start: '2026-08-01',
	end: '2026-08-15',
	type: 'daily'
});
// Rentang terbalik tak dilebarkan diam-diam.
assert.equal(resolveAiPeriod('laporan 15 sampai 1 Agustus 2026', ref), null);
// Dua bulan: awal bulan pertama s/d akhir bulan kedua.
assert.deepEqual(resolveAiPeriod('rekap Agustus sampai September 2026', ref), {
	start: '2026-08-01',
	end: '2026-09-15',
	type: 'monthly'
});
// Bungkus tahun tanpa kepastian -> analyzer.
assert.equal(resolveAiPeriod('rekap Desember sampai Januari', ref), null);
// Tahun relatif.
assert.deepEqual(resolveAiPeriod('rekap tahun lalu', ref), {
	start: '2025-01-01',
	end: '2025-12-31',
	type: 'monthly'
});
assert.deepEqual(resolveAiPeriod('rekap tahun ini', ref), {
	start: '2026-01-01',
	end: ref,
	type: 'monthly'
});
// Januari memakai Desember tahun sebelumnya.
assert.deepEqual(resolveAiPeriod('menu terlaris bulan lalu', '2026-01-15'), {
	start: '2025-12-01',
	end: '2025-12-31',
	type: 'monthly'
});
// Ambigu/tak dikenal -> null agar analyzer dipakai.
assert.equal(resolveAiPeriod('bagaimana kabarmu', ref), null);
assert.equal(resolveAiPeriod('target omzet 2026 50 juta', ref), null);
// Substring 'es' tak memicu intent pelanggan.
assert.equal(detectAiIntent('proses laporan')?.prioritas ?? null, null);
assert.equal(detectAiIntent('menu terlaris bulan lalu')?.prioritas, 'product_analysis');
// Qualifier luas terdeteksi (mencegah default bulan berjalan yang salah).
for (const q of [
	'menu terlaris bulan Agustus 2026',
	'tanggal 15 Agustus 2026',
	'rekap tahun lalu',
	'tren minggu lalu',
	'kuartal ini'
]) {
	assert.equal(hasPeriodQualifier(q), true, q);
}

console.log('ai-period-tests: all assertions passed');

assert.deepEqual(resolveAiPeriod('menu terlaris tanggal 15 Agustus tahun lalu', ref), {
	start: '2025-08-15',
	end: '2025-08-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('tahun lalu laporan 1 sampai 15 Agustus', ref), {
	start: '2025-08-01',
	end: '2025-08-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('rekap Juli sampai Agustus tahun lalu', ref), {
	start: '2025-07-01',
	end: '2025-08-31',
	type: 'monthly'
});
for (const q of [
	'bandingkan menu terlaris Juli dan Agustus 2026',
	'menu terlaris Juli dan Agustus 2026',
	'laporan 15 Juli sampai 15 Agustus 2026',
	'laporan 15 Juli sampai Agustus 2026',
	'laporan Januari sampai Maret dan Agustus 2026',
	'laporan 15 Agustus 2026 tahun lalu',
	'laporan kemarin tahun lalu',
	'laporan bulan lalu tahun lalu',
	'laporan 1 sampai 15 Agustus 2027'
]) {
	assert.equal(resolveAiPeriod(q, ref), null, q);
	assert.equal(hasPeriodQualifier(q), true, q);
}
console.log('ai-period-tests: composite qualifiers and analyzer fallbacks passed');

// AUD-036: tanggal/bulan masa depan tahun berjalan ditolak (tanpa query
// historis); hari ini, kemarin, kabisat, lintas batas tetap konsisten.
// ref '2026-09-15': 31 Des 2026 dan Des 2026 masa depan -> null.
const refFuture = '2026-09-15';
for (const q of [
	'laporan tanggal 31 Desember 2026',
	'laporan 31 Desember 2026',
	'laporan Desember 2026',
	'menu terlaris Desember 2026',
	'laporan 1 Desember 2026',
	'laporan December 25, 2026'
]) {
	assert.equal(resolveAiPeriod(q, refFuture), null, q);
	assert.equal(hasPeriodQualifier(q), true, q);
}
// Batas inklusif: hari ini boleh; kemarin boleh; esok tidak.
assert.deepEqual(resolveAiPeriod('laporan tanggal 15 September 2026', refFuture), {
	start: '2026-09-15',
	end: '2026-09-15',
	type: 'daily'
});
assert.deepEqual(resolveAiPeriod('penjualan kemarin', refFuture), {
	start: '2026-09-14',
	end: '2026-09-14',
	type: 'daily'
});
assert.equal(resolveAiPeriod('laporan tanggal 16 September 2026', refFuture), null);
// Kabisat valid vs mustahil tanpa rollover diam-diam.
assert.deepEqual(resolveAiPeriod('laporan 29 Februari 2024', '2024-03-01'), {
	start: '2024-02-29',
	end: '2024-02-29',
	type: 'daily'
});
assert.equal(resolveAiPeriod('laporan 29 Februari 2025', '2025-03-01'), null);
assert.equal(resolveAiPeriod('laporan 31 Februari 2024', '2024-03-01'), null);
// Lintas batas: bulan lalu Desember tahun lalu; awal tahun Kempis Januari.
assert.deepEqual(resolveAiPeriod('menu terlaris bulan lalu', '2026-01-10'), {
	start: '2025-12-01',
	end: '2025-12-31',
	type: 'monthly'
});
assert.deepEqual(resolveAiPeriod('laporan Januari 2026', '2026-01-10'), {
	start: '2026-01-01',
	end: '2026-01-10',
	type: 'monthly'
});
console.log('ai-period-tests: future rejection and boundary consistency passed (AUD-036)');
