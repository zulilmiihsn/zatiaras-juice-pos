import assert from 'node:assert/strict';
import { LEDGER_JENIS_LABEL, resolveLedgerCategory } from '../lib/utils/ledgerCategory';

// AUD-032: arah saja tak menentukan jenis usaha.
assert.deepEqual(Object.keys(LEDGER_JENIS_LABEL).sort(), [
	'beban_usaha',
	'lainnya',
	'pendapatan_usaha'
]);

// Kategori eksplisit valid dipakai apa adanya.
assert.deepEqual(
	resolveLedgerCategory({ type: 'pemasukan', category: 'pendapatan_usaha', deskripsi: 'x' }),
	{ jenis: 'pendapatan_usaha' }
);
assert.deepEqual(
	resolveLedgerCategory({ type: 'pengeluaran', category: 'beban_usaha', deskripsi: 'x' }),
	{ jenis: 'beban_usaha' }
);
assert.deepEqual(
	resolveLedgerCategory({ type: 'pemasukan', category: '  lainnya  ', deskripsi: 'x' }),
	{ jenis: 'lainnya' }
);

// Kategori eksplisit sampah = konfirmasi, bukan default diam.
const bad = resolveLedgerCategory({ type: 'pemasukan', category: 'modal_usaha', deskripsi: 'x' });
assert.ok('needsConfirmation' in bad);

// Setor modal / pinjaman = non-usaha walau arah masuk.
for (const deskripsi of [
	'Setoran modal ke kas',
	'tambah modal kerja',
	'pinjaman masuk dari investor',
	'hibah bantuan modal',
	'Top Up deposit kas'
]) {
	assert.deepEqual(
		resolveLedgerCategory({ type: 'pemasukan', deskripsi }),
		{ jenis: 'lainnya' },
		deskripsi
	);
}

// Prive = non-usaha walau arah keluar.
for (const deskripsi of [
	'Pengambilan prive',
	'ambil untuk pribadi',
	'ambil modal usaha',
	'pengambilan keuntungan pemilik'
]) {
	assert.deepEqual(
		resolveLedgerCategory({ type: 'pengeluaran', deskripsi }),
		{ jenis: 'lainnya' },
		deskripsi
	);
}

// Operasional tanpa kata kunci tetap ambigu = konfirmasi eksplisit.
for (const input of [
	{ type: 'pemasukan', deskripsi: 'Terima uang tunai' },
	{ type: 'pengeluaran', deskripsi: 'Bayar listrik' },
	{ type: 'pemasukan', deskripsi: '' },
	{ type: 'pengeluaran' }
]) {
	const resolved = resolveLedgerCategory(input);
	assert.ok('needsConfirmation' in resolved, JSON.stringify(input));
}

console.log('ledger-category-tests: eksplisit, modal/prive, ambigu passed');
