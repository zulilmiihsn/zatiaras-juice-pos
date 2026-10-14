import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST, PATCH } from '../routes/api/buku-kas/+server';
import { createTestD1 } from './helpers/testD1';
import { normalizeCost } from '$lib/utils/currency';
import {
	LedgerValidationError,
	validateLedgerNominal,
	validateManualLedgerPatch,
	validateManualLedgerRows
} from '$lib/server/ledgerValidation';

function validRow(overrides: Record<string, unknown> = {}) {
	return {
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		sumber: 'catat',
		nominal: 100000,
		waktu: '2026-10-05T00:00:00.000Z',
		metode_bayar: 'tunai',
		deskripsi: 'Setoran modal',
		...overrides
	};
}

function rejects(_fn: () => unknown, _pattern: RegExp) {
	assert.throws(
		_fn,
		(e: unknown) =>
			e instanceof LedgerValidationError && e.status === 400 && _pattern.test(e.message)
	);
}

// Nominal invalid ditolak — tidak pernah dikoersi menjadi 0.
rejects(() => validateManualLedgerRows([validRow({ nominal: 'not-a-number' })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: -5000 })]), /negatif/);
rejects(() => validateManualLedgerRows([validRow({ nominal: Number.NaN })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: Infinity })]), /Nominal/);
rejects(() => validateManualLedgerRows([validRow({ nominal: undefined })]), /Nominal/);

// JSON garbage tidak boleh menjadi uang melalui Number(value), termasuk pada PATCH.
for (const nominal of [true, false, '   ', '\t\n', [], [1000], {}, '0x10', 'Infinity', null]) {
	rejects(() => validateLedgerNominal(nominal), /Nominal/);
	rejects(() => validateManualLedgerRows([validRow(), validRow({ nominal })]), /Nominal/);
	rejects(
		() => validateManualLedgerPatch({ nominal }, { tipe: 'in', jenis: 'pendapatan_usaha' }),
		/Nominal/
	);
}
// Jangan mengeksekusi coercion hook dari object tak tepercaya.
rejects(
	() =>
		validateLedgerNominal({ valueOf: () => assert.fail('Object nominal tidak boleh dikoersi') }),
	/Nominal/
);

// Seluruh batch divalidasi sebelum tulis: baris invalid di akhir menolak semua.
rejects(() => validateManualLedgerRows([validRow(), validRow({ nominal: 'rusak' })]), /Nominal/);

