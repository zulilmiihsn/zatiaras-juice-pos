import assert from 'node:assert/strict';
import { branchLabel } from '../lib/utils/branches';

// AUD-029: lima cabang + alias konsisten; unknown netral (bukan nama salah).
assert.equal(branchLabel('samarinda'), 'Samarinda');
assert.equal(branchLabel('berau'), 'Berau');
assert.equal(branchLabel('balikpapan'), 'Balikpapan');
assert.equal(branchLabel('samarinda2'), 'Samarinda 2');
assert.equal(branchLabel('balikpapan2'), 'Balikpapan 2');
assert.equal(branchLabel(' Samarinda '), 'Samarinda');
assert.equal(branchLabel('SAMARINDA2'), 'Samarinda 2');
assert.equal(branchLabel('cabang-palsu'), null);
assert.equal(branchLabel(''), null);
assert.equal(branchLabel(null), null);
assert.equal(branchLabel(undefined), null);

console.log('branch-label-tests: lima label + netral unknown passed');
