import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/d1';
import { insertSesiTokoRows } from '../lib/server/services/sesiTokoService';
import {
	PATCH as closeSessionPatch,
	POST as openSessionPost
} from '../routes/api/sesi-toko/+server';
import { createTestD1 } from './helpers/testD1';

import { branchContext } from '../lib/server/branchResolver';
import { formatDateYmdWita } from '../lib/utils/dateTime';
import { readKioskOrderHandoff } from '../lib/server/kioskOrderHandoff';
import { allocateNomorHarian } from '../lib/server/checkout/nomorHarian';
import { projectKioskEvent } from '../lib/server/kioskD1Projection';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { openCoordinatedShift } from '../lib/server/coordinatedShift';

// Identitas akun sama, tetapi dua HP mengirim ID operasi berbeda.
const memory = new Map<string, unknown>();
const tx = {
	get: async <T>(key: string) => memory.get(key) as T | undefined,
	put: async <T>(key: string, value: T) => {
		memory.set(key, value);
	}
};
const firstOpen = { id: 'hp1', userId: 'kasir', openingCash: 100000, openedAt: 1000 };
assert.equal((await openCoordinatedShift(tx, firstOpen)).status, 'uninitialized');
memory.set('shift:active', null);
assert.equal((await openCoordinatedShift(tx, firstOpen)).status, 'opened');
assert.equal((await openCoordinatedShift(tx, { ...firstOpen, id: 'hp2' })).status, 'already-open');
assert.equal(
	(await openCoordinatedShift(tx, { ...firstOpen, id: 'hp2', openingCash: 20000 })).status,
	'conflict'
);
assert.equal((await openCoordinatedShift(tx, { ...firstOpen, openedAt: 2000 })).status, 'replayed');
assert.equal((await openCoordinatedShift(tx, { ...firstOpen, openingCash: 0 })).status, 'conflict');
assert.equal(memory.get('projection:tail'), 1, 'one event for the shared shift');
assert.ok(memory.has('shift:request:hp1') && memory.has('shift:request:hp2'));
memory.set('shift:active', null);
assert.equal((await openCoordinatedShift(tx, { ...firstOpen, id: 'hp2' })).status, 'replayed');
assert.equal(memory.get('shift:active'), null, 'a delayed replay cannot reopen the shop');

// Satu sesi aktif per cabang: buka atomik, kalah 409, retry stabil.

const { db, close } = await createTestD1();
const drizzleDb = drizzle(db);
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

const openedIds: string[] = [];
const otherBranchIds: string[] = [];
const otherBranchId = `sesi-${randomUUID()}`;
const siblingBranchId = `sesi-${randomUUID()}`;
otherBranchIds.push(otherBranchId);

function openPayload(id: string, kasAwal: unknown = 50000) {
	return [{ id, kas_awal: kasAwal, waktu_buka: '2026-10-05T00:00:00.000Z', is_active: true }];
}

async function activeCount(branch = 'berau') {
	const row = (await db
		.prepare('SELECT COUNT(*) AS n FROM sesi_toko WHERE cabang_id = ? AND is_active = 1')
		.bind(branch)
		.first()) as { n?: number } | null;
	return Number(row?.n ?? 0);
}

function postEvent(branch: 'berau' | 'samarinda' | 'balikpapan', id: string) {
	return {
		request: new Request('https://test.invalid/api/sesi-toko', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload: openPayload(id) })
		}),
		locals: { authSession: { ...session, branch } },
		platform: { env: { DB_BERAU_GROUP: db, DB_SAMARINDA_GROUP: db } }
	};
}

function patchEvent(
	branch: 'berau' | 'samarinda' | 'balikpapan',
	id: string,
	payload: Record<string, unknown>
) {
	return {
		request: new Request('https://test.invalid/api/sesi-toko', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ where: { id }, payload })
		}),
		locals: { authSession: { ...session, branch } },
		platform: { env: { DB_BERAU_GROUP: db, DB_SAMARINDA_GROUP: db } }
	};
}

function openViaPost(branch: 'berau' | 'samarinda' | 'balikpapan', id: string) {
	return openSessionPost(postEvent(branch, id) as unknown as Parameters<typeof openSessionPost>[0]);
}

