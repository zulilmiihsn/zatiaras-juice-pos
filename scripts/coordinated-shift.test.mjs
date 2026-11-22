// Local workerd and disposable D1 only. No deployment credentials or network service.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const dir = await mkdtemp(join(tmpdir(), 'shift-workerd-'));
let runtime;
try {
	await build({
		configFile: false,
		logLevel: 'warn',
		resolve: { alias: { $lib: resolve('src/lib') } },
		build: {
			lib: {
				entry: resolve('scripts/fixtures/shift-worker.ts'),
				formats: ['es'],
				fileName: () => 'worker.mjs'
			},
			rolldownOptions: { external: ['node:crypto'] },
			outDir: dir,
			copyPublicDir: false
		}
	});
	runtime = new Miniflare(
		convertV4MiniflareOptions({
			modules: true,
			scriptPath: join(dir, 'worker.mjs'),
			modulesRoot: dir,
			compatibilityDate: '2026-06-29',
			compatibilityFlags: ['nodejs_compat'],
			d1Databases: {
				DB_SAMARINDA_GROUP: 'kiosk-test-samarinda',
				DB_BALIKPAPAN_GROUP: 'kiosk-test-balikpapan',
				DB_BERAU_GROUP: 'kiosk-test-berau'
			},
			resourcePersistencePath: join(dir, 'state'),
			durableObjects: { SHIFT: { className: 'ShiftFixture', useSQLite: true } }
		})
	);
	const address = await runtime.ready;
	const send = async (branch, action, input, scope = '') => {
		const res = await runtime.dispatchFetch(new URL(`/${branch}/${action}${scope}`, address), {
			method: 'POST',
			body: JSON.stringify(input)
		});
		const body = await res.json();
		assert.equal(res.status, body?.ok === false ? 401 : action === 'device/enroll' ? 201 : 200);
		return body;
	};
	const post = send;
	const initDb = async (branch) => {
		const db = await runtime.getD1Database(`DB_${branch.toUpperCase()}_GROUP`);
		for (const name of (await readdir('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
			const statements = (await readFile(join('drizzle', name), 'utf8'))
				.split('--> statement-breakpoint')
				.map((sql) => sql.trim())
				.filter(Boolean);
			await db.batch(statements.map((sql) => db.prepare(sql)));
		}
		return db;
	};
	const { hash } = await import('bcryptjs');
	const password = crypto.randomUUID();
	const profile = {
		userId: 'user-1',
		username: 'kasir',
		role: 'kasir',
		verifier: await hash(password, 4)
	};
	const enroll = () => post('berau', 'device/enroll', profile);
	const [device1, device2] = await Promise.all([enroll(), enroll()]);
	assert.ok(device1.token && device2.token && device1.token !== device2.token);
	const login = (token, pass = password, branch = 'berau') =>
		post(branch, 'device/login', { token, username: profile.username, password: pass });
	assert.equal((await login(device1.token, 'invalid')).ok, false);
	assert.equal((await login(device1.token, password, 'samarinda')).ok, false);
	const [s1, s2] = await Promise.all([login(device1.token), login(device2.token)]);
	assert.ok(s1.ok && s2.ok && s1.sid !== s2.sid);
	const open = (device, session, id, cash = 100000) =>
		post('berau', 'device/shift-open', {
			token: device.token,
			sid: session.sid,
			id,
			openingCash: cash,
			userId: 'spoofed'
		});
	const check = (token, sid) => post('berau', 'device/session', { token, sid });
	assert.deepEqual(await check(device2.token, s1.sid), { ok: false });
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.state, 'uninitialized');
	assert.equal((await open(device2, s1, 'a')).ok, false);
	assert.equal((await open(device1, s1, 'a')).status, 'uninitialized');
	await post('berau', 'seed-closed', null);
	assert.equal((await open(device1, s1, 'a')).status, 'policy-blocked');
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.state, 'policy-blocked');
	await post('berau', 'seed-unlocked', null);
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.state, 'closed');
	const opened = await Promise.all([open(device1, s1, 'a'), open(device2, s2, 'b')]);
	assert.deepEqual(opened.map((r) => r.status).sort(), ['already-open', 'opened']);
	assert.equal(opened[0].shift.userId, profile.userId);
	assert.deepEqual(opened[0].shift, opened[1].shift);
	assert.equal((await open(device1, s1, 'a')).status, 'replayed');
	assert.equal((await open(device2, s2, 'c', 123)).status, 'conflict');
	assert.deepEqual((await check(device2.token, s2.sid)).shiftStatus, {
		state: 'open',
		id: opened[0].shift.id,
		openingCash: 100000,
		salesSummary: { cashSales: 0, nonCashSales: 0, saleCount: 0, expectedCash: 100000 }
	});
	assert.equal((await check(device2.token, s1.sid)).ok, false);
	await post('berau', 'device/logout', { token: device1.token, sid: s1.sid });
	assert.equal((await check(device1.token, s1.sid)).ok, false);
	assert.equal((await check(device2.token, s2.sid)).ok, true);
	const close = (device, session, id) =>
		post('berau', 'device/shift-close', { token: device.token, sid: session.sid, id });
	assert.equal((await close(device1, s1, opened[0].shift.id)).ok, false);
	assert.equal((await close(device2, s2, 'wrong-shift')).status, 'conflict');
	const { token: priceToken, catalog } = await post('berau', 'sale-token', null);
	const publishCatalog = (snapshot) =>
		post('berau', 'device/catalog', { branch: 'berau', catalog: snapshot });
	assert.equal((await publishCatalog({ ...catalog, branch: 'samarinda' })).ok, false);
	assert.equal((await publishCatalog(catalog)).status, 'updated');
	assert.equal(
		(
			await publishCatalog({
				...catalog,
				fetched_at: new Date(Date.parse(catalog.fetched_at) - 1000).toISOString()
			})
		).status,
		'unchanged'
	);
	const sale = {
		id: 'sale-0001',
		shiftId: opened[0].shift.id,
		payment: 'tunai',
		cash: 30000,
		items: [{ product_id: 'juice', jumlah: 2, product_price_token: priceToken }]
	};
	const sendSale = (input) => post('berau', 'sale', input);
	assert.equal((await sendSale({ ...sale, cash: 1 })).saleError, 400);
	assert.equal((await post('samarinda', 'sale', sale)).saleError, 400);
	assert.equal((await sendSale(sale)).saleError, 409);
	await post('berau', 'seed-numbering', 42);
	const sales = await Promise.all([sendSale(sale), sendSale(sale)]);
	assert.equal((await post('berau', 'seed-numbering', 2)).lastNumber, 42);
	assert.deepEqual(sales.map((r) => r.status).sort(), ['recorded', 'replayed']);
	assert.deepEqual(sales[0].receipt, sales[1].receipt);
	assert.equal(sales[0].receipt.total_amount, 20000);
	assert.equal(sales[0].receipt.change, 10000);
	assert.equal((await sendSale({ ...sale, cash: 31000 })).saleError, 409);
	const checkout = {
		branch: 'berau',
		token: device2.token,
		sid: s2.sid,
		id: 'sale-qris',
		shiftId: sale.shiftId,
		productId: 'juice',
		qty: 2,
		unitPrice: 10000,
		payment: 'qris'
	};
	assert.deepEqual(
		(await post('berau', 'device/session', { branch: 'berau', token: device2.token, sid: s2.sid }))
			.products,
		[
			{
				id: 'juice',
				nama: 'Jus',
				harga: 10000,
				hargaJumbo: 15000,
				addOns: [{ id: 'jelly', nama: 'Jeli', harga: 2000 }]
			}
		]
	);
	assert.equal((await post('berau', 'device/sale', { ...checkout, sid: s1.sid })).ok, false);
	assert.equal(
		(await post('berau', 'device/sale', { ...checkout, unitPrice: 1 })).status,
		'rejected'
	);
	const cartCheckout = {
		...checkout,
		lines: [
			{ productId: 'juice', qty: 1, unitPrice: 10000 },
			{ productId: 'juice', qty: 1, unitPrice: 17000, portion: 'jumbo', addOnIds: ['jelly'] }
		]
	};
	assert.equal(
		(
			await post('berau', 'device/sale', {
				...cartCheckout,
				lines: [{ ...cartCheckout.lines[1], addOnIds: ['unavailable'] }]
			})
		).status,
		'rejected'
	);
	const qris = await post('berau', 'device/sale', cartCheckout);
	const repeatedQris = await post('berau', 'device/sale', cartCheckout);
	assert.equal(qris.receipt.items.length, 2);
	assert.equal(qris.receipt.total_amount, 27000);
	assert.equal(qris.receipt.items[1].harga_dasar, 15000);
	assert.equal(qris.receipt.items[1].tambahan[0].id, 'jelly');
	assert.equal(repeatedQris.status, 'replayed');
	assert.equal(sales[0].orderNumber, 43);
	assert.equal(qris.orderNumber, 44);
	assert.equal(repeatedQris.orderNumber, 44);
	assert.deepEqual(repeatedQris.receipt, qris.receipt);
	assert.equal(qris.status, 'recorded');
	const extraSoldOut = await post('berau', 'device/sale', {
		...cartCheckout,
		id: 'sale-extra-sold-out',
		lines: [cartCheckout.lines[1]]
	});
	assert.equal(extraSoldOut.status, 'rejected');
	assert.match(extraSoldOut.message, /Stok bahan/);
	const salesSummary = {
		cashSales: 20000,
		nonCashSales: 27000,
		saleCount: 2,
		expectedCash: 120000
	};
	assert.deepEqual((await check(device2.token, s2.sid)).shiftStatus.salesSummary, salesSummary);
	const closures = await Promise.all([
		close(device2, s2, opened[0].shift.id),
		close(device2, s2, opened[0].shift.id)
	]);
	assert.deepEqual(closures.map((r) => r.status).sort(), ['closed', 'replayed']);
	assert.deepEqual(closures[0].shift, closures[1].shift);
	assert.deepEqual(closures[0].shift.salesSummary, salesSummary);
	const peek = () => post('berau', 'projection-peek', null);
	const ack = (seq) => post('berau', 'projection-ack', seq);
	const firstEvent = await peek();
	assert.equal(firstEvent.sequence, 1);
	assert.equal(firstEvent.record.shift.id, opened[0].shift.id);
	assert.equal(await ack(2), false, 'cannot skip unsynchronized shift open');
	assert.deepEqual(await peek(), firstEvent, 'without confirmed commit the head stays put');
	for (const [index, kind] of [
		'shift-opened',
		'sale-recorded',
		'sale-recorded',
		'shift-closed'
	].entries()) {
		const event = await peek();
		assert.equal(event.sequence, index + 1);
		assert.equal(event.kind, kind);
		assert.equal(await ack(event.sequence), true);
		assert.equal(await ack(event.sequence), true);
	}
	assert.equal(await peek(), null);
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.state, 'closed');
	assert.equal((await open(device2, s2, 'b')).status, 'replayed');
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.state, 'closed');
	assert.equal((await sendSale(sale)).status, 'replayed');
	assert.equal((await sendSale({ ...sale, id: 'sale-0003' })).saleError, 409);
	const next = await open(device2, s2, 'next');
	assert.equal(next.status, 'opened');
	assert.equal((await close(device2, s2, opened[0].shift.id)).status, 'replayed');
	assert.equal((await check(device2.token, s2.sid)).shiftStatus.id, 'next');
	const freshS1 = await login(device1.token);
	assert.ok(freshS1.ok);
	const competingSale = (device, session, id) =>
		post('berau', 'device/sale', {
			...checkout,
			id,
			shiftId: 'next',
			token: device.token,
			sid: session.sid
		});
	const competing = await Promise.all([
		competingSale(device1, freshS1, 'sale-stock-1'),
		competingSale(device2, s2, 'sale-stock-2')
	]);
	assert.deepEqual(competing.map((result) => result.status).sort(), ['recorded', 'rejected']);
	assert.match(competing.find((result) => result.status === 'rejected').message, /Stok produk/);
	const [lastSale, lastClose] = await Promise.all([
		sendSale({
			...sale,
			id: 'sale-last',
			shiftId: 'next',
			items: [{ ...sale.items[0], jumlah: 1 }]
		}),
		close(device2, s2, 'next')
	]);
	assert.equal(lastClose.status, 'closed');
	assert.ok(lastSale.status === 'recorded' || lastSale.saleError === 409);
	assert.equal(lastClose.shift.salesSummary.saleCount, lastSale.status === 'recorded' ? 2 : 1);
	assert.equal(
		lastClose.shift.salesSummary.expectedCash,
		lastSale.status === 'recorded' ? 110000 : 100000
	);
	for (let i = 0; i < 5; i++) await login(device1.token, 'invalid');
	assert.equal((await login(device1.token)).ok, false);
	await post('berau', 'device/revoke', { token: device2.token });
	assert.equal((await check(device2.token, s2.sid)).ok, false);
	const ownerDevice = await post('berau', 'device/enroll', {
		...profile,
		username: 'pemilik',
		userId: 'owner-1',
		role: 'pemilik'
	});
	assert.ok(ownerDevice.token);
	const ownerLogin = { username: 'pemilik', password, token: ownerDevice.token };
	assert.equal(
		(await post('berau', 'device/login', { ...ownerLogin, token: device1.token })).ok,
		false
	);
	const ownerSession = await post('berau', 'device/login', ownerLogin);
	assert.equal(ownerSession.ok, true);
	const identity = await check(ownerDevice.token, ownerSession.sid);
	assert.equal(identity.userId, 'owner-1');
	assert.equal(identity.scope, 'operasional');
	assert.equal(identity.role, undefined, 'never issue general owner authority');
	const input = { id: 'hp1', userId: 'kasir', openingCash: 100000, openedAt: 1000 };
	assert.equal((await post('balikpapan', 'open', input)).status, 'uninitialized');
	await post('berau', 'seed-closed', null);
	const [a, b] = await Promise.all([
		post('berau', 'open', input),
		post('berau', 'open', { ...input, id: 'hp2' })
	]);
	assert.deepEqual([a.status, b.status].sort(), ['already-open', 'opened']);
	assert.deepEqual(a.shift, b.shift);
	assert.equal(
		(await post('berau', 'open', { ...input, id: 'hp3', openingCash: 20000 })).status,
		'conflict'
	);
	assert.equal((await post('berau', 'open', input)).status, 'replayed');
	assert.equal((await post('samarinda', 'open', input)).status, 'uninitialized');
	for (const branch of ['balikpapan', 'samarinda', 'berau']) {
		const db = await initDb(branch);
		const post = (branch, action, input) => send(branch, action, input, '?recovery');
		for (const [index, quota] of ['read', 'write'].entries()) {
			if (index === 0) {
				await db
					.prepare(
						`INSERT INTO produk(id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES ('juice','${branch}','Jus',10000,5,1,0,1)`
					)
					.run();
				assert.equal((await post(branch, 'activate', null)).failed, true);
				// Provision a disposable Worker key without publishing a Pages catalog.
				await post(branch, 'sale-token', null);
				await db
					.prepare(
						`INSERT INTO pengaturan(id,cabang_id,kunci,pin) VALUES ('kiosk-pin-fixture','${branch}',NULL,'9876')`
					)
					.run();
				assert.match((await post(branch, 'activate', null)).error, /PIN lama/);
				assert.equal(
					await db
						.prepare(`SELECT cabang_id FROM kiosk_shift_cutover WHERE cabang_id='${branch}'`)
						.first(),
					null
				);
				await db
					.prepare(
						`UPDATE pengaturan SET pin=NULL,pin_hash=? WHERE cabang_id='${branch}' AND id='kiosk-pin-fixture'`
					)
					.bind(await post(branch, 'fixture-pin-hash', '9876'))
					.run();
				await db
					.prepare(
						`INSERT INTO sesi_toko(id,cabang_id,waktu_buka,kas_awal,is_active) VALUES ('pilot-legacy-open','${branch}','2026-01-01T00:00:00Z',0,1)`
					)
					.run();
				assert.match((await post(branch, 'activate', null)).error, /KIOS_SHIFT_STILL_OPEN/);
				assert.equal(
					await db
						.prepare(`SELECT cabang_id FROM kiosk_shift_cutover WHERE cabang_id='${branch}'`)
						.first(),
					null
				);
				await db
					.prepare(`DELETE FROM sesi_toko WHERE id='pilot-legacy-open' AND cabang_id='${branch}'`)
					.run();
				assert.deepEqual(await post(branch, 'activate', null), { ok: true, status: 'initialized' });
				assert.deepEqual(await post(branch, 'activate', null), {
					ok: true,
					status: 'already-initialized'
				});
			}
			const devices = await Promise.all([
				post(branch, 'device/enroll', profile),
				post(branch, 'device/enroll', profile)
			]);
			await post(branch, 'quota', quota);
			if (process.argv.includes('--browser')) {
				if (index === 0)
					await db
						.prepare(
							`INSERT INTO profil(id,cabang_id,username,password,role) VALUES (?, '${branch}', ?, ?, 'kasir')`
						)
						.bind(profile.userId, profile.username, profile.verifier)
						.run();
				const { exerciseKioskBrowser } = await import('./fixtures/kiosk-browser.mjs');
				await exerciseKioskBrowser({
					db,
					branch,
					quota,
					devices,
					password,
					username: profile.username,
					bridge: (path, body) =>
						runtime.dispatchFetch(new URL(`/${branch}${path}?recovery`, address), {
							method: 'POST',
							body: JSON.stringify(body)
						})
				});
			} else {
				const sessions = await Promise.all(
					devices.map((device) =>
						post(branch, 'device/login', {
							token: device.token,
							username: profile.username,
							password
						})
					)
				);
				assert.ok(sessions.every((session) => session.ok));
				const fields = (i) => ({ branch, token: devices[i].token, sid: sessions[i].sid });
				assert.equal((await post(branch, 'device/session', fields(0))).pinRequired, true);
				assert.equal(
					(
						await post(branch, 'device/shift-open', {
							...fields(0),
							id: `shift-${quota}`,
							openingCash: 100000,
							pin: '0000'
						})
					).status,
					'policy-blocked'
				);
				const shift = (
					await post(branch, 'device/shift-open', {
						...fields(0),
						id: `shift-${quota}`,
						openingCash: 100000,
						pin: '9876'
					})
				).shift;
				const sales = await Promise.all(
					[0, 1].map((i) =>
						post(branch, 'device/sale', {
							...fields(i),
							id: `sale-${quota}-${i}`,
							shiftId: shift.id,
							productId: 'juice',
							qty: 1,
							unitPrice: 10000,
							payment: 'tunai',
							cash: 12000
						})
					)
				);
				assert.ok(
					sales.every((sale) => sale.status === 'recorded' && sale.receipt.change === 2000)
				);
				assert.equal(new Set(sales.map((sale) => sale.orderNumber)).size, 2);
				assert.equal(
					(await post(branch, 'device/shift-close', { ...fields(0), id: shift.id, pin: '9876' }))
						.status,
					'closed'
				);
			}
			const head = await post(branch, 'projection-peek', null);
			assert.match((await post(branch, 'rollback', null)).error, /Sinkronisasi kios belum selesai/);
			assert.deepEqual(await post(branch, 'projection-peek', null), head);
			const shiftId = head.record.shift.id;
			assert.equal((await post(branch, 'project', null)).failed, true);
			assert.deepEqual(await post(branch, 'projection-peek', null), head);
			await post(branch, 'quota', null);
			for (let tick = 0; tick < 3; tick++)
				assert.deepEqual(await post(branch, 'project', null), { ok: true });
			assert.equal(await post(branch, 'projection-peek', null), null);
			const totals = await db
				.prepare(
					`SELECT COUNT(*) AS n,SUM(nominal) AS total FROM buku_kas WHERE cabang_id='${branch}' AND id_sesi_toko=?`
				)
				.bind(shiftId)
				.first();
			assert.equal(totals.n, 2);
			assert.equal(totals.total, 20000);
			assert.equal(
				(
					await db
						.prepare(`SELECT stok FROM produk WHERE cabang_id='${branch}' AND id='juice'`)
						.first()
				).stok,
				3 - 2 * index
			);
		}
		if (process.argv.includes('--browser')) {
			await db
				.prepare(
					`INSERT INTO profil(id,cabang_id,username,password,role) VALUES ('fixture-owner','${branch}','pemilik-uji',?,'pemilik')`
				)
				.bind(profile.verifier)
				.run();
			const { exerciseKioskBrowser } = await import('./fixtures/kiosk-browser.mjs');
			await exerciseKioskBrowser({
				db,
				branch,
				username: 'pemilik-uji',
				password,
				rollback: true,
				bridge: (path, body) => {
					if (path === '/device/enroll') {
						assert.equal(body.userId, 'fixture-owner');
						assert.equal(body.username, 'pemilik-uji');
						return runtime.dispatchFetch(new URL(`/${branch}${path}?recovery`, address), {
							method: 'POST',
							body: JSON.stringify(body)
						});
					}
					if (path !== '/projection/rollback-production')
						return Response.json({ ok: false }, { status: 404 });
					assert.deepEqual(body, { branch });
					return runtime.dispatchFetch(new URL(`/${branch}/rollback?recovery`, address), {
						method: 'POST',
						body: JSON.stringify(body)
					});
				}
			});
		} else {
			assert.deepEqual(await post(branch, 'rollback', null), {
				ok: true,
				status: 'rolled-back'
			});
		}
		assert.deepEqual(await post(branch, 'rollback', null), { ok: true, status: 'rolled-back' });
		assert.match((await post(branch, 'activate', null)).error, /snapshot stok lama/);
		assert.equal(
			await db
				.prepare(`SELECT cabang_id FROM kiosk_shift_cutover WHERE cabang_id='${branch}'`)
				.first(),
			null
		);
		await db
			.prepare(
				`INSERT INTO sesi_toko(id,cabang_id,waktu_buka,kas_awal,is_active) VALUES ('legacy-after-rollback','${branch}','2026-01-01T00:00:00Z',0,1)`
			)
			.run();
		console.log(`coordinated-shift: ${branch} quota recovery and rollback verified`);
	}
	console.log('coordinated-shift: quota recovery and rollback verified on local workerd');
} finally {
	try {
		await runtime?.dispose();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
