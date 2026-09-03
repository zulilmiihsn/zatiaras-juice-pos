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
assert.equal(calculateEffectiveUnitCost(300_000, 10), 30_000);
assert.equal(calculateEffectiveUnitCost(15_000, 3), 5_000);
assert.equal(calculateEffectiveUnitCost(10_000, '5'), 2_000);
assert.equal(calculateEffectiveUnitCost(300_000, 0), 0);
assert.equal(calculateEffectiveUnitCost(300_000, -1), 0);
assert.equal(calculateEffectiveUnitCost(-100, 10), 0);
assert.equal(calculateEffectiveUnitCost(undefined, 10), 0);
assert.equal(calculateEffectiveUnitCost(10_000, null), 0);
assert.equal(calculateEffectiveUnitCost(NaN, 5), 0);
import { convertToBaseUnit } from '../lib/utils/unitConversion';

assert.throws(() => convertToBaseUnit(100, 'ml', 'gram'), /Konversi satuan tidak kompatibel/);
assert.throws(() => convertToBaseUnit(1, 'kg', 'liter'), /Konversi satuan tidak kompatibel/);
assert.equal(convertToBaseUnit(500, 'gram', 'kg'), 0.5);
assert.equal(convertToBaseUnit(2, 'liter', 'ml'), 2000);

console.log('ingredient-yield-tests: 26 assertions passed');