// Desimal rupiah tidak tersimpan mentah: dibulatkan ke integer.
const rounded = validateManualLedgerRows([validRow({ nominal: 100000.123456 })]);
assert.equal(rounded[0].nominal, 100000);
assert.equal(validateLedgerNominal('25000'), 25000);
assert.equal(validateLedgerNominal(' 25000.6 '), 25001);
assert.equal(validateLedgerNominal('1e3'), 1000);
assert.equal(validateLedgerNominal(0), 0);
assert.equal(validateLedgerNominal(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
rejects(() => validateLedgerNominal(Number.MAX_SAFE_INTEGER + 1), /batas aman/);

// Domain enum ditolak.
rejects(() => validateManualLedgerRows([validRow({ tipe: 'credit' })]), /Tipe/);
rejects(() => validateManualLedgerRows([validRow({ jenis: 'modal' })]), /Jenis/);
rejects(() => validateManualLedgerRows([validRow({ sumber: 'lain' })]), /Sumber/);
rejects(() => validateManualLedgerRows([validRow({ metode_bayar: 'transfer' })]), /Metode/);
rejects(() => validateManualLedgerRows([validRow({ waktu: 'not-a-date' })]), /Waktu/);
rejects(() => validateManualLedgerRows([validRow({ deskripsi: '   ' })]), /Deskripsi/);

// Pairing tipe/jenis: modal bukan usaha, prive bukan beban.
rejects(
	() => validateManualLedgerRows([validRow({ tipe: 'in', jenis: 'beban_usaha' })]),
	/tidak cocok/
);
rejects(
	() => validateManualLedgerRows([validRow({ tipe: 'out', jenis: 'pendapatan_usaha' })]),
	/tidak cocok/
);

// Jalur sah: catat + kulakan stok, qris dinormalisasi non-tunai.
const ok = validateManualLedgerRows([
	validRow(),
	validRow({
		tipe: 'out',
		jenis: 'beban_usaha',
		sumber: 'stok',
		nominal: 20000,
		metode_bayar: 'qris',
		deskripsi: 'Kulakan gula'
	})
]);
assert.equal(ok.length, 2);
assert.equal(ok[1].nominal, 20000);
assert.equal(ok[1].metode_bayar, 'non-tunai');

// PATCH parsial: nominal/waktu divalidasi, pairing dicek lawan nilai kini.
const patched = validateManualLedgerPatch(
	{ nominal: 75000.6 },
	{ tipe: 'out', jenis: 'beban_usaha' }
);
assert.equal(patched.nominal, 75001);
assert.throws(
	() =>
		validateManualLedgerPatch({ jenis: 'pendapatan_usaha' }, { tipe: 'out', jenis: 'beban_usaha' }),
	(e: unknown) => e instanceof LedgerValidationError
);
assert.throws(
	() => validateManualLedgerPatch({ sumber: 'pos' }, { tipe: 'in', jenis: 'pendapatan_usaha' }),
	(e: unknown) => e instanceof LedgerValidationError
);

// Range/sign must be checked on a decimal string before IEEE-754 can hide its violation.
await test('decimal string range/sign cannot round invalid source into a valid boundary', () => {
	for (const nominal of ['-1e-999', '-0.0000000000000000001e-999'])
		rejects(() => validateLedgerNominal(nominal), /negatif/);
	for (const nominal of ['9007199254740991.1', '9.0071992547409911e15'])
		rejects(() => validateLedgerNominal(nominal), /batas aman/);
	for (const nominal of ['9007199254740991', '9.007199254740991e15'])
		assert.equal(validateLedgerNominal(nominal), Number.MAX_SAFE_INTEGER);
	assert.equal(validateLedgerNominal('-0e99'), 0);
	assert.equal(normalizeCost(6000.0625), 6000.0625);
});

const { db, close } = await createTestD1();
const platform = {
	env: { DB_SAMARINDA_GROUP: db, DB_BALIKPAPAN_GROUP: db, DB_BERAU_GROUP: db }
} as unknown as App.Platform;
const session = {
	id: 'samarinda:ledger-validation-owner',
	branch: 'samarinda',
	userId: 'ledger-validation-owner',
	username: 'owner',
	role: 'pemilik',
	expiresAt: 4102444800000
};
const hasStatus = (expected: number) => (error: unknown) =>
	Boolean(error && typeof error === 'object' && 'status' in error && error.status === expected);
async function snapshot() {
	const values: Record<string, unknown> = {};
	for (const table of ['buku_kas', 'audit_logs', 'audit_log_outbox', 'ringkasan_penjualan_harian'])
		values[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
	return JSON.parse(JSON.stringify(values));
}
async function write(method: 'POST' | 'PATCH', body: unknown, role: string | null = 'pemilik') {
	const handler = method === 'POST' ? POST : PATCH;
	return handler({
		request: new Request('http://owned.invalid/api/buku-kas', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		platform,
		locals: { authSession: role === null ? null : { ...session, role } }
	} as unknown as Parameters<typeof POST>[0]);
}
try {
	await test('POST malformed/null row at batch tail is400, not500, without any ledger/effect write', async () => {
		for (const payload of [[validRow({ id: 'shape-head' }), null], [[]], [true], 'garbage']) {
			const before = await snapshot();
			await assert.rejects(write('POST', { payload }), hasStatus(400));
			assert.deepEqual(await snapshot(), before);
		}
	});
	await test('known conflicting row branch rejects whole POST/PATCH; absent legacy metadata remains allowed', async () => {
		const before = await snapshot();
		for (const field of ['cabang_id', 'branch']) {
			await assert.rejects(
				write('POST', {
					branch: 'samarinda',
					payload: [
						validRow({ id: 'scope-head' }),
						validRow({ id: 'scope-tail', [field]: 'berau' })
					]
				}),
				hasStatus(403)
			);
		}
		assert.deepEqual(await snapshot(), before);
	});
	await test('all invalid monetary/domain inputs reject the complete HTTP handler batch', async () => {
		const invalid: Record<string, unknown>[] = [
			...[
				null,
				true,
				false,
				[],
				[1000],
				{},
				'',
				' ',
				'not-a-number',
				'0x10',
				'Infinity',
				-1,
				Number.MAX_SAFE_INTEGER + 1,
				'-1e-999',
				'9007199254740991.1'
			].map((nominal) => ({ nominal })),
			{ tipe: 'credit' },
			{ jenis: 'modal' },
			{ tipe: 'out', jenis: 'pendapatan_usaha' },
			{ sumber: 'unknown' },
			{ waktu: 'not-a-date' },
			{ waktu: null },
			{ metode_bayar: 'transfer' },
			{ deskripsi: '' }
		];
		for (const bad of invalid) {
			const before = await snapshot();
			await assert.rejects(
				write('POST', {
					payload: [validRow({ id: 'invalid-head' }), validRow({ id: 'invalid-tail', ...bad })]
				}),
				hasStatus(400)
			);
			assert.deepEqual(await snapshot(), before);
		}
	});
	await test('fresh/legacy string replay acknowledgements and stored money are canonical, qris becomes non-tunai', async () => {
		const row = validRow({ id: 'canonical', nominal: '100000.123456', metode_bayar: 'qris' });
		for (let attempt = 0; attempt < 2; attempt++) {
			const response = await write('POST', { payload: row });
			assert.equal(response.status, 200);
			const result = await response.json();
			assert.equal(result.data[0].nominal, 100000);
			assert.equal(result.data[0].metode_bayar, 'non-tunai');
			assert.equal(result.duplicate === true, attempt === 1);
		}
		const stored = await db
			.prepare(
				"SELECT nominal,metode_bayar FROM buku_kas WHERE id='canonical' AND cabang_id='samarinda'"
			)
			.first();
		assert.deepEqual({ ...stored }, { nominal: 100000, metode_bayar: 'non-tunai' });
		assert.equal(
			(
				await db
					.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE id='canonical'")
					.first<{ n: number }>()
			)?.n,
			1
		);
	});
	await test('PATCH invalid domain and known scope conflicts cannot bypass canonical validation or revision', async () => {
		await db
			.prepare(
				"INSERT INTO buku_kas(id,cabang_id,tipe,jenis,sumber,nominal,waktu,metode_bayar,deskripsi) VALUES('patch-domain','samarinda','out','beban_usaha','catat',1000,'2026-10-05T00:00:00.000Z','tunai','Awal')"
			)
			.run();
		for (const payload of [
			{ nominal: false },
			{ nominal: '-1e-999' },
			{ jenis: 'pendapatan_usaha' },
			{ sumber: 'invalid' },
			{ waktu: false },
			{ deskripsi: null }
		]) {
			const before = await snapshot();
			await assert.rejects(
				write('PATCH', { where: { id: 'patch-domain' }, payload: { revision: 0, ...payload } }),
				hasStatus(400)
			);
			assert.deepEqual(await snapshot(), before);
		}
		for (const field of ['cabang_id', 'branch']) {
			const before = await snapshot();
			await assert.rejects(
				write('PATCH', {
					where: { id: 'patch-domain' },
					payload: { revision: 0, nominal: 500, [field]: 'berau' }
				}),
				hasStatus(403)
			);
			assert.deepEqual(await snapshot(), before);
		}
		assert.equal(
			(
				await write('PATCH', {
					where: { id: 'patch-domain' },
					payload: { revision: 0, nominal: '25000.6' }
				})
			).status,
			200
		);
		assert.deepEqual(
			{
				...(await db
					.prepare("SELECT nominal,revision FROM buku_kas WHERE id='patch-domain'")
					.first())
			},
			{ nominal: 25001, revision: 1 }
		);
	});
	await test('unauthorized and conflicting top-level branch never write; POS cannot use manual insert', async () => {
		const before = await snapshot();
		await assert.rejects(write('POST', { payload: validRow() }, null), hasStatus(401));
		await assert.rejects(write('POST', { branch: 'berau', payload: validRow() }), hasStatus(403));
		await assert.rejects(
			write(
				'PATCH',
				{ where: { id: 'patch-domain' }, payload: { revision: 1, nominal: 500 } },
				'kasir'
			),
			hasStatus(403)
		);
		await assert.rejects(write('POST', { payload: validRow({ sumber: 'pos' }) }), hasStatus(409));
		assert.deepEqual(await snapshot(), before);
	});
	await test('late INSERT failure is one-statement rollback, not committed first row', async () => {
		await db
			.prepare(
				"CREATE TRIGGER owned_ledger_tail_fault BEFORE INSERT ON buku_kas WHEN NEW.id='fault-tail' BEGIN SELECT RAISE(ABORT,'OWNED_LEDGER_TAIL_FAULT'); END"
			)
			.run();
		const before = await snapshot();
		await assert.rejects(
			write('POST', { payload: [validRow({ id: 'fault-head' }), validRow({ id: 'fault-tail' })] }),
			(error: unknown) => {
				let current = error;
				for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
					if (current.message.includes('OWNED_LEDGER_TAIL_FAULT')) return true;
					current = current.cause;
				}
				return false;
			}
		);
		assert.deepEqual(await snapshot(), before);
		await db.prepare('DROP TRIGGER owned_ledger_tail_fault').run();
	});
} finally {
	await close();
}
console.log(
	'ledger-validation: decoder + actual handler/batch/canonical replay/branch/domain/failure assertions passed'
);
