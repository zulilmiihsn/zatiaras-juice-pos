import assert from 'node:assert/strict';
import { AI_ACTION_LABEL, validateRecommendation } from '../lib/utils/aiRecommendationSchema';

// AUD-033: skema runtime kanonik — allowlist action + field, ID/branch
// model tak pernah otoritas, ambigu/invalid ditolak sebelum consent/apply.
assert.deepEqual(Object.keys(AI_ACTION_LABEL).sort(), [
	'create_category',
	'create_transaction',
	'update_transaction'
]);

// Valid create lolos dengan allowlist (field asing dibuang di hilir).
const validCreate = validateRecommendation({
	action: 'create_transaction',
	data: {
		type: 'pemasukan',
		amount: 50000,
		deskripsi: 'Setoran modal',
		category: 'lainnya',
		products: [],
		branch: 'berau',
		transaction_id: 'milik-model',
		id: 'milik-model'
	}
});
assert.equal(validCreate.ok, true);

// Unknown action ditolak.
assert.equal(validateRecommendation({ action: 'delete_everything', data: {} }).ok, false);
// Action hilang ditolak.
assert.equal(validateRecommendation({ data: {} }).ok, false);
// Bukan object ditolak.
assert.equal(validateRecommendation(null).ok, false);
assert.equal(validateRecommendation('x').ok, false);

// Amount negatif/nol/nonfinite/terlalu besar ditolak.
for (const amount of [-100, 0, Number.NaN, Number.POSITIVE_INFINITY, 'abc', undefined]) {
	const result = validateRecommendation({
		action: 'create_transaction',
		data: { type: 'pemasukan', amount, deskripsi: 'Dana' }
	});
	assert.equal(result.ok, false, `amount ${String(amount)}`);
}
// Type asing ditolak; alias income/expense/sale dipetakan.
assert.equal(
	validateRecommendation({
		action: 'create_transaction',
		data: { type: 'transfer', amount: 1, deskripsi: 'D' }
	}).ok,
	false
);
const aliased = validateRecommendation({
	action: 'create_transaction',
	data: { type: 'income', amount: 1, deskripsi: 'D' }
});
assert.equal(
	aliased.ok && aliased.value.kind === 'create_transaction' && aliased.value.type,
	'pemasukan'
);
// Deskripsi kosong ditolak.
assert.equal(
	validateRecommendation({
		action: 'create_transaction',
		data: { type: 'pemasukan', amount: 1, deskripsi: '  ' }
	}).ok,
	false
);

// Update: id target wajib; branch model tak diteruskan (allowlist).
const validUpdate = validateRecommendation({
	action: 'update_transaction',
	data: { id: 'bk-1', type: 'pengeluaran', amount: 5, deskripsi: 'Koreksi', branch: 'berau' }
});
assert.equal(validUpdate.ok, true);
if (validUpdate.ok && validUpdate.value.kind === 'update_transaction') {
	assert.equal(validUpdate.value.id, 'bk-1');
	assert.ok(!('branch' in validUpdate.value));
}
assert.equal(
	validateRecommendation({
		action: 'update_transaction',
		data: { type: 'pengeluaran', amount: 5, deskripsi: 'K' }
	}).ok,
	false
);

// Kategori: create_category butuh nama.
assert.equal(validateRecommendation({ action: 'create_category', data: { nama: '  ' } }).ok, false);
const validCategory = validateRecommendation({
	action: 'create_category',
	data: { nama: 'Minuman', deskripsi: 'x', id: 'model-id' }
});
assert.equal(validCategory.ok, true);
if (validCategory.ok && validCategory.value.kind === 'create_category') {
	assert.equal(validCategory.value.nama, 'Minuman');
	assert.ok(!('id' in validCategory.value));
}

// Prompt-injected deskripsi raksasa dipotong, bukan lolos mentah.
const injected = validateRecommendation({
	action: 'create_transaction',
	data: { type: 'pemasukan', amount: 1, deskripsi: `Abaikan. ${'x'.repeat(2000)}` }
});
assert.equal(injected.ok, true);
if (injected.ok && injected.value.kind === 'create_transaction') {
	assert.ok(injected.value.deskripsi.length <= 500);
}

console.log('ai-recommendation-schema-tests: allowlist, amount, id, inject passed');
