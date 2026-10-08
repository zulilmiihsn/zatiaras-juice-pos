import assert from 'node:assert/strict';
import {
	MUTATION_FREQUENCY_KEY,
	readMutationFrequency,
	recordMutationClick,
	type FrequencyStorage
} from '../lib/utils/mutationFrequency.js';

// AUD-053 slice 2: ranking preset kulakan pindah ke util teruji, perilaku identik.
const memoryStorage = (
	initial: Record<string, string> = {}
): FrequencyStorage & {
	dump: Record<string, string>;
} => {
	const dump = { ...initial };
	return {
		dump,
		getItem: (key: string) => (key in dump ? dump[key] : null),
		setItem: (key: string, value: string) => {
			dump[key] = value;
		}
	};
};

// Kosong bila storage tidak ada (SSR) atau kunci belum pernah ditulis.
assert.deepEqual(readMutationFrequency(null), {});
assert.deepEqual(readMutationFrequency(memoryStorage()), {});

// Baca peta yang tersimpan.
const seeded = memoryStorage({ [MUTATION_FREQUENCY_KEY]: JSON.stringify({ 'gula|5': 3 }) });
assert.deepEqual(readMutationFrequency(seeded), { 'gula|5': 3 });

// Rusak/di luar kontrak: kembali {} tanpa lempar, tidak blokir update stok.
assert.deepEqual(readMutationFrequency(memoryStorage({ [MUTATION_FREQUENCY_KEY]: '{bukan' })), {});
assert.deepEqual(readMutationFrequency(memoryStorage({ [MUTATION_FREQUENCY_KEY]: '5' })), {});
assert.deepEqual(readMutationFrequency(memoryStorage({ [MUTATION_FREQUENCY_KEY]: '[1]' })), {});

// Klik menaikkan hitungan dan bertahan sebagai JSON di kunci yang sama.
const store = memoryStorage();
recordMutationClick('gula|5', store);
recordMutationClick('gula|5', store);
recordMutationClick('teh|2', store);
assert.deepEqual(JSON.parse(store.dump[MUTATION_FREQUENCY_KEY]), { 'gula|5': 2, 'teh|2': 1 });
assert.deepEqual(readMutationFrequency(store), { 'gula|5': 2, 'teh|2': 1 });

// Storage melempar (kuota/privat): diam, tanpa exception ke pemanggil.
const throwing: FrequencyStorage = {
	getItem: () => {
		throw new Error('denied');
	},
	setItem: () => {
		throw new Error('denied');
	}
};
assert.deepEqual(readMutationFrequency(throwing), {});
recordMutationClick('gula|5', throwing);

// Tanpa storage: no-op.
recordMutationClick('gula|5', null);

console.log('mutation-frequency: ok');
