import assert from 'node:assert/strict';
import {
	LedgerValidationError,
	validateLedgerNominal,
	validateManualLedgerPatch,
	validateManualLedgerRows
} from '$lib/server/ledgerValidation';

function validRow(overrides: Record<string, unknown> = {}) {
	return {
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		sumber: 'catat',
		nominal: 100000,
		waktu: '2026-10-05T00:00:00.000Z',
		metode_bayar: 'tunai',
		deskripsi: 'Setoran modal',
		...overrides
	};
}

function rejects(_fn: () => unknown, _pattern: RegExp) {
	assert.throws(
		_fn,
		(e: unknown) => e instanceof LedgerValidationError && _pattern.test(e.message)
	);
}

// Nominal invalid ditolak — tidak pernah dikoersi menjadi 0 (AUD-005).
rejects(() => validateManualLedgerRows([validRow({ nominal: 'not-a-number' })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: -5000 })]), /negatif/);
rejects(() => validateManualLedgerRows([validRow({ nominal: Number.NaN })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: Infinity })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: undefined })]), /Nominal/);

// Seluruh batch divalidasi sebelum tulis: baris invalid di akhir menolak semua.
rejects(() => validateManualLedgerRows([validRow(), validRow({ nominal: 'rusak' })]), /Nominal/);

// Desimal rupiah tidak tersimpan mentah: dibulatkan ke integer.
const rounded = validateManualLedgerRows([validRow({ nominal: 100000.123456 })]);
assert.equal(rounded[0].nominal, 100000);
assert.equal(validateLedgerNominal('25000'), 25000);

// Domain enum ditolak.
rejects(() => validateManualLedgerRows([validRow({ tipe: 'credit' })]), /Tipe/);
rejects(() => validateManualLedgerRows([validRow({ jenis: 'modal' })]), /Jenis/);
rejects(() => validateManualLedgerRows([validRow({ sumber: 'lain' })]), /Sumber/);
rejects(() => validateManualLedgerRows([validRow({ metode_bayar: 'transfer' })]), /Metode/);
rejects(() => validateManualLedgerRows([validRow({ waktu: 'not-a-date' })]), /Waktu/);
rejects(() => validateManualLedgerRows([validRow({ deskripsi: '   ' })]), /Deskripsi/);

// Pairing tipe/jenis: modal bukan usaha, prive bukan beban.
rejects(
	() => validateManualLedgerRows([validRow({ tipe: 'in', jenis: 'beban_usaha' })]),
	/tidak cocok/
);
rejects(
	() => validateManualLedgerRows([validRow({ tipe: 'out', jenis: 'pendapatan_usaha' })]),
	/tidak cocok/
);

// Jalur sah: catat + kulakan stok, qris dinormalisasi non-tunai.
const ok = validateManualLedgerRows([
	validRow(),
	validRow({
		tipe: 'out',
		jenis: 'beban_usaha',
		sumber: 'stok',
		nominal: 20000,
		metode_bayar: 'qris',
		deskripsi: 'Kulakan gula'
	})
]);
assert.equal(ok.length, 2);
assert.equal(ok[1].nominal, 20000);
assert.equal(ok[1].metode_bayar, 'non-tunai');

// PATCH parsial: nominal/waktu divalidasi, pairing dicek lawan nilai kini.
const patched = validateManualLedgerPatch(
	{ nominal: 75000.6 },
	{ tipe: 'out', jenis: 'beban_usaha' }
);
assert.equal(patched.nominal, 75001);
assert.throws(
	() =>
		validateManualLedgerPatch({ jenis: 'pendapatan_usaha' }, { tipe: 'out', jenis: 'beban_usaha' }),
	(e: unknown) => e instanceof LedgerValidationError
);
assert.throws(
	() => validateManualLedgerPatch({ sumber: 'pos' }, { tipe: 'in', jenis: 'pendapatan_usaha' }),
	(e: unknown) => e instanceof LedgerValidationError
);

console.log('ledger-validation: all assertions passed');
