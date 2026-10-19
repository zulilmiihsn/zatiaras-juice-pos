import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
	computeTransactionFingerprint,
	type TransactionFingerprintInput
} from '../lib/server/checkout/fingerprint';
import {
	decodeDecimalNumber,
	decodeMoneyAmount,
	normalizeMoney,
	normalizeCost,
	roundMoney
} from '../lib/utils/currency';

type Fingerprint = (input: TransactionFingerprintInput) => string;

function intent(): TransactionFingerprintInput {
	return {
		branch: 'samarinda',
		storeSessionId: 'shift-1',
		cashReceived: 30000,
		totalAmount: 24000,
		totalQty: 2,
		paymentMethod: 'tunai',
		customerName: 'Ayu',
		items: [
			{
				product_id: 'produk-1',
				jumlah: 2,
				porsi: 'reguler',
				add_on_ids: ['tambahan-2', 1],
				product_price_token: 'opaque-product-token',
				add_on_price_tokens: ['opaque-addon-2', 'opaque-addon-1'],
				gula: 'normal',
				es: 'normal',
				catatan: 'Tanpa sedotan'
			}
		]
	};
}

function assertFingerprintContract(fingerprint: Fingerprint): void {
	const base = intent();
	const expected = fingerprint(base);
	assert.match(expected, /^[a-f0-9]{64}$/);
	const equivalent = structuredClone(base);
	equivalent.paymentMethod = 'TUNAI';
	equivalent.customerName = '  Ayu  ';
	equivalent.cashReceived = '30000';
	equivalent.items[0].add_on_ids = ['1', 'tambahan-2'];
	equivalent.items[0].add_on_price_tokens?.reverse();
	assert.equal(fingerprint(equivalent), expected, 'order add-on dan format ekuivalen harus stabil');
	const changes: Array<[string, (input: TransactionFingerprintInput) => void]> = [
		[
			'branch',
			(i) => {
				i.branch = 'berau';
			}
		],
		[
			'session',
			(i) => {
				i.storeSessionId = 'shift-2';
			}
		],
		[
			'cash',
			(i) => {
				i.cashReceived = 31000;
			}
		],
		[
			'total',
			(i) => {
				i.totalAmount = 25000;
			}
		],
		[
			'quantity',
			(i) => {
				i.totalQty = 3;
			}
		],
		[
			'payment',
			(i) => {
				i.paymentMethod = 'non-tunai';
			}
		],
		[
			'customer',
			(i) => {
				i.customerName = 'Lina';
			}
		],
		[
			'product',
			(i) => {
				i.items[0].product_id = 'produk-2';
			}
		],
		[
			'item quantity',
			(i) => {
				i.items[0].jumlah = 3;
			}
		],
		[
			'portion',
			(i) => {
				i.items[0].porsi = 'jumbo';
			}
		],
		[
			'add-on',
			(i) => {
				i.items[0].add_on_ids = ['tambahan-2'];
			}
		],
		[
			'product token',
			(i) => {
				i.items[0].product_price_token = 'different-product-token';
			}
		],
		[
			'add-on token',
			(i) => {
				i.items[0].add_on_price_tokens = ['different-addon-token'];
			}
		],
		[
			'sugar',
			(i) => {
				i.items[0].gula = 'sedikit';
			}
		],
		[
			'ice',
			(i) => {
				i.items[0].es = 'sedikit';
			}
		],
		[
			'note',
			(i) => {
				i.items[0].catatan = 'Es dipisah';
			}
		]
	];
	for (const [name, change] of changes) {
		const changed = structuredClone(base);
		change(changed);
		assert.notEqual(fingerprint(changed), expected, `${name} harus mengubah identitas intent`);
	}
}

await test('idempotency fingerprint preserves equivalent intent and distinguishes every business field', () => {
	assertFingerprintContract(computeTransactionFingerprint);
});

await test('custom-name aliases and absent optional fields have canonical identities', () => {
	const custom = intent();
	custom.items = [{ jumlah: 1, custom_name: '  Jus Kombinasi  ', custom_price: '15000' }];
	const canonical = structuredClone(custom);
	canonical.items = [
		{
			jumlah: 1,
			nama_kustom: 'Jus Kombinasi',
			custom_price: 15000,
			porsi: 'reguler',
			add_on_ids: [],
			add_on_price_tokens: []
		}
	];
	assert.equal(computeTransactionFingerprint(custom), computeTransactionFingerprint(canonical));
	canonical.items[0].custom_price = 16000;
	assert.notEqual(computeTransactionFingerprint(custom), computeTransactionFingerprint(canonical));
	const absent = { branch: 'samarinda', items: [], totalAmount: 0, totalQty: 0, paymentMethod: '' };
	assert.equal(
		computeTransactionFingerprint(absent),
		computeTransactionFingerprint({
			...absent,
			storeSessionId: null,
			cashReceived: null,
			customerName: ''
		})
	);
});

