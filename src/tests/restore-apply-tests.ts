import assert from 'node:assert/strict';
import {
	validateArchive,
	buildRestoreSql,
	diffAgainstExisting,
	BK_FIELDS,
	TK_FIELDS
} from '../../scripts/restore-archive-lib.mjs';

// R08: sumber POS dipertahankan (bukan arsip_restored), tanpa REPLACE buta.
const archive = {
	meta: {
		schema_version: 2,
		archive_id: 'a1',
		branch: 'samarinda',
		counts: { buku_kas: 1, transaksi_kasir: 1 }
	},
	buku_kas: [
		{
			id: 'bk1',
			cabang_id: 'samarinda',
			waktu: '2024-01-01T00:00:00.000Z',
			sumber: 'pos',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 40000
		}
	],
	transaksi_kasir: [
		{ id: 'tk1', cabang_id: 'samarinda', buku_kas_id: 'bk1', jumlah: 1, nominal: 40000 }
	]
};
assert.equal(validateArchive(archive).ok, true);
const built = buildRestoreSql(archive, { sha256: 'abc' });
assert.ok(!built.sql.includes('OR REPLACE'), 'tanpa INSERT OR REPLACE buta');
assert.ok(!built.sql.includes('arsip_restored'), 'sumber bisnis tidak dijadikan marker');
assert.ok(built.sql.includes("'pos'"), 'sumber pos dipertahankan');
assert.ok(built.sql.includes('WHERE NOT EXISTS'), 'insert kondisional anti-timpa');
assert.ok(built.sql.trimStart().startsWith('--'), 'header komentar');
assert.ok(built.sql.includes('BEGIN TRANSACTION;') && built.sql.trimEnd().endsWith('COMMIT;'));
assert.ok(built.sql.includes('archive_restore_a1'), 'marker restore terpisah tercatat');

// Cabang beda ditolak validasi.
const bad = structuredClone(archive);
bad.buku_kas[0].cabang_id = 'balikpapan';
assert.equal(validateArchive(bad).ok, false);

// Konflik: ID sama nominal beda -> abort, bukan skip diam-diam.
const existing = new Map([
	[
		'bk1',
		{
			id: 'bk1',
			cabang_id: 'samarinda',
			waktu: '2024-01-01T00:00:00.000Z',
			sumber: 'pos',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 99999,
			transaction_id: null
		}
	]
]);
const d1 = diffAgainstExisting(archive.buku_kas, existing, BK_FIELDS);
assert.equal(d1.conflict.length, 1);
assert.equal(d1.insert.length, 0);
// Identik -> skip (apply kedua no-op).
const bk1 = existing.get('bk1');
assert.ok(bk1);
bk1.nominal = 40000;
const d2 = diffAgainstExisting(archive.buku_kas, existing, BK_FIELDS);
assert.equal(d2.skip.length, 1);
assert.equal(d2.insert.length, 0);
const d3 = diffAgainstExisting(archive.transaksi_kasir, new Map(), TK_FIELDS);
assert.equal(d3.insert.length, 1);

console.log('restore-apply-tests: all assertions passed');
