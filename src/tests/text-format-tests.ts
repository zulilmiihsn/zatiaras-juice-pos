import assert from 'node:assert/strict';
import { capitalizeFirst } from '../lib/utils/textFormat.js';
import { trimInput } from '../lib/utils/validation.js';

// Helper kapitalisasi POS terpusat.
assert.equal(capitalizeFirst('kulakan rutin'), 'Kulakan rutin');
assert.equal(capitalizeFirst(''), '');
assert.equal(capitalizeFirst('A'), 'A');
assert.equal(capitalizeFirst('eS tEh'), 'ES tEh');

// Input form hanya dirapikan; teks sah tidak boleh diubah isinya.
assert.equal(trimInput('  Bayar subscription Canva  '), 'Bayar subscription Canva');
assert.equal(trimInput('Beli kantong onion=2'), 'Beli kantong onion=2');
assert.equal(trimInput('Es <3 kelapa'), 'Es <3 kelapa');
assert.equal(trimInput(undefined), '');
assert.equal(trimInput(12), '');

console.log('text-format: ok');
