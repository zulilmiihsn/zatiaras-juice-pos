import assert from 'node:assert/strict';
import { parseExtraIds } from '../../scripts/seed-external-branches-utils.mjs';

assert.deepEqual(parseExtraIds(null, 'Teh'), []);
assert.deepEqual(parseExtraIds('', 'Teh'), []);
assert.deepEqual(parseExtraIds(['extra-1', 'extra-2'], 'Teh'), ['extra-1', 'extra-2']);
assert.deepEqual(parseExtraIds('["extra-1"]', 'Teh'), ['extra-1']);
assert.throws(() => parseExtraIds('{broken', 'Teh'), /Data ekstra untuk produk Teh tidak valid/);
assert.throws(
	() => parseExtraIds('{"id":"extra-1"}', 'Teh'),
	/Format data ekstra untuk produk Teh tidak valid/
);
assert.throws(
	() => parseExtraIds('["extra-1",4]', 'Teh'),
	/Format data ekstra untuk produk Teh tidak valid/
);

console.log('seed-external-branches-tests: 7 assertions passed');
