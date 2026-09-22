import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	buildArchiveSnapshot,
	summarizeManualRows,
	validateArchiveYear,
	ArchiveUseCaseError
} from '$lib/server/archiveUseCase';

// validateArchiveYear: batas kontrak route lama.
assert.throws(
	() => validateArchiveYear(Number.NaN),
	(e: unknown) => {
		assert.ok(e instanceof ArchiveUseCaseError);
		assert.equal(e.status, 400);
		return true;
	}
);
assert.throws(() => validateArchiveYear(2019), /Tahun tidak valid/);
assert.throws(() => validateArchiveYear(2101), /Tahun tidak valid/);
validateArchiveYear(2020);
validateArchiveYear(2026);

// buildArchiveSnapshot: perakitan deterministik.
const snapshot = buildArchiveSnapshot({
	branch: 'samarinda',
	year: 2026,
	cutoffWita: new Date('2026-01-01T00:00:00+08:00'),
	archiveJobId: 'job-12345678',
	bukuKas: [
		{ id: 'bk1', transaction_id: 'tx1', revision: 2, nominal: 1000 },
		{ id: 'bk2', transaction_id: null, revision: null, nominal: 2000 }
	],
	transaksiKasir: [{ id: 'tk1' }, { id: 'tk2' }, { id: 'tk3' }],
	now: new Date('2026-09-16T00:00:00.000Z')
});
assert.equal(snapshot.total, 5);
assert.equal(snapshot.filename, 'arsip-samarinda-sebelum-2026-job-1234.json');
assert.equal(snapshot.key, 'arsip/samarinda/2026/arsip-samarinda-sebelum-2026-job-1234.json');
assert.deepEqual(snapshot.itemManifest, [
	{ id: 'bk1', transaction_id: 'tx1', revision: 2 },
	{ id: 'bk2', transaction_id: null, revision: 0 }
]);
assert.deepEqual(snapshot.tkIds, ['tk1', 'tk2', 'tk3']);
assert.equal(snapshot.checksum, createHash('sha256').update(snapshot.content).digest('hex'));
const parsed = JSON.parse(snapshot.content) as {
	meta: {
		counts: { buku_kas: number; transaksi_kasir: number };
		branch: string;
		before_year: number;
	};
};
assert.deepEqual(parsed.meta.counts, { buku_kas: 2, transaksi_kasir: 3 });
assert.equal(parsed.meta.branch, 'samarinda');
assert.equal(parsed.meta.before_year, 2026);

// summarizeManualRows: pos dilewati, grup per hari WITA + dimensi.
const summaries = summarizeManualRows([
	{
		id: 'a',
		sumber: 'pos',
		waktu: '2025-12-01T00:00:00.000Z',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal: 99999
	},
	{
		id: 'b',
		sumber: 'catat',
		waktu: '2025-12-01T10:00:00.000Z',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal: 1000
	},
	{
		id: 'c',
		sumber: 'catat',
		waktu: '2025-12-01T11:00:00.000Z',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal: 2000
	},
	{
		id: 'd',
		sumber: 'catat',
		waktu: '2025-12-01T10:00:00.000Z',
		tipe: 'out',
		jenis: 'beban_usaha',
		nominal: 500
	},
	{
		id: 'e',
		sumber: 'catat',
		waktu: '2025-12-02T10:00:00.000Z',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal: 700
	}
]);
assert.equal(summaries.size, 3);
assert.deepEqual(summaries.get('2025-12-01:in:pendapatan_usaha:none'), {
	tanggal_wita: '2025-12-01',
	tipe: 'in',
	jenis: 'pendapatan_usaha',
	metode_bayar: null,
	count: 2,
	total_nominal: 3000
});

// Tepi WITA: 16:00 UTC = 00:00 WITA hari berikutnya.
const edge = summarizeManualRows([
	{
		id: 'w',
		sumber: 'catat',
		waktu: '2025-12-31T16:00:00.000Z',
		tipe: 'in',
		jenis: 'x',
		nominal: 1
	}
]);
assert.deepEqual([...edge.keys()], ['2026-01-01:in:x:none']);

// Waktu rusak: fallback slice mentah, tidak melempar.
const broken = summarizeManualRows([
	{ id: 'z', sumber: 'catat', waktu: 'bukan-tanggal', tipe: 'in', jenis: 'x', nominal: 1 }
]);
assert.deepEqual([...broken.keys()], ['bukan-tang:in:x:none']);

console.log('archive-usecase-tests: all assertions passed');
process.exit(0);
