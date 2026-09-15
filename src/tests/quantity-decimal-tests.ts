import assert from 'node:assert/strict';
import { parseQuantityInput, formatQuantityInput, parseRupiah } from '../lib/utils/currency.js';
import { convertToBaseUnit, convertFromBaseUnit } from '../lib/utils/unitConversion.js';

// R01: parser desimal Indonesia, bukan parser uang.
assert.equal(parseQuantityInput('0,5'), 0.5);
assert.equal(parseQuantityInput('1.000'), 1000);
assert.equal(parseQuantityInput('1.000,5'), 1000.5);
assert.equal(parseQuantityInput('0.5'), 0.5);
assert.equal(parseQuantityInput('2'), 2);
assert.equal(parseQuantityInput(''), 0);
// Parser uang lama memang salah untuk pecahan (dokumentasi bug, jangan dipakai jumlah).
assert.equal(parseRupiah('0,5'), 5);
// Roundtrip edit: 500 gram -> tampil 0,5 kg -> simpan 500 gram lagi.
const display = formatQuantityInput(convertFromBaseUnit(500, 'kg', 'gram'));
assert.equal(display, '0,5');
assert.equal(convertToBaseUnit(parseQuantityInput(display), 'kg', 'gram'), 500);
// 1 kg tetap identik tiga kali simpan.
let base = 1000;
for (let i = 0; i < 3; i++) {
	const shown = convertFromBaseUnit(base, 'kg', 'gram');
	base = convertToBaseUnit(parseQuantityInput(formatQuantityInput(shown)), 'kg', 'gram');
}
assert.equal(base, 1000);
// Pack isi N pecahan.
assert.equal(convertToBaseUnit(parseQuantityInput('0,5'), 'pack', 'pcs', 50), 25);

console.log('quantity-decimal-tests: all assertions passed');
