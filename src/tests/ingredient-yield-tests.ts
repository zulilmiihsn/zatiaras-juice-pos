import assert from 'node:assert/strict';
import {
	calculateEffectiveUnitCost,
	calculateUsableQuantity,
	isValidYieldPercent,
	normalizeYieldPercent
} from '../lib/utils/ingredientCost';

assert.equal(normalizeYieldPercent(undefined), 100);
assert.equal(normalizeYieldPercent(65), 65);
assert.equal(normalizeYieldPercent('65,5'), 65.5);
assert.equal(isValidYieldPercent(0), false);
assert.equal(isValidYieldPercent(101), false);
assert.equal(isValidYieldPercent(65.5), true);
assert.equal(calculateUsableQuantity(10_000, 65), 6_500);
assert.equal(calculateUsableQuantity(1_000, 100), 1_000);
assert.equal(calculateUsableQuantity(-1, 65), 0);
assert.equal(calculateEffectiveUnitCost(300_000, 10_000, 65), 46.1538);
assert.equal(calculateEffectiveUnitCost(300_000, 10_000, 100), 30);
assert.equal(calculateEffectiveUnitCost(300_000, 0, 65), 0);

console.log('ingredient-yield-tests: 12 assertions passed');
