import assert from 'node:assert/strict';
import { capitalizeFirst } from '../lib/utils/textFormat.js';

// AUD-053 slice 3: helper kapitalisasi pos terpusat, perilaku identik pindahan.
assert.equal(capitalizeFirst('kulakan rutin'), 'Kulakan rutin');
assert.equal(capitalizeFirst(''), '');
assert.equal(capitalizeFirst('A'), 'A');
assert.equal(capitalizeFirst('eS tEh'), 'ES tEh');

console.log('text-format: ok');