await test('money decoder rejects coercion, negative underflow, and exact maximum overflow before rounding', () => {
	for (const value of [
		null,
		undefined,
		true,
		false,
		[],
		[1],
		{},
		'',
		' ',
		'0x10',
		'Infinity',
		'NaN',
		'Rp 1.000',
		'1,000',
		Number.NaN,
		Number.POSITIVE_INFINITY
	]) {
		assert.deepEqual(decodeMoneyAmount(value), { ok: false, reason: 'invalid' }, String(value));
		assert.equal(decodeDecimalNumber(value), null, String(value));
	}
	for (const value of [-1, '-0.01', '-1e-999'])
		assert.deepEqual(decodeMoneyAmount(value), { ok: false, reason: 'negative' });
	for (const value of [
		Number.MAX_SAFE_INTEGER + 1,
		'9007199254740992',
		'9007199254740991.000000000000000001',
		'9.0071992547409910001e15'
	])
		assert.deepEqual(decodeMoneyAmount(value), { ok: false, reason: 'unsafe' });
	for (const [value, expected] of [
		[0, 0],
		['-0', 0],
		['+15.5', 15.5],
		['1e3', 1000],
		['9007199254740991', Number.MAX_SAFE_INTEGER]
	] as const)
		assert.deepEqual(decodeMoneyAmount(value), { ok: true, amount: expected });
	assert.equal(normalizeMoney(15000.49), 15000);
	assert.equal(normalizeMoney(15000.5), 15001);
	assert.equal(normalizeCost(1.23456), 1.2346);
	assert.equal(roundMoney(1.234), 1.23);
	for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(normalizeMoney(value), 0);
		assert.equal(normalizeCost(value), 0);
	}
});

await test('fingerprint assertions kill source mutants that erase branch, cash, payment, or receipt intent', async () => {
	const { transpileModule, ModuleKind, ScriptTarget } = await import('typescript');
	const source = readFileSync(
		new URL('../lib/server/checkout/fingerprint.ts', import.meta.url),
		'utf8'
	);
	const mutants: Array<[string, string, string]> = [
		['branch', "b: String(params.branch || '')", "b: 'same-branch'"],
		[
			'cash',
			'cash: params.cashReceived != null ? Math.round(Number(params.cashReceived)) : null',
			'cash: null'
		],
		['payment', "pay: String(params.paymentMethod || '').toLowerCase()", "pay: 'tunai'"],
		[
			'customer',
			'cust: params.customerName ? String(params.customerName).trim() : null',
			'cust: null'
		],
		['note', 'c: i.catatan || null', 'c: null'],
		['product', 'p: i.product_id ? String(i.product_id) : null', 'p: null']
	];
	const parent = realpathSync.native(tmpdir());
	const directory = mkdtempSync(join(parent, 'zatiaras-policy-mutants-'));
	try {
		assertFingerprintContract(computeTransactionFingerprint);
		for (const [name, before, after] of mutants) {
			assert.equal(source.split(before).length, 2, `mutator ${name} harus tepat satu lokasi`);
			const { outputText } = transpileModule(source.replace(before, after), {
				compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
			});
			const file = join(directory, `${name}.mjs`);
			writeFileSync(file, outputText);
			const module = (await import(pathToFileURL(file).href)) as {
				computeTransactionFingerprint: Fingerprint;
			};
			assert.equal(typeof module.computeTransactionFingerprint, 'function');
			assert.throws(
				() => assertFingerprintContract(module.computeTransactionFingerprint),
				assert.AssertionError,
				`mutant ${name} tidak boleh lolos`
			);
		}
	} finally {
		const target = realpathSync.native(directory);
		assert.equal(dirname(target), parent, 'Unexpected mutation fixture cleanup parent');
		assert.match(
			basename(target),
			/^zatiaras-policy-mutants-/,
			'Unexpected mutation fixture cleanup directory'
		);
		rmSync(target, { recursive: true, force: true });
	}
});
