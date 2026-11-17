import assert from 'node:assert/strict';
import { branchLabel } from '../lib/utils/branches';

// Tiga cabang + alias konsisten; unknown netral (bukan nama salah). Cabang yang sudah dihapus juga netral.
assert.equal(branchLabel('samarinda'), 'Samarinda');
assert.equal(branchLabel('berau'), 'Berau');
assert.equal(branchLabel('balikpapan'), 'Balikpapan');
assert.equal(branchLabel('samarinda2'), null);
assert.equal(branchLabel('balikpapan2'), null);
assert.equal(branchLabel(' Samarinda '), 'Samarinda');
assert.equal(branchLabel('SAMARINDA'), 'Samarinda');
assert.equal(branchLabel('cabang-palsu'), null);
assert.equal(branchLabel(''), null);
assert.equal(branchLabel(null), null);
assert.equal(branchLabel(undefined), null);

console.log('branch-label-tests: tiga label + netral unknown passed');
