import assert from 'node:assert/strict';
import {
	parseQuantityInput,
	formatQuantityInput,
	parseRupiah,
	sanitizeQuantityDraft
} from '../lib/utils/currency.js';
import { convertToBaseUnit, convertFromBaseUnit } from '../lib/utils/unitConversion.js';

// R01: parser desimal Indonesia, bukan parser uang.
assert.equal(parseQuantityInput('0,5'), 0.5);
assert.equal(parseQuantityInput('1.000'), 1000);
assert.equal(parseQuantityInput('1.000,5'), 1000.5);
assert.equal(parseQuantityInput('0.5'), 0.5);
assert.equal(parseQuantityInput('0.125'), 0.125);
assert.equal(parseQuantityInput('1,125'), 1.125);
assert.equal(parseQuantityInput('10,125'), 10.125);
assert.equal(parseQuantityInput('1,000'), 1);
assert.equal(parseQuantityInput('12.34'), 12.34);
assert.equal(parseQuantityInput('10.000'), 10000);
assert.equal(parseQuantityInput('1,000,000'), 1000000);
assert.equal(parseQuantityInput('1.000.000'), 1000000);
assert.equal(parseQuantityInput('0,05'), 0.05);
assert.equal(parseQuantityInput('-0,5'), -0.5);
assert.equal(parseQuantityInput('abc'), 0);
assert.equal(parseQuantityInput('1.2.3'), 123);
assert.equal(parseQuantityInput('Rp 1.000,50'), 1000.5);
// Roundtrip formatter<->parser harus identik (temuan audit: 1,125 -> 1125).
for (const n of [0, 0.5, 0.125, 1, 1.5, 12.34, 100, 1000, 1500.25, 1000000, 0.0001]) {
	assert.equal(
		parseQuantityInput(formatQuantityInput(n)),
		n,
		`roundtrip ${n} via "${formatQuantityInput(n)}"`
	);
}
assert.equal(parseQuantityInput('2'), 2);
assert.equal(parseQuantityInput(''), 0);
// Draft ketik dipertahankan (format hanya saat blur).
assert.equal(sanitizeQuantityDraft('0,'), '0,');
assert.equal(sanitizeQuantityDraft('0.5kg'), '0.5');
assert.equal(parseQuantityInput(sanitizeQuantityDraft('0,')), 0);
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

// Values produced by our own id-ID formatter must preserve their meaning.
for (const quantity of [1.125, 10.125, 1234.125, -1.125, 1.0125, 0.0001]) {
	assert.equal(parseQuantityInput(formatQuantityInput(quantity)), quantity);
	let grams = convertToBaseUnit(quantity < 0 ? -quantity : quantity, 'kg', 'gram');
	const original = grams;
	for (let save = 0; save < 3; save++) {
		grams = convertToBaseUnit(
			parseQuantityInput(formatQuantityInput(convertFromBaseUnit(grams, 'kg', 'gram'))),
			'kg',
			'gram'
		);
	}
	assert.equal(grams, original);
}

console.log('quantity-decimal-tests: all assertions passed');
