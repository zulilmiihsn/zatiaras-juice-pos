import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { branchContext } from '../lib/server/branchResolver';
import { executePurchase, PurchaseUseCaseError } from '../lib/server/purchaseUseCase';
import { POST as PURCHASE } from '../routes/api/bahan/purchase/+server';
import { createTestD1 } from './helpers/testD1';

// Perintah kulakan atomik (AUD-006): satu batch untuk mutasi + kas + HPP,
// idempoten via operation_key, ikut stock policy.

const { db, close } = await createTestD1();
const branch = branchContext('berau');
const session = {
	id: 'session-pemilik-berau',
	userId: 'pemilik-1',
	username: 'pemilik',
	role: 'pemilik',
	branch: 'berau',
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [],
	unlockExpiresAt: 0
};

const bahanIds: string[] = [];
const mutasiIds: string[] = [];
const kasIds: string[] = [];

async function count(table: string, extra = '', ...args: (string | number | null)[]) {
	const row = (await db
		.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id = ? ${extra}`)
		.bind('berau', ...args)
		.first()) as { n?: number } | null;
	return Number(row?.n ?? 0);
}

async function seedBahan(stock: number) {
	const id = `bahan-${randomUUID()}`;
	await db
		.prepare(
			`INSERT INTO bahan (id, cabang_id, nama, satuan, tipe_satuan, isi_per_kemasan,
				satuan_beli, kategori, stok_saat_ini, ambang_stok, yield_persen,
				biaya_per_satuan, jumlah_beli_terakhir, biaya_beli_terakhir)
			 VALUES (?, 'berau', 'Gula', 'gram', 'berat', 1000, 'kg', 'Bahan Baku', ?, 0, 100, 0, 0, 0)`
		)
		.bind(id, stock)
		.run();
	bahanIds.push(id);
	return id;
}

async function stockOf(bahanId: string) {
	const row = (await db
		.prepare(`SELECT stok_saat_ini AS s FROM bahan WHERE cabang_id = 'berau' AND id = ?`)
		.bind(bahanId)
		.first()) as { s?: number } | null;
	return row?.s;
}

function baseInput(bahanId: string, operationKey: string) {
	return {
		bahan_id: bahanId,
		arah: 'tambah' as const,
		jumlah: 1,
		satuan: 'kg',
		catatan: 'Kulakan 1 kg',
		operation_key: operationKey,
		kas: {
			nominal: 20000,
			metode_bayar: 'tunai',
			jenis: 'beban_usaha',
			deskripsi: 'Kulakan gula'
		},
		update_hpp: true
	};
}

async function expectStatus(run: () => unknown, status: number) {
	await assert.rejects(
		async () => run(),
		(error: unknown) => error instanceof PurchaseUseCaseError && error.status === status
	);
}

function track(result: { mutasi_id: string; kas_id: string | null }) {
	mutasiIds.push(result.mutasi_id);
	if (result.kas_id) kasIds.push(result.kas_id);
}

try {
	// 1. Sukses: 100 -> 1100, kas 20000, HPP 20/gram, stok_setelah benar.
	const bahan1 = await seedBahan(100);
	const key1 = randomUUID();
	const first = await executePurchase(db, branch, session, undefined, baseInput(bahan1, key1));
	track(first);
	assert.equal(first.ok, true);
	assert.equal(first.duplicate, false);
	assert.equal(first.stok_setelah, 1100);
	assert.ok(first.kas_id);
	assert.equal(await stockOf(bahan1), 1100);
	const hpp1 = (await db
		.prepare(
			`SELECT biaya_per_satuan AS h, jumlah_beli_terakhir AS j, biaya_beli_terakhir AS b
			 FROM bahan WHERE cabang_id = 'berau' AND id = ?`
		)
		.bind(bahan1)
		.first()) as { h?: number; j?: number; b?: number } | null;
	assert.equal(hpp1?.h, 20);
	assert.equal(hpp1?.j, 1000);
	assert.equal(hpp1?.b, 20000);
	const mutasi1 = (await db
		.prepare(
			`SELECT delta_jumlah AS d, stok_setelah AS s, operation_key AS k, referensi_id AS r
			 FROM bahan_mutasi WHERE cabang_id = 'berau' AND id = ?`
		)
		.bind(first.mutasi_id)
		.first()) as { d?: number; s?: number; k?: string; r?: string } | null;
	assert.equal(mutasi1?.d, 1000);
	assert.equal(mutasi1?.s, 1100);
	assert.equal(mutasi1?.k, key1);
	assert.equal(mutasi1?.r, first.kas_id);

	// 2. Retry kunci sama: idempoten, tanpa mutasi bisnis kedua.
	const counts = { m: await count('bahan_mutasi'), k: await count('buku_kas') };
	const retry = await executePurchase(db, branch, session, undefined, baseInput(bahan1, key1));
	assert.equal(retry.duplicate, true);
	assert.equal(retry.mutasi_id, first.mutasi_id);
	assert.equal(await count('bahan_mutasi'), counts.m);
	assert.equal(await count('buku_kas'), counts.k);
	assert.equal(await stockOf(bahan1), 1100);

	// Key mengikat seluruh immutable intent, bukan hanya mencegah insert kedua.
	for (const changed of [
		{ jumlah: 2 },
		{ arah: 'kurang', update_hpp: false },
		{ satuan: 'gram' },
		{ catatan: 'Niat berbeda' },
		{ kas: { ...baseInput(bahan1, key1).kas, nominal: 99999 } },
		{ kas: { ...baseInput(bahan1, key1).kas, metode_bayar: 'non-tunai' } },
		{ kas: { ...baseInput(bahan1, key1).kas, jenis: 'lainnya' } },
		{ kas: { ...baseInput(bahan1, key1).kas, deskripsi: 'Kas berbeda' } },
		{ kas: null },
		{ update_hpp: false },
		{ hpp: { jumlah_beli: 1000, biaya_beli: 30000 } }
	]) {
		await expectStatus(
			() =>
				executePurchase(db, branch, session, undefined, { ...baseInput(bahan1, key1), ...changed }),
			409
		);
	}
	assert.equal(await count('bahan_mutasi'), counts.m);
	assert.equal(await count('buku_kas'), counts.k);
	assert.equal(await stockOf(bahan1), 1100);
	assert.equal(retry.delta_jumlah, first.delta_jumlah);
	assert.equal(retry.stok_setelah, first.stok_setelah);
	assert.equal(retry.kas_id, first.kas_id);

	// Replay sah memakai snapshot commit meski unit/yield/policy katalog berubah.
	await db
		.prepare(
			"UPDATE bahan SET satuan = 'pcs', yield_persen = 50 WHERE cabang_id = 'berau' AND id = ?"
		)
		.bind(bahan1)
		.run();
	const replayAfterEdit = await executePurchase(
		db,
		branch,
		session,
		undefined,
		baseInput(bahan1, key1)
	);
	assert.equal(replayAfterEdit.duplicate, true);
	assert.equal(replayAfterEdit.delta_jumlah, first.delta_jumlah);
	assert.equal(replayAfterEdit.stok_setelah, first.stok_setelah);

	// 3. Kirim ganda bersamaan kunci sama: tepat satu kulakan.
	const bahan3 = await seedBahan(50);
	const key3 = randomUUID();
	const [a, b] = await Promise.all([
		executePurchase(db, branch, session, undefined, baseInput(bahan3, key3)),
		executePurchase(db, branch, session, undefined, baseInput(bahan3, key3))
	]);
	track(a.duplicate ? b : a);
	assert.notEqual(a.duplicate, b.duplicate);
	assert.equal(await count('bahan_mutasi', 'AND operation_key = ?', key3), 1);
	assert.equal(await count('buku_kas', 'AND idempotency_key = ?', `purchase:${key3}`), 1);

	// 4. Kas tahap gagal (jenis invalid): rollback utuh — stok/kas/mutasi tak berubah.
	const bahan4 = await seedBahan(100);
	const before4 = { m: await count('bahan_mutasi'), k: await count('buku_kas') };
	await expectStatus(
		() =>
			executePurchase(db, branch, session, undefined, {
				...baseInput(bahan4, randomUUID()),
				kas: { nominal: 503, metode_bayar: 'tunai', jenis: 'modal', deskripsi: 'x' }
			}),
		400
	);
	assert.equal(await count('bahan_mutasi'), before4.m);
	assert.equal(await count('buku_kas'), before4.k);
	assert.equal(await stockOf(bahan4), 100);

	// Nominal cash invalid tidak boleh berubah diam-diam menjadi purchase tanpa kas.
	for (const nominal of ['not-a-number', Infinity, Number.NaN, true, [], '   ', null]) {
		await expectStatus(
			() =>
				executePurchase(db, branch, session, undefined, {
					...baseInput(bahan4, randomUUID()),
					kas: { ...baseInput(bahan4, key1).kas, nominal }
				}),
			400
		);
	}
	assert.equal(await stockOf(bahan4), 100);
	assert.equal(await count('bahan_mutasi'), before4.m);
	assert.equal(await count('buku_kas'), before4.k);

	// 5. Satuan tak dikenal / jumlah negatif: 400 tanpa mutasi.
	const bahan5 = await seedBahan(100);
	await expectStatus(
		() =>
			executePurchase(db, branch, session, undefined, {
				...baseInput(bahan5, randomUUID()),
				satuan: 'leng'
			}),
		400
	);
	await expectStatus(
		() =>
			executePurchase(db, branch, session, undefined, {
				...baseInput(bahan5, randomUUID()),
				jumlah: -2
			}),
		400
	);
	assert.equal(await count('bahan_mutasi'), before4.m);

	// 6a. HPP eksplisit tanpa kas (jalur parse belanja): mutasi + HPP satu batch.
	const bahan6a = await seedBahan(0);
	const hppOnly = await executePurchase(db, branch, session, undefined, {
		bahan_id: bahan6a,
		arah: 'tambah' as const,
		jumlah: 500,
		satuan: 'gram',
		catatan: 'Belanja Rp 10000',
		operation_key: randomUUID(),
		kas: null,
		update_hpp: false,
		hpp: { jumlah_beli: 500, biaya_beli: 10000 }
	});
	track(hppOnly);
	assert.equal(hppOnly.kas_id, null);
	assert.equal(await stockOf(bahan6a), 500);
	const hpp6a = (await db
		.prepare(
			`SELECT biaya_per_satuan AS h, jumlah_beli_terakhir AS j FROM bahan WHERE cabang_id = 'berau' AND id = ?`
		)
		.bind(bahan6a)
		.first()) as { h?: number; j?: number } | null;
	assert.equal(hpp6a?.j, 500);
	assert.equal(hpp6a?.h, 20);

	// 6. Kurang tanpa kas: stok turun, tanpa baris kas.
	const bahan6 = await seedBahan(500);
	const out = await executePurchase(db, branch, session, undefined, {
		bahan_id: bahan6,
		arah: 'kurang' as const,
		jumlah: 200,
		satuan: 'gram',
		catatan: 'Rusak',
		operation_key: randomUUID(),
		kas: null,
		update_hpp: false
	});
	track(out);
	assert.equal(out.duplicate, false);
	assert.equal(out.kas_id, null);
	assert.equal(out.stok_setelah, 300);

	// Same-key/different-intent race: satu commit, loser 409 dan seluruh efek loser rollback.
	const raceBahan = await seedBahan(100);
	const raceKey = randomUUID();
	const race = await Promise.allSettled([
		executePurchase(db, branch, session, undefined, baseInput(raceBahan, raceKey)),
		executePurchase(db, branch, session, undefined, { ...baseInput(raceBahan, raceKey), jumlah: 2 })
	]);
	const won = race.filter((r) => r.status === 'fulfilled');
	const lost = race.filter((r) => r.status === 'rejected');
	assert.equal(won.length, 1);
	assert.equal(lost.length, 1);
	assert.ok(lost[0].reason instanceof PurchaseUseCaseError);
	assert.equal(lost[0].reason.status, 409);
	track(won[0].value);
	assert.equal(await stockOf(raceBahan), 100 + won[0].value.delta_jumlah);
	assert.equal(await count('bahan_mutasi', 'AND operation_key = ?', raceKey), 1);
	assert.equal(await count('buku_kas', 'AND idempotency_key = ?', `purchase:${raceKey}`), 1);

	// Failure sesudah stock/HPP/movement di SQL batch harus rollback semua.
	const failBahan = await seedBahan(100);
	const failKey = 'purchase-regression-failure';
	const beforeFailure = { m: await count('bahan_mutasi'), k: await count('buku_kas') };
	await db
		.prepare(
			`CREATE TRIGGER purchase_regression_failure BEFORE INSERT ON buku_kas
		WHEN NEW.cabang_id = 'berau' AND NEW.idempotency_key = 'purchase:${failKey}'
		BEGIN SELECT RAISE(ABORT, 'PURCHASE_TEST_FAILURE'); END`
		)
		.run();
	try {
		await assert.rejects(
			() => executePurchase(db, branch, session, undefined, baseInput(failBahan, failKey)),
			/PURCHASE_TEST_FAILURE/
		);
		assert.equal(await stockOf(failBahan), 100);
		assert.equal(await count('bahan_mutasi'), beforeFailure.m);
		assert.equal(await count('buku_kas'), beforeFailure.k);
		const unchanged = await db
			.prepare("SELECT biaya_per_satuan FROM bahan WHERE cabang_id = 'berau' AND id = ?")
			.bind(failBahan)
			.first('biaya_per_satuan');
		assert.equal(unchanged, 0);
	} finally {
		await db.prepare('DROP TRIGGER purchase_regression_failure').run();
	}
	track(await executePurchase(db, branch, session, undefined, baseInput(failBahan, failKey)));

	// Legacy key tanpa fingerprint tidak ditebak/backfill menjadi intent baru.
	const legacyBahan = await seedBahan(100);
	const legacyId = randomUUID();
	mutasiIds.push(legacyId);
	await db
		.prepare(
			`INSERT INTO bahan_mutasi(id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber, operation_key)
		VALUES (?, 'berau', ?, 100, 100, 'manual', 'legacy-purchase-key')`
		)
		.bind(legacyId, legacyBahan)
		.run();
	await expectStatus(
		() =>
			executePurchase(
				db,
				branch,
				session,
				undefined,
				baseInput(legacyBahan, 'legacy-purchase-key')
			),
		409
	);
	assert.equal(await stockOf(legacyBahan), 100);

	// 7. Mode ignored: 409, tanpa mutasi (ikut stock policy, bukan bypass).
	const bahan7 = await seedBahan(100);
	const hadPolicy = await db
		.prepare(`SELECT cabang_id FROM stock_policy WHERE cabang_id = 'berau' LIMIT 1`)
		.first();
	if (!hadPolicy) {
		await db
			.prepare(
				`INSERT INTO stock_policy (cabang_id, mode, revision, disabled_at, reconciled_at,
					updated_at, updated_by, updated_by_role, reconciliation_job_id)
				 VALUES ('berau', 'ignored', 1, '2026-10-05T00:00:00.000Z', NULL,
					'2026-10-05T00:00:00.000Z', 'pemilik', 'pemilik', NULL)`
			)
			.run();
	}
	try {
		await expectStatus(
			() => executePurchase(db, branch, session, undefined, baseInput(bahan7, randomUUID())),
			409
		);
	} finally {
		if (!hadPolicy) {
			await db.prepare(`DELETE FROM stock_policy WHERE cabang_id = 'berau'`).run();
		}
	}
	assert.equal(await stockOf(bahan7), 100);

	// Cash/HPP numeric legacy strings canonical; HPP satuan tetap empat desimal.
	const decimalBahan = await seedBahan(0);
	const decimalKey = randomUUID();
	const decimalIntent = {
		...baseInput(decimalBahan, decimalKey),
		jumlah: 3,
		satuan: 'gram',
		kas: { ...baseInput(decimalBahan, decimalKey).kas, nominal: '1.4', metode_bayar: 'qris' }
	};
	const decimalResult = await executePurchase(db, branch, session, undefined, decimalIntent);
	track(decimalResult);
	const canonicalReplay = await executePurchase(db, branch, session, undefined, {
		...decimalIntent,
		jumlah: '3',
		kas: { ...decimalIntent.kas, nominal: 1, metode_bayar: 'non-tunai' }
	});
	assert.equal(canonicalReplay.duplicate, true);
	assert.equal(
		await db
			.prepare("SELECT biaya_per_satuan FROM bahan WHERE cabang_id = 'berau' AND id = ?")
			.bind(decimalBahan)
			.first('biaya_per_satuan'),
		0.3333
	);

	// Cabang sibling dalam satu shard dapat memakai key sama tanpa data saling mengambil.
	const siblingKey = 'purchase-sibling-isolation';
	for (const tenant of ['samarinda', 'samarinda2'] as const) {
		const id = `${tenant}-purchase-isolation`;
		await db
			.prepare(
				"INSERT INTO bahan(id, cabang_id, nama, satuan, stok_saat_ini, yield_persen) VALUES (?, ?, 'Fixture', 'gram', 0, 100)"
			)
			.bind(id, tenant)
			.run();
		const result = await executePurchase(
			db,
			branchContext(tenant),
			{ ...session, branch: tenant },
			undefined,
			{
				...baseInput(id, siblingKey),
				jumlah: tenant === 'samarinda' ? 1 : 2,
				satuan: 'gram'
			}
		);
		assert.equal(result.duplicate, false);
		assert.equal(result.delta_jumlah, tenant === 'samarinda' ? 1 : 2);
	}
	const siblingRows = await db
		.prepare('SELECT cabang_id FROM bahan_mutasi WHERE operation_key = ? AND cabang_id IN (?, ?)')
		.bind(siblingKey, 'samarinda', 'samarinda2')
		.all();
	assert.equal(siblingRows.results.length, 2);

	// 8. Route: kasir/foreign branch ditolak 403, tanpa sesi 401 sebelum mutasi.
	const routeEvent = (role: string | null, requestBranch = 'berau') => ({
		request: new Request('https://test.invalid/api/bahan/purchase', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ branch: requestBranch, payload: baseInput(bahan7, randomUUID()) })
		}),
		locals: {
			authSession: role === null ? null : { ...session, role, userId: `${role}-1`, username: role }
		},
		platform: { env: { DB_SAMARINDA_GROUP: db, DB_BERAU_GROUP: db } }
	});
	await assert.rejects(
		// @ts-expect-error harness event minimal untuk guard peran
		() => PURCHASE(routeEvent('kasir')),
		(error: { status?: number }) => error.status === 403
	);
	const beforeRoute = { m: await count('bahan_mutasi'), k: await count('buku_kas') };
	await assert.rejects(
		// @ts-expect-error harness event minimal untuk guard sesi
		() => PURCHASE(routeEvent(null)),
		(error: { status?: number }) => error.status === 401
	);
	await assert.rejects(
		// @ts-expect-error harness event minimal untuk guard cabang
		() => PURCHASE(routeEvent('pemilik', 'samarinda')),
		(error: { status?: number }) => error.status === 403
	);
	await assert.rejects(
		// @ts-expect-error harness event minimal; admin tidak mendapat tenant purchase baru
		() => PURCHASE(routeEvent('admin', 'samarinda')),
		(error: { status?: number }) => error.status === 403
	);
	assert.equal(await count('bahan_mutasi'), beforeRoute.m);
	assert.equal(await count('buku_kas'), beforeRoute.k);
	// Permission admin existing pada cabang sesi sendiri tetap sah.
	// @ts-expect-error harness event minimal untuk actual handler
	const adminResponse = await PURCHASE(routeEvent('admin'));
	assert.equal(adminResponse.status, 200);
	track((await adminResponse.json()) as { mutasi_id: string; kas_id: string | null });

	console.log('purchase-command: all assertions passed');
} finally {
	for (const id of kasIds) {
		await db.prepare(`DELETE FROM buku_kas WHERE cabang_id = 'berau' AND id = ?`).bind(id).run();
	}
	for (const id of mutasiIds) {
		await db
			.prepare(`DELETE FROM bahan_mutasi WHERE cabang_id = 'berau' AND id = ?`)
			.bind(id)
			.run();
	}
	for (const id of bahanIds) {
		await db.prepare(`DELETE FROM bahan WHERE cabang_id = 'berau' AND id = ?`).bind(id).run();
	}
	await close();
}