function closeViaPatch(
	branch: 'berau' | 'samarinda' | 'balikpapan',
	id: string,
	payload: Record<string, unknown>
) {
	return closeSessionPatch(
		patchEvent(branch, id, payload) as unknown as Parameters<typeof closeSessionPatch>[0]
	);
}

async function expectStatus(run: () => unknown, status: number) {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === status
	);
}

try {
	// Persiapan alih jalur hanya setelah cabang tutup. Marker tidak boleh mengubah shift lama.
	const pause = (branch: string) =>
		db.prepare('INSERT INTO kiosk_shift_cutover (cabang_id) VALUES (?)').bind(branch).run();
	await pause('berau');
	await assert.rejects(
		async () => openViaPost('berau', `cutover-${randomUUID()}`),
		/KIOS_CUTOVER_PAUSED/
	);
	assert.equal(await activeCount('berau'), 0);
	await db.prepare('DELETE FROM kiosk_shift_cutover WHERE cabang_id=?').bind('berau').run();

	const coordinatedId = randomUUID();
	const branch = branchContext('berau');
	const platform = { env: { DB_BERAU_GROUP: db, POS_PRICE_SIGNING_KEY: randomUUID() } };
	const openedAt = Date.now() - 10_000;
	const shift = { id: coordinatedId, userId: 'kasir', openingCash: 100000, openedAt };
	const opening = { sequence: 1, kind: 'shift-opened', record: { shift } } as const;
	await assert.rejects(() => projectKioskEvent(platform, branch, opening), /belum dialihkan/);
	const numberingDate = formatDateYmdWita(new Date(openedAt));
	await assert.rejects(() => readKioskOrderHandoff(db, branch, openedAt), /belum dapat dialihkan/);
	const legacyNumber = await allocateNomorHarian(db, branch, numberingDate);
	assert.equal(legacyNumber, 1);
	const productId = randomUUID();
	await db
		.prepare(
			`INSERT INTO produk(id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active)
		VALUES (?,'berau','Jus',10000,5,1,0,1)`
		)
		.bind(productId)
		.run();
	await pause('berau');
	await assert.rejects(
		() =>
			db
				.prepare('UPDATE produk SET stok=99 WHERE cabang_id=? AND id=?')
				.bind(branch, productId)
				.run(),
		/KIOS_INVENTORY_FENCED/
	);
	await assert.rejects(
		() => allocateNomorHarian(db, branch, numberingDate),
		/Alokasi nomor harian gagal/
	);
	assert.deepEqual(await readKioskOrderHandoff(db, branch, openedAt), {
		date: numberingDate,
		lastNumber: legacyNumber
	});
	await projectKioskEvent(platform, branch, opening);
	await projectKioskEvent(platform, branch, opening);
	assert.equal(await activeCount('berau'), 1);
	await assert.rejects(
		async () =>
			closeViaPatch('berau', coordinatedId, {
				is_active: false,
				waktu_tutup: new Date(openedAt + 5000).toISOString()
			}),
		{ status: 409 }
	);
	const soldAt = openedAt + 2000;
	const priceToken = await signPosPricingToken(platform.env, {
		kind: 'catalog_product',
		branch,
		data: { id: productId, nama: 'Jus', harga: 10000 },
		now: openedAt,
		ttlMs: 60000
	});
	const saleId = randomUUID();
	const sale = {
		sequence: 2,
		kind: 'sale-recorded',
		record: {
			userId: 'kasir',
			orderNumber: 7,
			orderDate: formatDateYmdWita(new Date(soldAt).toISOString()),
			request: {
				id: saleId,
				shiftId: coordinatedId,
				payment: 'tunai',
				cash: 12000,
				items: [{ product_id: productId, jumlah: 1, product_price_token: priceToken }]
			},
			receipt: { total_amount: 10000, total_qty: 1, committed_at: new Date(soldAt).toISOString() }
		}
	} as const;
	await projectKioskEvent(platform, branch, sale);
	await projectKioskEvent(platform, branch, sale);
	const projected = await db
		.prepare(
			'SELECT COUNT(*) AS count FROM buku_kas WHERE cabang_id=? AND idempotency_key=? AND id_sesi_toko=? AND nomor_harian=7'
		)
		.bind(branch, `kiosk:${saleId}`, coordinatedId)
		.first<{ count: number }>();
	assert.equal(projected?.count, 1);
	const inventory = await db
		.prepare('SELECT stok FROM produk WHERE cabang_id=? AND id=?')
		.bind(branch, productId)
		.first<{ stok: number }>();
	assert.equal(inventory?.stok, 4, 'projection retry cannot deduct stock twice');
	await assert.rejects(
		() =>
			db.batch([
				db
					.prepare('INSERT INTO kiosk_inventory_projection_permit(cabang_id) VALUES (?)')
					.bind(branch),
				db.prepare('UPDATE produk SET stok=42 WHERE cabang_id=? AND id=?').bind(branch, productId),
				db
					.prepare('INSERT INTO kiosk_inventory_projection_permit(cabang_id) VALUES (?)')
					.bind(branch)
			]),
		/UNIQUE/
	);
	assert.equal(
		(
			await db
				.prepare('SELECT stok FROM produk WHERE cabang_id=? AND id=?')
				.bind(branch, productId)
				.first<{ stok: number }>()
		)?.stok,
		4
	);
	assert.equal(
		await db
			.prepare('SELECT cabang_id FROM kiosk_inventory_projection_permit WHERE cabang_id=?')
			.bind(branch)
			.first(),
		null
	);
	await assert.rejects(
		() =>
			db
				.prepare('UPDATE produk SET stok=99 WHERE cabang_id=? AND id=?')
				.bind(branch, productId)
				.run(),
		/KIOS_INVENTORY_FENCED/
	);
	const closing = {
		sequence: 3,
		kind: 'shift-closed',
		record: { ...shift, closedAt: openedAt + 5000 }
	} as const;
	await projectKioskEvent(platform, branch, closing);
	await projectKioskEvent(platform, branch, closing);
	await projectKioskEvent(platform, branch, opening);
	assert.equal(await activeCount('berau'), 0, 'late open replay cannot reopen a closed shift');
	await db.prepare('DELETE FROM kiosk_shift_cutover WHERE cabang_id=?').bind('berau').run();
	openedIds.push(coordinatedId);

	// 1. Buka pertama sukses.
	const id1 = `sesi-${randomUUID()}`;
	const first = await insertSesiTokoRows(
		drizzleDb,
		db,
		'berau',
		session,
		undefined,
		openPayload(id1, 50000.4)
	);
	openedIds.push(id1);
	await assert.rejects(() => pause('berau'), /KIOS_SHIFT_STILL_OPEN/);
	await pause('samarinda');
	assert.equal(await activeCount('berau'), 1);
	await db.prepare('DELETE FROM kiosk_shift_cutover WHERE cabang_id=?').bind('samarinda').run();
	assert.equal(first.ok, true);
	assert.equal((first.data[0] as { kas_awal: number }).kas_awal, 50000);
	assert.equal(await activeCount(), 1);
	const closeAt = '2026-10-05T00:10:00.000Z';
	await expectStatus(
		() =>
			closeViaPatch('berau', id1, {
				waktu_tutup: closeAt,
				is_active: false,
				kas_awal: 100,
				waktu_buka: '2026-10-04T00:00:00.000Z',
				created_at: '2026-10-04T00:00:00.000Z',
				cabang_id: 'samarinda',
				kas_akhir: 60000
			}),
		400
	);
	await expectStatus(
		() =>
			closeViaPatch('berau', id1, { waktu_tutup: '2026-10-04T23:59:59.000Z', is_active: false }),
		400
	);
	await expectStatus(
		() => closeViaPatch('samarinda', id1, { waktu_tutup: closeAt, is_active: false }),
		404
	);
	const openingAfterRejectedPatch = (await db
		.prepare(
			`SELECT kas_awal, waktu_buka, is_active FROM sesi_toko WHERE cabang_id = 'berau' AND id = ?`
		)
		.bind(id1)
		.first()) as { kas_awal?: number; waktu_buka?: string; is_active?: number } | null;
	assert.equal(Number(openingAfterRejectedPatch?.kas_awal), 50000);
	assert.equal(openingAfterRejectedPatch?.waktu_buka, '2026-10-05T00:00:00.000Z');
	assert.equal(Number(openingAfterRejectedPatch?.is_active), 1);

	// Close valid hanya sekali; retry sama idempoten, waktu lain tidak menulis ulang histori.
	const closeResponse = await closeViaPatch('berau', id1, {
		waktu_tutup: closeAt,
		is_active: false
	});
	assert.equal(closeResponse.status, 200);
	assert.deepEqual(await closeResponse.json(), { ok: true, duplicate: false });
	const closeRetry = await closeViaPatch('berau', id1, {
		waktu_tutup: closeAt,
		is_active: false
	});
	assert.equal(closeRetry.status, 200);
	assert.deepEqual(await closeRetry.json(), { ok: true, duplicate: true });
	await expectStatus(
		() =>
			closeViaPatch('berau', id1, {
				waktu_tutup: '2026-10-05T00:11:00.000Z',
				is_active: false
			}),
		409
	);
	assert.equal(await activeCount(), 0);

	// Cabang berbeda memiliki invariant aktif masing-masing.
	await insertSesiTokoRows(
		drizzleDb,
		db,
		'samarinda',
		{ ...session, branch: 'samarinda' },
		undefined,
		openPayload(otherBranchId)
	);
	assert.equal(await activeCount('samarinda'), 1);
	await insertSesiTokoRows(
		drizzleDb,
		db,
		'balikpapan',
		{ ...session, branch: 'balikpapan' },
		undefined,
		openPayload(siblingBranchId)
	);
	assert.equal(await activeCount('balikpapan'), 1);

	// Handler HTTP asli juga memetakan kontensi ke satu 200 dan satu 409.
	await db
		.prepare(`UPDATE sesi_toko SET is_active = 0 WHERE cabang_id = 'samarinda' AND id = ?`)
		.bind(otherBranchId)
		.run();
	const httpIdA = `sesi-${randomUUID()}`;
	const httpIdB = `sesi-${randomUUID()}`;
	otherBranchIds.push(httpIdA, httpIdB);
	const httpResults = await Promise.allSettled([
		openViaPost('samarinda', httpIdA),
		openViaPost('samarinda', httpIdB)
	]);
	const httpFulfilled = httpResults.filter(
		(result): result is PromiseFulfilledResult<Response> => result.status === 'fulfilled'
	);
	const httpRejected = httpResults.filter((result) => result.status === 'rejected');
	assert.equal(httpFulfilled.length, 1);
	assert.equal(httpFulfilled[0].value.status, 200);
	assert.equal(httpRejected.length, 1);
	assert.equal((httpRejected[0] as PromiseRejectedResult).reason?.status, 409);
	assert.equal(await activeCount('samarinda'), 1);

	// 2. Dua buka bersamaan: tepat satu aktif, kalah 409 tanpa mutasi.
	// Sesi lama sudah ditutup melalui handler; tidak pernah aktif kembali.
	const idA = `sesi-${randomUUID()}`;
	const idB = `sesi-${randomUUID()}`;
	const results = await Promise.allSettled([
		insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, openPayload(idA)),
		insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, openPayload(idB))
	]);
	const fulfilled = results.filter((r) => r.status === 'fulfilled');
	const rejected = results.filter((r) => r.status === 'rejected');
	assert.equal(fulfilled.length + rejected.length, 2);
	assert.equal(await activeCount(), 1);
	for (const r of rejected) {
		assert.equal((r as PromiseRejectedResult).reason?.status, 409);
	}
	assert.equal(rejected.length, 1);
	openedIds.push(idA, idB);

	// 3. Concurrent close CAS: satu snapshot menang, penutupan berbeda kalah 409.
	const activeSession = (await db
		.prepare(`SELECT id FROM sesi_toko WHERE cabang_id = 'berau' AND is_active = 1 LIMIT 1`)
		.first()) as { id?: string } | null;
	assert.ok(activeSession?.id);
	const closeRace = await Promise.allSettled([
		closeViaPatch('berau', activeSession.id, {
			waktu_tutup: '2026-10-05T00:20:00.000Z',
			is_active: false
		}),
		closeViaPatch('berau', activeSession.id, {
			waktu_tutup: '2026-10-05T00:21:00.000Z',
			is_active: false
		})
	]);
	const closeWins = closeRace.filter(
		(result): result is PromiseFulfilledResult<Response> => result.status === 'fulfilled'
	);
	const closeConflicts = closeRace.filter((result) => result.status === 'rejected');
	assert.equal(closeWins.length, 1);
	assert.equal(closeWins[0].value.status, 200);
	assert.equal(closeConflicts.length, 1);
	assert.equal((closeConflicts[0] as PromiseRejectedResult).reason?.status, 409);
	const closedRace = (await db
		.prepare(
			`SELECT kas_awal, is_active, waktu_tutup FROM sesi_toko WHERE cabang_id = 'berau' AND id = ?`
		)
		.bind(activeSession.id)
		.first()) as { kas_awal?: number; is_active?: number; waktu_tutup?: string } | null;
	assert.equal(Number(closedRace?.kas_awal), 50000);
	assert.equal(Number(closedRace?.is_active), 0);
	assert.ok(
		closedRace?.waktu_tutup === '2026-10-05T00:20:00.000Z' ||
			closedRace?.waktu_tutup === '2026-10-05T00:21:00.000Z'
	);
	assert.equal(await activeCount(), 0);

	// 4. Retry ID lama stabil; fingerprint berbeda tidak mengubah sesi.
	const retry = await insertSesiTokoRows(
		drizzleDb,
		db,
		'berau',
		session,
		undefined,
		openPayload(id1)
	);
	assert.equal((retry as { duplicate?: boolean }).duplicate, true);
	await expectStatus(
		() => insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, openPayload(id1, 60000)),
		409
	);
	const retained = (await db
		.prepare(`SELECT kas_awal FROM sesi_toko WHERE cabang_id = 'berau' AND id = ?`)
		.bind(id1)
		.first()) as { kas_awal?: number } | null;
	assert.equal(Number(retained?.kas_awal), 50000);
	assert.equal(await activeCount(), 0);

	// 5. Validasi: kas negatif/NaN, waktu rusak, multi-baris → 400.
	await expectStatus(
		() =>
			insertSesiTokoRows(
				drizzleDb,
				db,
				'berau',
				session,
				undefined,
				openPayload(`sesi-${randomUUID()}`, -1)
			),
		400
	);
	await expectStatus(
		() =>
			insertSesiTokoRows(
				drizzleDb,
				db,
				'berau',
				session,
				undefined,
				openPayload(`sesi-${randomUUID()}`, Number.NaN)
			),
		400
	);
	await expectStatus(
		() =>
			insertSesiTokoRows(
				drizzleDb,
				db,
				'berau',
				session,
				undefined,
				openPayload(`sesi-${randomUUID()}`, '')
			),
		400
	);
	await expectStatus(
		() =>
			insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, [
				{ id: `sesi-${randomUUID()}`, kas_awal: 1000, waktu_buka: 'bukan-tanggal' }
			]),
		400
	);
	await expectStatus(
		() =>
			insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, [
				...openPayload(`sesi-${randomUUID()}`),
				...openPayload(`sesi-${randomUUID()}`)
			]),
		400
	);
	assert.equal(await activeCount(), 0);

	// 6. Setelah semua penutupan, sesi baru dapat dibuka tanpa mengaktifkan histori lama.
	const id2 = `sesi-${randomUUID()}`;
	await insertSesiTokoRows(drizzleDb, db, 'berau', session, undefined, openPayload(id2));
	openedIds.push(id2);
	assert.equal(await activeCount(), 1);

	console.log('sesi-toko: all assertions passed');
} finally {
	for (const id of openedIds) {
		if (!id) continue;
		await db.prepare(`DELETE FROM sesi_toko WHERE cabang_id = 'berau' AND id = ?`).bind(id).run();
	}
	for (const id of otherBranchIds) {
		await db
			.prepare(`DELETE FROM sesi_toko WHERE cabang_id = 'samarinda' AND id = ?`)
			.bind(id)
			.run();
	}
	await db
		.prepare(`DELETE FROM sesi_toko WHERE cabang_id = 'balikpapan' AND id = ?`)
		.bind(siblingBranchId)
		.run();
	await close();
}
