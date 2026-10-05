import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { ownerUsernameForTest } from './helpers';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	if (!existsSync('.env')) throw new Error('UAT_PASSWORD tidak tersedia');
	const password = readFileSync('.env', 'utf8')
		.split(/\r?\n/)
		.find((line) => line.startsWith('UAT_PASSWORD='))
		?.slice('UAT_PASSWORD='.length)
		.trim();
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

async function loginAsOwner(page: Page) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(test.info().title));
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok(), `Login UI gagal: ${response.status()} ${await response.text()}`).toBe(true);
	await expect(page).toHaveURL(/\/{1}$/);
}

async function cleanupTransaction(page: Page, transactionId: string) {
	const result = await page.evaluate(async (id) => {
		const csrfResponse = await fetch('/api/csrf');
		const csrf = (await csrfResponse.json()) as { token?: string };
		if (!csrfResponse.ok || !csrf.token) return { ok: false, status: csrfResponse.status };
		const response = await fetch(`/api/transaksi-kasir?transaction_id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { 'X-CSRF-Token': csrf.token }
		});
		return { ok: response.ok, status: response.status };
	}, transactionId);
	expect(result.ok, `Cleanup transaksi gagal: ${result.status}`).toBe(true);
}

interface UatOrder {
	transactionId: string;
	orderLabel: string;
	customer: string;
}

/** Checkout tunai 1 Es Teh UAT jumbo + gula/es non-normal; kembalikan identitasnya. */
async function checkoutUatOrder(page: Page, customer: string): Promise<UatOrder> {
	await page.goto('/pos');
	const product = page.getByRole('button', {
		name: /(?:Pilih|Tambah) Es Teh UAT/
	});
	await expect(product).toBeVisible({ timeout: 60_000 });
	await product.click();
	await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: 'Sedikit Gula', exact: true }).click();
	await page.getByRole('button', { name: 'Tanpa Es', exact: true }).click();
	await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();

	const openCart = page.getByRole('button', { name: /^Buka keranjang/ });
	if (await openCart.isVisible({ timeout: 2000 }).catch(() => false)) {
		await openCart.click();
		await page.getByRole('button', { name: /^Lanjut ke Pembayaran/ }).click();
	} else {
		await page.getByRole('button', { name: /^Bayar Rp/ }).click();
	}

	await expect(page).toHaveURL(/\/pos\/bayar$/);
	await page.getByLabel('Nama Pelanggan').fill(customer);
	await page.getByRole('button', { name: 'Tunai', exact: true }).click();
	await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi', exact: true }).click();
	await expect(page.getByText('Pembayaran Tunai', { exact: true })).toBeVisible();
	await page.getByPlaceholder('0', { exact: true }).fill('12000');
	const checkoutResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/pos/transaction') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Selesai', exact: true }).click();
	const response = await checkoutResponse;
	expect(response.ok()).toBe(true);
	const payload = (await response.json()) as {
		data?: { transaction_id?: string };
	};
	const transactionId = payload.data?.transaction_id || '';
	expect(transactionId).not.toBe('');
	await expect(page.getByText('Transaksi Berhasil!', { exact: true })).toBeVisible();
	const orderChip = page.getByLabel(/^Nomor pesanan \d+$/);
	await expect(orderChip).toBeVisible();
	const orderLabel = (await orderChip.textContent())?.trim() ?? '';
	expect(orderLabel).toMatch(/^\d{3,}$/);
	return { transactionId, orderLabel, customer };
}

test('owner checkout appears in Antrean with Indonesian labels', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		// Masuk Antrean dari modal sukses.
		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(
			card.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(card.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(card.getByText('Hari ini', { exact: true })).toBeVisible();
		await expect(card.getByText('Es Teh UAT', { exact: false })).toBeVisible();
		await expect(card.getByText('Sedikit Gula', { exact: true })).toBeVisible();
		await expect(card.getByText('Tanpa Es', { exact: true })).toBeVisible();
		await expect(card.getByText('less', { exact: true })).toHaveCount(0);
		await expect(card.getByText('no', { exact: true })).toHaveCount(0);
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

test('completed order moves to Selesai and can be reopened', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		const csrfGuard = await page.evaluate(async (transactionId) => {
			const queueBefore = await fetch('/api/antrean?state=pending&limit=100');
			const before = await queueBefore.json();
			const current = before.data.items.find(
				(row: { transaction_id: string }) => row.transaction_id === transactionId
			);
			const response = await fetch('/api/antrean/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					idempotency_key: current.idempotency_key,
					target: 'done',
					expected_revision: current.preparation_revision
				})
			});
			const queueAfter = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await queueAfter.json();
			const item = payload.data.items.find(
				(row: { idempotency_key: string }) => row.idempotency_key === current.idempotency_key
			);
			return {
				status: response.status,
				state: item?.preparation_state,
				revision: item?.preparation_revision
			};
		}, order.transactionId);
		expect(csrfGuard.status).toBe(403);
		expect(csrfGuard.state).toBe('pending');
		expect(csrfGuard.revision).toBe(0);

		// Tandai selesai lalu pastikan pindah ke tab Selesai.
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const doneCard = page.locator('article', { hasText: customer });
		await expect(doneCard).toBeVisible({ timeout: 30_000 });
		await expect(
			doneCard.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(doneCard.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(doneCard.getByText('Total Rp10.000')).toBeVisible();
		await expect(doneCard.getByText('Es Teh UAT', { exact: false })).toHaveCount(0);
		await doneCard.getByRole('button', { name: /lihat detail pesanan/i }).click();
		const detail = page.getByRole('dialog');
		await expect(detail).toBeVisible();
		await expect(detail.getByText('Es Teh UAT', { exact: false })).toBeVisible();
		await expect(
			detail.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(detail.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(detail.getByText('Sedikit Gula', { exact: true })).toBeVisible();
		await expect(detail.getByText('Tanpa Es', { exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(detail).toHaveCount(0);
		await expect(doneCard).toBeVisible();

		// Buka lagi lalu pastikan kembali ke tab Belum selesai, tahan reload.
		await doneCard.getByRole('button', { name: /buka lagi/i }).click();
		await page.getByRole('tab', { name: /^Belum selesai/ }).click();
		await expect(page.locator('article', { hasText: customer })).toBeVisible({
			timeout: 30_000
		});
		await page.reload();
		await expect(page.locator('article', { hasText: customer })).toBeVisible({
			timeout: 30_000
		});
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

test('queue search filters by name and number', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const doneCard = page.locator('article', { hasText: customer });
		await expect(doneCard).toBeVisible({ timeout: 30_000 });

		// Cari nama: daftar tersaring; bersihkan; kata tak cocok; hapus; cari nomor;
		// gabung nomor + nama; gabung salah; Escape.
		await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
		const searchBox = page.getByPlaceholder('Cari nama / nomor, misal 001 haura...');
		await expect(searchBox).toBeVisible();
		await searchBox.fill(customer);
		await expect(page.getByText('1 pesanan cocok')).toBeVisible();
		await expect(doneCard).toBeVisible();
		await page.getByRole('button', { name: 'Bersihkan pencarian', exact: true }).click();
		await expect(searchBox).toHaveValue('');
		await expect(doneCard).toBeVisible();
		await searchBox.fill('zzz-tidak-ada');
		await expect(page.getByRole('search').getByText('Tidak ada yang cocok')).toBeVisible();
		await expect(page.getByText('Tidak ada pesanan dengan nama')).toBeVisible();
		await expect(doneCard).toHaveCount(0);
		await page.getByRole('button', { name: 'Hapus pencarian', exact: true }).click();
		await expect(searchBox).toHaveCount(0);
		await expect(doneCard).toBeVisible();
		await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
		await searchBox.fill(order.orderLabel.replace(/\D/g, ''));
		await expect(doneCard).toBeVisible();
		const digits = order.orderLabel.replace(/\D/g, '') || order.orderLabel;
		await searchBox.fill(`${digits} ${customer}`);
		await expect(page.getByText('1 pesanan cocok')).toBeVisible();
		await expect(doneCard).toBeVisible();
		await searchBox.fill(`${digits} zzz-salah`);
		await expect(page.getByRole('search').getByText('Tidak ada yang cocok')).toBeVisible();
		await expect(doneCard).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(searchBox).toHaveCount(0);
		await expect(doneCard).toBeVisible();
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

function queueFixtures(count = 51) {
	return Array.from({ length: count }, (_, index) => {
		const n = index + 1;
		const suffix = String(n).padStart(4, '0');
		return {
			buku_kas_id: `bk-fixture-${suffix}`,
			transaction_id: `transaction-fixture-${suffix}`,
			idempotency_key: `antrean-fixture-${suffix}`,
			nomor_harian: n,
			tanggal_nomor: '2026-10-02',
			nama_pelanggan: `Pelanggan fixture ${n}`,
			waktu: new Date(Date.UTC(2026, 9, 2, 1, index)).toISOString(),
			metode_bayar: 'tunai',
			nominal: 10000,
			jumlah: 1,
			preparation_state: 'pending' as const,
			preparation_revision: 0,
			preparation_completed_at: null,
			preparation_completed_by: null,
			items: [
				{
					id: `item-${suffix}`,
					produk_id: null,
					nama: 'Jus fixture',
					jumlah: 1,
					harga: 10000,
					nominal: 10000,
					gula: null,
					es: null,
					catatan: null,
					tambahan: []
				}
			]
		};
	});
}

async function routeQueueFixtures(page: Page, count = 51) {
	const rows = queueFixtures(count);
	await page.route('**/api/antrean?*', async (route) => {
		const url = new URL(route.request().url());
		const offset = Number(url.searchParams.get('cursor') || 0);
		const limit = Number(url.searchParams.get('limit') || 50);
		const source = url.searchParams.get('state') === 'done' ? [] : rows;
		const items = source.slice(offset, offset + limit);
		const hasMore = offset + limit < source.length;
		await route.fulfill({
			json: {
				ok: true,
				data: {
					items,
					pending_count: rows.length,
					hasMore,
					nextCursor: hasMore ? String(offset + limit) : null
				}
			}
		});
	});
}

test('shared IndexedDB keeps concurrent intents and refuses capacity eviction', async ({
	page,
	context
}) => {
	await page.goto('/login');
	const second = await context.newPage();
	await second.goto('/login');
	try {
		const saves = [page, second].map((tab, index) =>
			tab.evaluate(async (n) => {
				const path = '/src/lib/utils/orderQueueLocal.ts';
				const queue = await import(/* @vite-ignore */ path);
				const key = `atomic-fixture-${n}`;
				const card = {
					idempotency_key: key,
					buku_kas_id: `bk-${key}`,
					transaction_id: `transaction-${key}`,
					nominal: 10000,
					nomor_harian: n + 1,
					nama_pelanggan: `Pelanggan atomic ${n}`,
					waktu: '2026-10-02T01:00:00.000Z',
					preparation_state: 'pending',
					preparation_revision: 0,
					preparation_completed_at: null,
					items: [
						{
							nama: 'Jus atomic',
							jumlah: 1,
							gula: null,
							es: null,
							catatan: null,
							tambahan: []
						}
					],
					unsynced: false
				};
				await queue.saveStatusIntent({
					branch: 'samarinda',
					idempotency_key: key,
					target: 'done',
					expected_revision: 0,
					userId: 'fixture-user',
					card
				});
			}, index)
		);
		await Promise.all(saves);
		await page.reload();
		const projected = await page.evaluate(async () => {
			const path = '/src/lib/utils/orderQueueLocal.ts';
			const queue = await import(/* @vite-ignore */ path);
			const records = await queue.loadStatusIntents('samarinda');
			return queue
				.mergeQueueWithLocal([], [], records, 'samarinda', 'fixture-user')
				.map(
					(card: {
						idempotency_key: string;
						preparation_state: string;
						nama_pelanggan: string;
						items: Array<{ nama: string }>;
						unsynced: boolean;
					}) => ({
						key: card.idempotency_key,
						state: card.preparation_state,
						customer: card.nama_pelanggan,
						item: card.items[0]?.nama,
						unsynced: card.unsynced
					})
				)
				.sort((a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : 1));
		});
		expect(projected).toEqual([
			{
				key: 'atomic-fixture-0',
				state: 'done',
				customer: 'Pelanggan atomic 0',
				item: 'Jus atomic',
				unsynced: true
			},
			{
				key: 'atomic-fixture-1',
				state: 'done',
				customer: 'Pelanggan atomic 1',
				item: 'Jus atomic',
				unsynced: true
			}
		]);
		const capacity = await page.evaluate(async () => {
			const path = '/src/lib/utils/orderQueueLocal.ts';
			const queue = await import(/* @vite-ignore */ path);
			for (let n = 2; n < 200; n++)
				await queue.saveStatusIntent({
					branch: 'samarinda',
					idempotency_key: `atomic-fixture-${n}`,
					target: 'done',
					expected_revision: 0,
					userId: 'fixture-user'
				});
			let message = '';
			try {
				await queue.saveStatusIntent({
					branch: 'samarinda',
					idempotency_key: 'atomic-fixture-overflow',
					target: 'done',
					expected_revision: 0,
					userId: 'fixture-user'
				});
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}
			await queue.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: 'atomic-fixture-0',
				target: 'pending',
				expected_revision: 1,
				userId: 'fixture-user',
				card: {
					idempotency_key: 'atomic-fixture-0',
					buku_kas_id: 'bk-atomic-fixture-0',
					transaction_id: 'transaction-atomic-fixture-0',
					nominal: 10000,
					nomor_harian: 1,
					nama_pelanggan: 'Pelanggan atomic replacement',
					waktu: '2026-10-02T01:00:00.000Z',
					preparation_state: 'pending',
					preparation_revision: 1,
					preparation_completed_at: null,
					items: [
						{
							nama: 'Jus replacement',
							jumlah: 1,
							gula: null,
							es: null,
							catatan: null,
							tambahan: []
						}
					],
					unsynced: true
				}
			});
			const records = await queue.loadStatusIntents('samarinda');
			return {
				message,
				count: records.length,
				first: records.find(
					(r: { idempotency_key: string }) => r.idempotency_key === 'atomic-fixture-0'
				),
				hasOverflow: records.some(
					(r: { idempotency_key: string }) => r.idempotency_key === 'atomic-fixture-overflow'
				)
			};
		});
		expect(capacity.message).toBe(
			'Terlalu banyak perubahan status belum tersinkron. Sinkronkan dulu lalu coba lagi.'
		);
		expect(capacity.count).toBe(200);
		expect(capacity.hasOverflow).toBe(false);
		expect(capacity.first).toMatchObject({
			target: 'pending',
			expected_revision: 1,
			card: { nama_pelanggan: 'Pelanggan atomic replacement' }
		});
	} finally {
		await second.close();
	}
});

test('staged status predecessor and latest target survive reload and stale rejection', async ({
	page
}) => {
	await page.goto('/login');
	const key = `antrean-predecessor-${Date.now()}`;
	const staged = await page.evaluate(async (idempotencyKey) => {
		const path = '/src/lib/utils/orderQueueLocal.ts';
		const queue = await import(/* @vite-ignore */ path);
		const card = {
			idempotency_key: idempotencyKey,
			buku_kas_id: 'bk-predecessor',
			transaction_id: 'transaction-predecessor',
			nominal: 10000,
			nomor_harian: 7,
			nama_pelanggan: 'Pelanggan predecessor',
			waktu: '2026-10-02T01:00:00.000Z',
			preparation_state: 'pending',
			preparation_revision: 0,
			preparation_completed_at: null,
			items: [
				{ nama: 'Jus fixture', jumlah: 1, gula: null, es: null, catatan: null, tambahan: [] }
			],
			unsynced: false
		};
		const originalNow = Date.now;
		Date.now = () => Date.UTC(2026, 9, 2, 1, 0);
		try {
			await queue.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'done',
				expected_revision: 0,
				userId: 'uat-pemilik-samarinda',
				card
			});
			const predecessor = await queue.stageStatusIntent('samarinda', idempotencyKey);
			await queue.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'pending',
				expected_revision: 0,
				userId: 'uat-pemilik-samarinda',
				card
			});
			return predecessor;
		} finally {
			Date.now = originalNow;
		}
	}, key);
	expect(staged).toMatchObject({ idempotency_key: key, target: 'done', expected_revision: 0 });
	await page.reload();
	const persisted = await page.evaluate(async (idempotencyKey) => {
		const path = '/src/lib/utils/orderQueueLocal.ts';
		const queue = await import(/* @vite-ignore */ path);
		const intent = (await queue.loadStatusIntents('samarinda')).find(
			(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
		);
		return {
			target: intent?.target,
			desiredRevision: intent?.expected_revision,
			stagedTarget: intent?.in_flight?.target,
			stagedRevision: intent?.in_flight?.expected_revision,
			cardName: intent?.card?.nama_pelanggan
		};
	}, key);
	expect(persisted).toEqual({
		target: 'pending',
		desiredRevision: 0,
		stagedTarget: 'done',
		stagedRevision: 0,
		cardName: 'Pelanggan predecessor'
	});
	const resolved = await page.evaluate(
		async ({ idempotencyKey, sent }) => {
			const path = '/src/lib/utils/orderQueueLocal.ts';
			const queue = await import(/* @vite-ignore */ path);
			await queue.acknowledgeStatusIntent('samarinda', sent, {
				idempotency_key: idempotencyKey,
				transaction_id: 'transaction-predecessor',
				preparation_state: 'done',
				preparation_revision: 1,
				preparation_completed_at: '2026-10-02T01:02:00.000Z',
				preparation_completed_by: 'uat-pemilik-samarinda',
				idempotent: true
			});
			const staleRejected = await queue.rejectStagedStatusIntent('samarinda', sent);
			const next = await queue.stageStatusIntent('samarinda', idempotencyKey);
			const latest = (await queue.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			return {
				target: latest?.target,
				revision: latest?.expected_revision,
				staleRejected,
				stagedTarget: latest?.in_flight?.target,
				nextTarget: next?.target,
				nextRevision: next?.expected_revision
			};
		},
		{ idempotencyKey: key, sent: staged }
	);
	expect(resolved).toEqual({
		target: 'pending',
		revision: 1,
		staleRejected: false,
		stagedTarget: 'pending',
		nextTarget: 'pending',
		nextRevision: 1
	});
	const staleRemoval = await page.evaluate(async (baseKey) => {
		const path = '/src/lib/utils/orderQueueLocal.ts';
		const queue = await import(/* @vite-ignore */ path);
		const idempotencyKey = `${baseKey}-remove`;
		const originalNow = Date.now;
		Date.now = () => Date.UTC(2026, 9, 2, 1, 0);
		try {
			await queue.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'done',
				expected_revision: 0,
				userId: 'uat-pemilik-samarinda'
			});
			const old = (await queue.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			await queue.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'pending',
				expected_revision: 0,
				userId: 'uat-pemilik-samarinda'
			});
			const removed = await queue.removeStatusIntent('samarinda', idempotencyKey, {
				target: old.target,
				updated_at: old.updated_at,
				intent_id: old.intent_id,
				expected_revision: old.expected_revision
			});
			const current = (await queue.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			return {
				removed,
				target: current?.target,
				replaced: current?.intent_id !== old.intent_id
			};
		} finally {
			Date.now = originalNow;
		}
	}, key);
	expect(staleRemoval).toEqual({ removed: false, target: 'pending', replaced: true });
});

test('legacy status intent without a token is staged and replayed', async ({ page }) => {
	await loginAsOwner(page);
	const order = await checkoutUatOrder(page, `UAT legacy intent ${Date.now()}`);
	let staged: {
		idempotency_key: string;
		intent_id: string;
		target: string;
		expected_revision: number;
	} | null = null;
	const posts: Array<{ idempotency_key: string; target: string; expected_revision: number }> = [];
	try {
		const key = await page.evaluate(async (transactionId) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			const row = payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === transactionId
			);
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			const branch = session.getOfflineSessionBranch(snapshot);
			if (!row || !branch || branch !== 'samarinda')
				throw new Error('Legacy fixture scope is invalid');
			await local.loadStatusIntents(branch);
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('zatiaras-queue-v1');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const legacy = {
				branch,
				idempotency_key: row.idempotency_key,
				target: 'done',
				expected_revision: 0,
				userId: user?.id || user?.username || '',
				updated_at: Date.UTC(2026, 9, 2, 1, 0)
			};
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction('order-queue', 'readwrite');
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
				transaction.objectStore('order-queue').put([legacy], `antrean-intents:${branch}`);
			});
			database.close();
			return row.idempotency_key as string;
		}, order.transactionId);
		await page.route('**/api/antrean/status', async (route) => {
			posts.push(route.request().postDataJSON() as (typeof posts)[number]);
			const local = await page.evaluate(async (idempotencyKey) => {
				const queue = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
				return (await queue.loadStatusIntents('samarinda')).find(
					(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
				);
			}, key);
			staged = local?.in_flight ?? null;
			await route.continue();
		});
		await page.goto('/antrean');
		await expect
			.poll(() =>
				page.evaluate(async (idempotencyKey) => {
					const response = await fetch('/api/antrean?state=done&limit=100');
					const payload = await response.json();
					const row = payload.data.items.find(
						(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
					);
					return row ? `${row.preparation_state}:${row.preparation_revision}` : 'not-committed';
				}, key)
			)
			.toBe('done:1');
		expect(posts).toEqual([{ idempotency_key: key, target: 'done', expected_revision: 0 }]);
		expect(staged).toMatchObject({
			idempotency_key: key,
			target: 'done',
			expected_revision: 0
		});
		expect(staged?.intent_id).toBeTruthy();
		const remaining = await page.evaluate(async () => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			return await local.loadStatusIntents('samarinda');
		});
		expect(remaining).toHaveLength(0);
	} finally {
		await page.unroute('**/api/antrean/status').catch(() => {});
		await cleanupTransaction(page, order.transactionId);
	}
});

test('POS recovery trusts the verified session branch, not selectedBranch', async ({ page }) => {
	await loginAsOwner(page);
	let postCount = 0;
	await page.route('**/api/pos/transaction', async (route) => {
		postCount++;
		await route.fulfill({ status: 503, json: { message: 'Unexpected foreign branch replay' } });
	});
	const fixture = await page.evaluate(async () => {
		const offlinePath = '/src/lib/utils/offline.ts';
		const sessionPath = '/src/lib/auth/offlineSession.ts';
		const offline = await import(/* @vite-ignore */ offlinePath);
		const session = await import(/* @vite-ignore */ sessionPath);
		const previousBranch = localStorage.getItem('selectedBranch');
		await offline.addPendingTransaction(
			{
				queue_id: 'antrean-scope-fixture',
				type: 'pos_transaction',
				branch: 'balikpapan',
				status: 'failed',
				failure_kind: 'auth',
				request: { idempotency_key: 'antrean-scope-fixture-key' },
				receipt: { items: [] }
			},
			'balikpapan'
		);
		localStorage.setItem('selectedBranch', 'balikpapan');
		return {
			previousBranch,
			sessionBranch: session.getOfflineSessionBranch(session.readOfflineSessionSnapshot())
		};
	});
	try {
		expect(fixture.sessionBranch).toBe('samarinda');
		await page.evaluate(async () => {
			const changed = new Promise<void>((resolve) =>
				window.addEventListener('pending-changed', () => resolve(), { once: true })
			);
			window.dispatchEvent(new Event('auth-session-refreshed'));
			await changed;
		});
		await page.evaluate(async () => {
			const path = '/src/lib/services/offlineSync.ts';
			const sync = await import(/* @vite-ignore */ path);
			await sync.syncPendingTransactions({ force: true });
		});
		const pending = await page.evaluate(async () => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			const queue = await offline.getPendingTransactions();
			return queue.find((item: { queue_id: string }) => item.queue_id === 'antrean-scope-fixture');
		});
		expect(postCount).toBe(0);
		expect(pending).toMatchObject({
			branch: 'balikpapan',
			status: 'failed',
			failure_kind: 'auth'
		});
	} finally {
		await page.evaluate(async (previousBranch) => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			await offline.removePendingTransaction('antrean-scope-fixture');
			if (previousBranch === null) localStorage.removeItem('selectedBranch');
			else localStorage.setItem('selectedBranch', previousBranch);
		}, fixture.previousBranch);
		await page.unroute('**/api/pos/transaction');
	}
});
test('POS replay stops after the verified session branch changes mid-flight', async ({ page }) => {
	await loginAsOwner(page);
	let postCount = 0;
	let releaseFirstRequest!: () => void;
	let resolveFirstRequest!: () => void;
	const firstRequest = new Promise<void>((resolve) => {
		resolveFirstRequest = resolve;
	});
	const releaseResponse = new Promise<void>((resolve) => {
		releaseFirstRequest = resolve;
	});
	await page.route('**/api/pos/transaction', async (route) => {
		postCount++;
		if (postCount === 1) {
			resolveFirstRequest();
			await releaseResponse;
		}
		await route.fulfill({ status: 503, json: { message: 'Fixture replay outage' } });
	});
	const previousSession = await page.evaluate(() => localStorage.getItem('zatiaras_session'));
	const fixtureIds = ['antrean-scope-flight-1', 'antrean-scope-flight-2'];
	let replay: Promise<void> | undefined;
	try {
		await page.evaluate(async (queueIds) => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			for (const queueId of queueIds) {
				await offline.addPendingTransaction(
					{
						queue_id: queueId,
						type: 'pos_transaction',
						branch: 'samarinda',
						status: 'pending',
						request: { idempotency_key: `${queueId}-key` }
					},
					'samarinda'
				);
			}
		}, fixtureIds);
		replay = page.evaluate(async () => {
			const path = '/src/lib/services/offlineSync.ts';
			const sync = await import(/* @vite-ignore */ path);
			await sync.syncPendingTransactions({ force: true });
		});
		await firstRequest;
		await page.evaluate(async () => {
			const path = '/src/lib/auth/offlineSession.ts';
			const session = await import(/* @vite-ignore */ path);
			const snapshot = session.readOfflineSessionSnapshot();
			if (!snapshot) throw new Error('Offline session snapshot missing');
			session.persistOfflineSessionSnapshot(
				{ ...snapshot.user, branch: 'balikpapan' },
				snapshot.expiresAt
			);
		});
		releaseFirstRequest();
		await replay;
		const queue = await page.evaluate(async (queueIds) => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			return (await offline.getPendingTransactions()).filter((item: { queue_id: string }) =>
				queueIds.includes(item.queue_id)
			);
		}, fixtureIds);
		expect(postCount).toBe(1);
		expect(queue).toMatchObject([
			{ queue_id: fixtureIds[0], status: 'failed', failure_kind: 'server' },
			{ queue_id: fixtureIds[1], status: 'pending', attempt_count: 0 }
		]);
	} finally {
		releaseFirstRequest();
		await page.evaluate(
			async ({ queueIds, sessionValue }) => {
				const path = '/src/lib/utils/offline.ts';
				const offline = await import(/* @vite-ignore */ path);
				for (const queueId of queueIds) await offline.removePendingTransaction(queueId);
				if (sessionValue === null) localStorage.removeItem('zatiaras_session');
				else localStorage.setItem('zatiaras_session', sessionValue);
			},
			{ queueIds: fixtureIds, sessionValue: previousSession }
		);
		await page.unroute('**/api/pos/transaction');
	}
});

test('search keeps pagination reachable when only the next page matches', async ({ page }) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(50);
	await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
	const search = page.getByPlaceholder('Cari nama / nomor, misal 001 haura...');
	await search.fill('Pelanggan fixture 51');
	await expect(page.locator('article')).toHaveCount(0);
	await expect(page.getByText('Tidak ada yang cocok', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
	await expect(search).toHaveValue('Pelanggan fixture 51');
	await expect(page.locator('article', { hasText: 'Pelanggan fixture 51' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(search).toHaveCount(0);
	await expect(page.locator('article')).toHaveCount(51);
});

test('empty status recovery preserves appended queue pages and offline snapshot', async ({
	page
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(50);
	const result = await page.evaluate(async () => {
		const { createOrderQueueState } = await import(
			/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts'
		);
		const { loadQueueSnapshot } = await import(
			/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts'
		);
		const { readOfflineSessionSnapshot } = await import(
			/* @vite-ignore */ '/src/lib/auth/offlineSession.ts'
		);
		const queue = createOrderQueueState();
		const session = localStorage.getItem('zatiaras_session');
		if (!session) throw new Error('Verified session snapshot is missing');
		localStorage.removeItem('zatiaras_session');
		try {
			await queue.load();
		} finally {
			localStorage.setItem('zatiaras_session', session);
		}
		const cold = queue.items.map((card) => card.idempotency_key);
		await queue.retryStatusSync();
		const recovered = queue.items.map((card) => card.idempotency_key);
		await queue.loadMore();
		const before = queue.items.map((card) => card.idempotency_key);
		await queue.retryStatusSync();
		const userId = readOfflineSessionSnapshot()?.user?.id;
		const cached = userId ? await loadQueueSnapshot('samarinda', userId) : null;
		return {
			cold,
			recovered,
			before,
			after: queue.items.map((card) => card.idempotency_key),
			cached: cached?.items.map((card) => card.idempotency_key)
		};
	});
	expect(result.cold).toEqual([]);
	expect(result.recovered).toHaveLength(50);
	expect(result.recovered).toEqual(result.before.slice(0, 50));
	expect(result.before).toHaveLength(51);
	expect(result.after).toEqual(result.before);
	expect(result.cached).toEqual(result.before);
});

test('appended queue snapshot survives offline reload and updates the device badge', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(50);
	await page.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
	await expect(page.locator('article')).toHaveCount(51);

	const productionPwa = process.env.E2E_PWA_MODE === '1';
	if (productionPwa) {
		await expect
			.poll(() =>
				page.evaluate(async () =>
					Boolean((await navigator.serviceWorker.getRegistration())?.active)
				)
			)
			.toBe(true);
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
			.toBe(true);
		await expect(page.locator('article')).toHaveCount(50);
		await page.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
		await expect(page.locator('article')).toHaveCount(51);
	}

	try {
		await context.setOffline(true);
		if (productionPwa) {
			await page.reload();
		} else {
			await page.getByRole('tab', { name: /^Belum selesai/ }).click();
		}
		await expect(page.locator('article')).toHaveCount(51);
		await expect(
			page.getByText('51 pesanan belum selesai tersimpan di perangkat ini')
		).toBeVisible();
		await expect(
			page.getByRole('status', { name: '51 pesanan belum selesai dari data perangkat' })
		).toBeVisible();
		await page
			.locator('article', { hasText: 'Pelanggan fixture 1' })
			.first()
			.getByRole('button', { name: /tandai selesai/i })
			.click();
		await expect(
			page.getByText('50 pesanan belum selesai tersimpan di perangkat ini')
		).toBeVisible();
		await expect(
			page.getByRole('status', { name: '50 pesanan belum selesai dari data perangkat' })
		).toBeVisible();
	} finally {
		await context.setOffline(false);
	}
});

test('queue badge switches to its cached source when the browser goes offline', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page, 2);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(2);
	const initialBadge = await page.evaluate(async () => {
		const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
		await state.orderQueueBadge.refresh();
		return { count: state.orderQueueBadge.count, source: state.orderQueueBadge.countSource };
	});
	expect(initialBadge).toEqual({ count: 2, source: 'server' });
	await expect(page.getByText('2 pesanan belum selesai', { exact: true })).toBeVisible();
	await expect(page.getByRole('status', { name: '2 pesanan belum selesai' })).toBeVisible();
	try {
		await context.setOffline(true);
		await expect(
			page.getByText('2 pesanan belum selesai tersimpan di perangkat ini', { exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('status', { name: '2 pesanan belum selesai dari data perangkat' })
		).toBeVisible();
	} finally {
		await context.setOffline(false);
	}
});

test('zero cached pending orders never claim the server queue is complete', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page, 2);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(2);
	await expect(page.getByText('2 pesanan belum selesai', { exact: true })).toBeVisible();

	try {
		await context.setOffline(true);
		await expect(
			page.getByText('2 pesanan belum selesai tersimpan di perangkat ini', { exact: true })
		).toBeVisible();
		for (const customer of ['Pelanggan fixture 1', 'Pelanggan fixture 2']) {
			await page
				.locator('article', { hasText: customer })
				.getByRole('button', { name: /tandai selesai/i })
				.click();
		}
		await expect(
			page.getByText('0 pesanan belum selesai tersimpan di perangkat ini', { exact: true })
		).toBeVisible();
		await expect(page.getByText('Semua pesanan beres', { exact: true })).toHaveCount(0);
		await expect(
			page.getByRole('status', { name: '0 pesanan belum selesai dari data perangkat' })
		).toBeVisible();
	} finally {
		await context.setOffline(false);
	}
});

test('a stale badge count is reconciled with the latest cache and deduplicated local order', async ({
	page
}) => {
	await loginAsOwner(page);
	let first: UatOrder | undefined;
	let second: UatOrder | undefined;
	let releaseStale: (() => Promise<void>) | undefined;
	let overlayAdded = false;
	let staleResponseCount: number | undefined;
	let markStaleReady!: () => void;
	const staleReady = new Promise<void>((resolve) => {
		markStaleReady = resolve;
	});
	const overlayId = `badge-overlay-${Date.now()}`;
	try {
		first = await checkoutUatOrder(page, `UAT badge first ${Date.now()}`);
		second = await checkoutUatOrder(page, `UAT badge second ${Date.now()}`);
		await page.goto('/antrean');
		await expect(page.locator('article', { hasText: first.customer })).toBeVisible();
		await expect(page.locator('article', { hasText: second.customer })).toBeVisible();
		const orders = await page.evaluate(async () => {
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			return payload.data.items.map(
				(item: {
					idempotency_key: string;
					nama_pelanggan: string;
					preparation_revision: number;
				}) => ({
					key: item.idempotency_key,
					customer: item.nama_pelanggan,
					revision: item.preparation_revision
				})
			);
		});
		const firstOrder = orders.find(
			(order: { customer: string }) => order.customer === first?.customer
		);
		const secondOrder = orders.find(
			(order: { customer: string }) => order.customer === second?.customer
		);
		expect(firstOrder).toBeTruthy();
		expect(secondOrder).toBeTruthy();
		const firstKey = firstOrder!.key as string;
		const secondKey = secondOrder!.key as string;
		expect(secondKey).toBeTruthy();
		const settled = await page.evaluate(async () => {
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			await state.orderQueueBadge.refresh();
			return { count: state.orderQueueBadge.count, source: state.orderQueueBadge.countSource };
		});
		expect(settled).toEqual({ count: 2, source: 'server' });

		await page.route('**/api/antrean?*', async (route) => {
			const url = new URL(route.request().url());
			if (staleResponseCount !== undefined || url.searchParams.get('limit') !== '1') {
				await route.continue();
				return;
			}
			const response = await route.fetch();
			const body = await response.body();
			const payload = JSON.parse(body.toString('utf8'));
			staleResponseCount = payload.data.pending_count;
			markStaleReady();
			await new Promise<void>((resolve) => {
				releaseStale = async () => {
					releaseStale = undefined;
					await route.fulfill({ response, body });
					resolve();
				};
			});
		});
		await page.evaluate(async () => {
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			void state.orderQueueBadge.refresh();
		});
		await staleReady;
		expect(staleResponseCount).toBe(2);
		const committed = await page.evaluate(
			async ({ key, revision }) => {
				const csrfResponse = await fetch('/api/csrf');
				const csrf = await csrfResponse.json();
				if (!csrfResponse.ok || !csrf.token) return csrfResponse.status;
				const response = await fetch('/api/antrean/status', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
					body: JSON.stringify({
						idempotency_key: key,
						target: 'done',
						expected_revision: revision
					})
				});
				return response.status;
			},
			{ key: firstKey, revision: firstOrder!.revision }
		);
		expect(committed).toBe(200);

		await page.evaluate(
			async ({ id, key, customer }) => {
				const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
				await offline.addPendingTransaction(
					{
						queue_id: id,
						type: 'pos_transaction',
						branch: 'samarinda',
						status: 'failed',
						failure_kind: 'auth',
						request: { idempotency_key: key, nama_pelanggan: customer },
						receipt: {
							total_amount: 10000,
							items: [{ nama: 'Es Teh UAT', jumlah: 1, harga: 10000, nominal: 10000 }]
						},
						summary: { created_at: '2026-10-02T01:00:00.000Z' }
					},
					'samarinda'
				);
			},
			{ id: overlayId, key: secondKey!, customer: second.customer }
		);
		overlayAdded = true;
		await expect(page.locator('article', { hasText: first.customer })).toHaveCount(1);
		await page.getByRole('button', { name: 'Muat ulang Antrean', exact: true }).click();
		await expect(page.locator('article')).toHaveCount(1);
		await expect(page.locator('article', { hasText: second.customer })).toBeVisible();

		await releaseStale?.();
		const reconciled = await page.evaluate(async () => {
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			await state.orderQueueBadge.refresh();
			return { count: state.orderQueueBadge.count, source: state.orderQueueBadge.countSource };
		});
		expect(reconciled).toEqual({ count: 1, source: 'cached' });
		await expect(
			page.getByRole('status', { name: '1 pesanan belum selesai dari data perangkat' })
		).toBeVisible();

		await page.evaluate(async (id) => {
			const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
			await offline.removePendingTransaction(id);
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			await state.orderQueueBadge.refresh();
		}, overlayId);
		overlayAdded = false;
		const serverCount = await page.evaluate(async () => {
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
			const response = await fetch('/api/antrean?state=pending&limit=1');
			const payload = await response.json();
			const intents = await local.loadStatusIntents('samarinda');
			const pending = await offline.getPendingTransactions();
			return {
				count: state.orderQueueBadge.count,
				source: state.orderQueueBadge.countSource,
				online: navigator.onLine,
				serverCount: payload.data.pending_count,
				intents: intents.map((intent: { idempotency_key: string; target: string }) => ({
					key: intent.idempotency_key,
					target: intent.target
				})),
				pending: pending.map((item: { queue_id: string; failure_kind?: string | null }) => ({
					queue_id: item.queue_id,
					failure_kind: item.failure_kind
				}))
			};
		});
		expect(serverCount.online).toBe(true);
		expect(serverCount.count).toBe(1);
		expect(serverCount.serverCount).toBe(1);
		expect(serverCount.intents).toEqual([]);
		expect(serverCount.pending).toEqual([]);
		expect(serverCount.source).toBe('server');
	} finally {
		await releaseStale?.();
		await page.unroute('**/api/antrean?*').catch(() => {});
		if (overlayAdded) {
			await page.evaluate(async (id) => {
				const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
				await offline.removePendingTransaction(id);
			}, overlayId);
		}
		if (first) await cleanupTransaction(page, first.transactionId);
		if (second) await cleanupTransaction(page, second.transactionId);
	}
});

test('401 status replay keeps the session error instead of a transient retry message', async ({
	page
}) => {
	await loginAsOwner(page);
	const order = await checkoutUatOrder(page, `UAT status auth failure ${Date.now()}`);
	const posts: Array<{ idempotency_key: string; target: string; expected_revision: number }> = [];
	try {
		await page.route('**/api/antrean/status', async (route) => {
			posts.push(route.request().postDataJSON() as (typeof posts)[number]);
			await route.fulfill({ status: 401, json: { message: 'Login diperlukan' } });
		});
		await page.goto('/antrean');
		const pendingCard = page.locator('article', { hasText: order.customer });
		await expect(pendingCard).toBeVisible();
		await pendingCard.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(page.getByRole('tab', { name: /^Selesai/ })).toBeVisible();
		await page.getByRole('tab', { name: /^Selesai/ }).click();
		const completedCard = page.locator('article', { hasText: order.customer });
		await expect(completedCard).toBeVisible();
		await expect(completedCard.getByText('Belum tersinkron', { exact: true })).toBeVisible();
		await expect(
			page.getByText('Masuk kembali saat online untuk menyinkronkan status pesanan.', {
				exact: true
			})
		).toBeVisible();
		expect(posts).toContainEqual({
			idempotency_key: expect.any(String),
			target: 'done',
			expected_revision: 0
		});
		const retained = await page.evaluate(async () => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			return await local.loadStatusIntents('samarinda');
		});
		expect(retained).toHaveLength(1);
	} finally {
		await page.unroute('**/api/antrean/status').catch(() => {});
		await cleanupTransaction(page, order.transactionId);
	}
});

test('failed status, checkout gate, and offline mount recovery retain durable orders', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	let transactionId = '';
	let gateTransactionId = '';
	let mountTransactionId = '';
	let recoveryPage: Page | undefined;
	try {
		const order = await checkoutUatOrder(page, 'UAT recovery fixture');
		transactionId = order.transactionId;
		await page.route('**/api/antrean/status', (route) =>
			route.fulfill({ status: 503, json: { message: 'Injected temporary outage' } })
		);
		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await page
			.locator('article', { hasText: order.customer })
			.getByRole('button', { name: /tandai selesai/i })
			.click();
		await expect(
			page.getByText(
				'Sebagian status belum tersinkron. Tekan Sinkronkan status untuk mencoba lagi.'
			)
		).toBeVisible();
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const card = page.locator('article', { hasText: order.customer });
		await expect(card).toBeVisible();
		await expect(card.getByText('Belum tersinkron', { exact: true })).toBeVisible();
		await expect(card.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(card.getByText('Total Rp10.000')).toBeVisible();
		await page.reload();
		await expect(
			page.getByText(
				'Sebagian status belum tersinkron. Tekan Sinkronkan status untuk mencoba lagi.'
			)
		).toBeVisible();
		const doneTab = page.getByRole('tab', { name: 'Selesai', exact: true });
		await doneTab.click();
		await expect(doneTab).toHaveAttribute('aria-selected', 'true');
		await expect(card).toBeVisible();
		await page.unroute('**/api/antrean/status');
		await page
			.getByRole('button', { name: 'Sinkronkan ulang status pesanan', exact: true })
			.click();
		await expect(card.getByText('Belum tersinkron', { exact: true })).toHaveCount(0);
		const committed = await page.evaluate(async (id) => {
			const response = await fetch('/api/antrean?state=done&limit=100');
			const result = await response.json();
			return result.data.items.find((row: { transaction_id: string }) => row.transaction_id === id);
		}, transactionId);
		expect(committed.preparation_state).toBe('done');
		expect(committed.preparation_revision).toBe(1);
		const gateOrder = await checkoutUatOrder(page, `UAT checkout gate ${Date.now()}`);
		gateTransactionId = gateOrder.transactionId;
		const gate = await page.evaluate(async (id) => {
			const queueResponse = await fetch('/api/antrean?state=pending&limit=100');
			const queuePayload = await queueResponse.json();
			const row = queuePayload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === id
			);
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			const queueId = `antrean-checkout-gate-${id}`;
			await offline.addPendingTransaction(
				{
					queue_id: queueId,
					type: 'pos_transaction',
					branch: 'samarinda',
					status: 'failed',
					failure_kind: 'auth',
					request: { idempotency_key: row.idempotency_key },
					receipt: { items: [{ nama: 'Jus fixture', jumlah: 1 }] }
				},
				'samarinda'
			);
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: row.idempotency_key,
				target: 'done',
				expected_revision: 0,
				userId: user?.id || user?.username || ''
			});
			const waiting = await sync.syncOrderStatusIntents('samarinda');
			const retained = await local.loadStatusIntents('samarinda');
			await offline.removePendingTransaction(queueId);
			const replayed = await sync.syncOrderStatusIntents('samarinda');
			const remaining = await local.loadStatusIntents('samarinda');
			return {
				key: row.idempotency_key,
				waiting,
				retained: retained.some(
					(intent: { idempotency_key: string }) => intent.idempotency_key === row.idempotency_key
				),
				replayed,
				remaining: remaining.some(
					(intent: { idempotency_key: string }) => intent.idempotency_key === row.idempotency_key
				)
			};
		}, gateTransactionId);
		expect(gate.waiting).toEqual({ synced: 0, failed: 0, conflicts: 0 });
		expect(gate.retained).toBe(true);
		expect(gate.replayed).toEqual({ synced: 1, failed: 0, conflicts: 0 });
		expect(gate.remaining).toBe(false);
		const gateCommit = await page.evaluate(async (key) => {
			const response = await fetch('/api/antrean?state=done&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { idempotency_key: string }) => item.idempotency_key === key
			);
		}, gate.key);
		expect(gateCommit).toMatchObject({ preparation_state: 'done', preparation_revision: 1 });
		const mountOrder = await checkoutUatOrder(page, `UAT mount recovery ${Date.now()}`);
		mountTransactionId = mountOrder.transactionId;
		const mountKey = await page.evaluate(async (id) => {
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === id
			).idempotency_key as string;
		}, mountTransactionId);
		await page.goto('/antrean');
		const mountCard = page.locator('article', { hasText: mountOrder.customer });
		await expect(mountCard).toBeVisible();
		await context.setOffline(true);
		await mountCard.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(
			page.getByText('Status tersimpan di perangkat ini.', { exact: false })
		).toBeVisible();
		const offlineIntent = await page.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			return { target: intent?.target, inFlight: intent?.in_flight };
		}, mountKey);
		expect(offlineIntent).toEqual({ target: 'done', inFlight: undefined });
		await page.close();
		await context.setOffline(false);
		recoveryPage = await context.newPage();
		await recoveryPage.goto('/antrean');
		await expect
			.poll(() =>
				recoveryPage!.evaluate(async (idempotencyKey) => {
					const response = await fetch('/api/antrean?state=done&limit=100');
					const payload = await response.json();
					const row = payload.data.items.find(
						(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
					);
					return row ? `${row.preparation_state}:${row.preparation_revision}` : 'not-committed';
				}, mountKey)
			)
			.toBe('done:1');
		await recoveryPage.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const recoveredCard = recoveryPage.locator('article', { hasText: mountOrder.customer });
		await expect(recoveredCard).toBeVisible();
		await expect(recoveredCard.getByText('Belum tersinkron', { exact: true })).toHaveCount(0);
		const remainingIntents = await recoveryPage.evaluate(async () => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			return (await local.loadStatusIntents('samarinda')).length;
		});
		expect(remainingIntents).toBe(0);
	} finally {
		await context.setOffline(false);
		const cleanupPage = recoveryPage && !recoveryPage.isClosed() ? recoveryPage : page;
		if (!page.isClosed()) await page.unroute('**/api/antrean/status');
		if (gateTransactionId) {
			await cleanupPage.evaluate(async (id) => {
				const offline = await import(/* @vite-ignore */ '/src/lib/utils/offline.ts');
				await offline.removePendingTransaction(`antrean-checkout-gate-${id}`);
			}, gateTransactionId);
			await cleanupTransaction(cleanupPage, gateTransactionId);
		}
		if (mountTransactionId) await cleanupTransaction(cleanupPage, mountTransactionId);
		if (transactionId) await cleanupTransaction(cleanupPage, transactionId);
	}
});

test('latest target waits for staged predecessor before the original request commits', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	const order = await checkoutUatOrder(page, `UAT staged predecessor ${Date.now()}`);
	let releaseFirstRequest!: () => void;
	let signalFirstRequest!: () => void;
	let signalFirstResponse!: () => void;
	let releaseSecondRequest!: () => void;
	let signalSecondRequest!: () => void;
	let signalSecondResponse!: () => void;
	const holdFirstRequest = new Promise<void>((resolve) => (releaseFirstRequest = resolve));
	const firstRequest = new Promise<void>((resolve) => (signalFirstRequest = resolve));
	const firstResponse = new Promise<void>((resolve) => (signalFirstResponse = resolve));
	const holdSecondRequest = new Promise<void>((resolve) => (releaseSecondRequest = resolve));
	const secondRequest = new Promise<void>((resolve) => (signalSecondRequest = resolve));
	const secondResponse = new Promise<void>((resolve) => (signalSecondResponse = resolve));
	const firstPosts: Array<{ idempotency_key: string; target: string; expected_revision: number }> =
		[];
	const secondPosts: Array<{ idempotency_key: string; target: string; expected_revision: number }> =
		[];
	let firstResponseStatus = 0;
	let firstRouteStarted = false;
	let secondRouteStarted = false;
	let secondTab: Page | undefined;
	try {
		await page.goto('/antrean');
		const card = page.locator('article', { hasText: order.customer });
		await expect(card).toBeVisible();
		await page.route('**/api/antrean/status', async (route) => {
			firstPosts.push(route.request().postDataJSON() as (typeof firstPosts)[number]);
			if (firstPosts.length === 1) {
				firstRouteStarted = true;
				signalFirstRequest();
				await holdFirstRequest;
			}
			try {
				const response = await route.fetch();
				firstResponseStatus = response.status();
				await route.fulfill({ response });
			} finally {
				signalFirstResponse();
			}
		});
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await firstRequest;
		expect(firstPosts[0]).toMatchObject({ target: 'done', expected_revision: 0 });
		const stagedBeforeCommit = await page.evaluate(async (transactionId) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			const key = payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === transactionId
			).idempotency_key;
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === key
			);
			const row = payload.data.items.find(
				(item: { idempotency_key: string }) => item.idempotency_key === key
			);
			return {
				serverRevision: row.preparation_revision,
				serverState: row.preparation_state,
				desiredTarget: intent?.target,
				stagedTarget: intent?.in_flight?.target,
				stagedRevision: intent?.in_flight?.expected_revision,
				key
			};
		}, order.transactionId);
		expect(stagedBeforeCommit).toMatchObject({
			serverRevision: 0,
			serverState: 'pending',
			desiredTarget: 'done',
			stagedTarget: 'done',
			stagedRevision: 0
		});

		secondTab = await context.newPage();
		await secondTab.goto('/login');
		await secondTab.route('**/api/antrean/status', async (route) => {
			secondPosts.push(route.request().postDataJSON() as (typeof secondPosts)[number]);
			if (secondPosts.length === 1) {
				secondRouteStarted = true;
				signalSecondRequest();
				await holdSecondRequest;
			}
			try {
				await route.continue();
			} finally {
				signalSecondResponse();
			}
		});
		const secondSync = secondTab.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			const existing = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'pending',
				expected_revision: 0,
				userId: user?.id || user?.username || '',
				card: existing?.card
			});
			return await sync.syncOrderStatusIntents('samarinda');
		}, stagedBeforeCommit.key);
		await secondRequest;
		expect(secondPosts[0]).toMatchObject({
			idempotency_key: stagedBeforeCommit.key,
			target: 'done',
			expected_revision: 0
		});
		const stillPending = await page.evaluate(async (key) => {
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { idempotency_key: string }) => item.idempotency_key === key
			);
		}, stagedBeforeCommit.key);
		expect(stillPending).toMatchObject({
			preparation_state: 'pending',
			preparation_revision: 0
		});

		releaseSecondRequest();
		const syncResult = await secondSync;
		await secondResponse;
		expect(syncResult).toEqual({ synced: 2, failed: 0, conflicts: 0 });
		expect(secondPosts).toEqual([
			{
				idempotency_key: stagedBeforeCommit.key,
				target: 'done',
				expected_revision: 0
			},
			{
				idempotency_key: stagedBeforeCommit.key,
				target: 'pending',
				expected_revision: 1
			}
		]);
		const finalState = await page.evaluate(async (key) => {
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { idempotency_key: string }) => item.idempotency_key === key
			);
		}, stagedBeforeCommit.key);
		expect(finalState).toMatchObject({
			preparation_state: 'pending',
			preparation_revision: 2
		});
		const remainingIntents = await secondTab.evaluate(async () => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			return await local.loadStatusIntents('samarinda');
		});
		expect(remainingIntents).toHaveLength(0);

		releaseFirstRequest();
		await firstResponse;
		expect(firstResponseStatus).toBe(409);
	} finally {
		releaseFirstRequest();
		releaseSecondRequest();
		if (firstRouteStarted) await firstResponse;
		if (secondRouteStarted) await secondResponse;
		await page.unroute('**/api/antrean/status').catch(() => {});
		if (secondTab) {
			await secondTab.unroute('**/api/antrean/status').catch(() => {});
			await secondTab.close();
		}
		await cleanupTransaction(page, order.transactionId);
	}
});

test('latest status from another tab survives a committed request with a lost response', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	const order = await checkoutUatOrder(page, `UAT cross tab ${Date.now()}`);
	let firstCommitStatus = 0;
	let firstResponsePending = false;
	let signalFirstCommit!: () => void;
	let releaseFirstResponse!: () => void;
	let signalFirstResponseHandled!: () => void;
	const firstCommit = new Promise<void>((resolve) => (signalFirstCommit = resolve));
	const holdFirstResponse = new Promise<void>((resolve) => (releaseFirstResponse = resolve));
	const firstResponseHandled = new Promise<void>(
		(resolve) => (signalFirstResponseHandled = resolve)
	);
	let secondTab: Page | undefined;
	let secondResponsePending = false;
	let signalSecondRequest!: () => void;
	let releaseSecondRequest!: () => void;
	let signalSecondResponseHandled!: () => void;
	const secondRequest = new Promise<void>((resolve) => (signalSecondRequest = resolve));
	const holdSecondRequest = new Promise<void>((resolve) => (releaseSecondRequest = resolve));
	const secondResponseHandled = new Promise<void>(
		(resolve) => (signalSecondResponseHandled = resolve)
	);
	const secondPosts: Array<{ idempotency_key: string; target: string; expected_revision: number }> =
		[];
	try {
		const key = await page.evaluate(async (id) => {
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === id
			).idempotency_key as string;
		}, order.transactionId);
		await page.goto('/antrean');
		const originalCard = page.locator('article', { hasText: order.customer });
		await expect(originalCard).toBeVisible();
		await page.route('**/api/antrean/status', async (route) => {
			firstResponsePending = true;
			const response = await route.fetch();
			firstCommitStatus = response.status();
			signalFirstCommit();
			await holdFirstResponse;
			try {
				await route.fulfill({
					status: 502,
					json: { message: 'Injected response loss after commit' }
				});
			} finally {
				firstResponsePending = false;
				signalFirstResponseHandled();
			}
		});
		await originalCard.getByRole('button', { name: /tandai selesai/i }).click();
		await firstCommit;
		expect(firstCommitStatus).toBe(200);

		secondTab = await context.newPage();
		await secondTab.route('**/api/antrean/status', async (route) => {
			secondPosts.push(route.request().postDataJSON() as (typeof secondPosts)[number]);
			if (secondPosts.length === 1) {
				secondResponsePending = true;
				signalSecondRequest();
				await holdSecondRequest;
			}
			try {
				await route.continue();
			} finally {
				if (secondPosts.length === 1) {
					secondResponsePending = false;
					signalSecondResponseHandled();
				}
			}
		});
		await secondTab.goto('/');
		await secondTab.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'pending',
				expected_revision: 1,
				userId: user?.id || user?.username || ''
			});
			void sync.syncOrderStatusIntents('samarinda');
		}, key);
		await secondRequest;
		expect(secondPosts[0]).toMatchObject({
			idempotency_key: key,
			target: 'done',
			expected_revision: 0
		});
		const latestIntent = await secondTab.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			return { target: intent?.target, inFlightTarget: intent?.in_flight?.target };
		}, key);
		expect(latestIntent).toEqual({ target: 'pending', inFlightTarget: 'done' });

		releaseSecondRequest();
		await secondResponseHandled;
		await expect
			.poll(() =>
				page.evaluate(async (idempotencyKey) => {
					const response = await fetch('/api/antrean?state=pending&limit=100');
					const payload = await response.json();
					const item = payload.data.items.find(
						(row: { idempotency_key: string }) => row.idempotency_key === idempotencyKey
					);
					return item ? `${item.preparation_state}:${item.preparation_revision}` : 'not-pending';
				}, key)
			)
			.toBe('pending:2');

		// Retries in another tab may repeat the same idempotent POST; committed revision is the contract.
		releaseFirstResponse();
		await firstResponseHandled;
		await expect(
			page.getByText(
				'Sebagian status belum tersinkron. Tekan Sinkronkan status untuk mencoba lagi.'
			)
		).toBeVisible();
		const finalIntentCount = await page.evaluate(async () => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			return (await local.loadStatusIntents('samarinda')).length;
		});
		expect(finalIntentCount).toBe(0);
	} finally {
		releaseSecondRequest();
		releaseFirstResponse();
		if (secondResponsePending) await secondResponseHandled;
		if (firstResponsePending) await firstResponseHandled;
		await page.unroute('**/api/antrean/status').catch(() => {});
		if (secondTab) {
			await secondTab.unroute('**/api/antrean/status').catch(() => {});
			await secondTab.close();
		}
		await cleanupTransaction(page, order.transactionId);
	}
});

test('status flight drains an intent saved during its final IndexedDB reread', async ({ page }) => {
	await loginAsOwner(page);
	const first = await checkoutUatOrder(page, `UAT flight first ${Date.now()}`);
	const second = await checkoutUatOrder(page, `UAT flight second ${Date.now()}`);
	const transactionIds = [first.transactionId, second.transactionId];
	try {
		await page.evaluate(async (ids) => {
			const localPath = '/src/lib/utils/orderQueueLocal.ts';
			const sessionPath = '/src/lib/auth/offlineSession.ts';
			const syncPath = '/src/lib/services/orderQueueSync.ts';
			const statePath = '/src/lib/stores/orderQueueState.svelte.ts';
			const local = await import(/* @vite-ignore */ localPath);
			const session = await import(/* @vite-ignore */ sessionPath);
			const sync = await import(/* @vite-ignore */ syncPath);
			const state = await import(/* @vite-ignore */ statePath);
			await state.orderQueueBadge.refresh();
			state.orderQueueBadge.dispose();
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			const keys = ids.map(
				(id) =>
					payload.data.items.find((item: { transaction_id: string }) => item.transaction_id === id)
						.idempotency_key as string
			);
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			const userId = user?.id || user?.username || '';
			const originalGet = IDBObjectStore.prototype.get;
			let emptyReads = 0;
			IDBObjectStore.prototype.get = function (...args: Parameters<typeof originalGet>) {
				const request = originalGet.apply(this, args);
				if (
					this.name === 'order-queue' &&
					args[0] === 'antrean-intents:samarinda' &&
					this.transaction.mode === 'readonly'
				) {
					request.addEventListener(
						'success',
						() => {
							if (!Array.isArray(request.result) || request.result.length !== 0) return;
							emptyReads++;
							if (emptyReads !== 2) return;
							const root = window as Window & {
								finalIntentReadObserved?: boolean;
								finalIntentRace?: Promise<unknown>;
							};
							root.finalIntentReadObserved = true;
							const write = local.saveStatusIntent({
								branch: 'samarinda',
								idempotency_key: keys[1],
								target: 'done',
								expected_revision: 0,
								userId
							});
							const joined = sync.syncOrderStatusIntents('samarinda');
							root.finalIntentRace = Promise.all([write, joined]);
						},
						{ once: true }
					);
				}
				return request;
			};
			(window as Window & { restoreIntentRead?: () => void }).restoreIntentRead = () => {
				IDBObjectStore.prototype.get = originalGet;
			};
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: keys[0],
				target: 'done',
				expected_revision: 0,
				userId
			});
			const completion = sync.syncOrderStatusIntents('samarinda');
			(window as Window & { queueFlightCompletion?: Promise<unknown> }).queueFlightCompletion =
				completion;
		}, transactionIds);

		const result = await page.evaluate(async () => {
			const root = window as Window & {
				queueFlightCompletion?: Promise<unknown>;
				finalIntentRace?: Promise<unknown>;
				finalIntentReadObserved?: boolean;
			};
			return {
				completion: await root.queueFlightCompletion,
				race: await root.finalIntentRace,
				rereadObserved: root.finalIntentReadObserved
			};
		});
		expect(result.completion).toEqual({ synced: 2, failed: 0, conflicts: 0 });
		expect((result.race as unknown[])[1]).toEqual(result.completion);
		expect(result.rereadObserved).toBe(true);
		const committed = await page.evaluate(async (ids) => {
			const response = await fetch('/api/antrean?state=done&limit=100');
			const payload = await response.json();
			return ids.map((id) =>
				payload.data.items.find((item: { transaction_id: string }) => item.transaction_id === id)
			);
		}, transactionIds);
		expect(
			committed.map((row: { preparation_revision: number }) => row.preparation_revision)
		).toEqual([1, 1]);
		const intents = await page.evaluate(async () => {
			const localPath = '/src/lib/utils/orderQueueLocal.ts';
			const local = await import(/* @vite-ignore */ localPath);
			return await local.loadStatusIntents('samarinda');
		});
		expect(intents).toHaveLength(0);
	} finally {
		await page.evaluate(() => {
			(window as Window & { restoreIntentRead?: () => void }).restoreIntentRead?.();
		});
		await Promise.all(transactionIds.map((id) => cleanupTransaction(page, id)));
	}
});

test('IndexedDB transaction failures preserve cards and report an unknown device badge', async ({
	page
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page, 2);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(2);
	await page.evaluate(() => {
		const original = IDBDatabase.prototype.transaction;
		// Deliberately inject a real IndexedDB boundary failure, not a memory persistence mock.
		IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
			if (
				this.name === 'zatiaras-queue-v1' &&
				(typeof args[0] === 'string' ? args[0] === 'order-queue' : args[0].includes('order-queue'))
			) {
				throw new DOMException('Injected storage failure', 'InvalidStateError');
			}
			return original.apply(this, args);
		};
		(window as Window & { restoreQueueTransaction?: () => void }).restoreQueueTransaction = () => {
			IDBDatabase.prototype.transaction = original;
		};
	});
	try {
		await page
			.locator('article', { hasText: 'Pelanggan fixture 1' })
			.getByRole('button', { name: /tandai selesai/i })
			.click();
		await expect(
			page.getByText(
				'Penyimpanan perubahan status tidak dapat dibaca. Coba lagi tanpa menghapus data perangkat.'
			)
		).toBeVisible();
		await expect(page.locator('article', { hasText: 'Pelanggan fixture 1' })).toBeVisible();
		await expect(
			page
				.locator('article', { hasText: 'Pelanggan fixture 1' })
				.getByText('Belum tersinkron', { exact: true })
		).toHaveCount(0);
		const rejected = await page.evaluate(async () => {
			// Browser Vite boundary cannot be imported statically in the Node test runner.
			const path = '/src/lib/utils/orderQueueLocal.ts';
			const queue = await import(/* @vite-ignore */ path);
			try {
				await queue.loadStatusIntents('samarinda');
				return false;
			} catch {
				return true;
			}
		});
		expect(rejected).toBe(true);
		await page.evaluate(async () => {
			const state = await import(/* @vite-ignore */ '/src/lib/stores/orderQueueState.svelte.ts');
			await state.orderQueueBadge.refresh();
		});
		await expect(page.getByRole('status', { name: 'Jumlah antrean belum diketahui' })).toHaveText(
			'?'
		);
		await expect(page.getByRole('status', { name: /0 pesanan belum selesai/ })).toHaveCount(0);
	} finally {
		await page.evaluate(() =>
			(window as Window & { restoreQueueTransaction?: () => void }).restoreQueueTransaction?.()
		);
	}
});

test('completion metadata controls queue ordering and online projection is not capped', async ({
	page
}) => {
	await page.goto('/login');
	const result = await page.evaluate(async (fixtures) => {
		// Actual browser module boundary: this module uses the browser IndexedDB stores.
		const path = '/src/lib/utils/orderQueueLocal.ts';
		const queue = await import(/* @vite-ignore */ path);
		const doneRows = fixtures.map((row, index) => ({
			...row,
			preparation_state: 'done',
			preparation_completed_at: index < 2 ? '2026-10-02T05:00:00.000Z' : '2026-10-02T04:00:00.000Z'
		}));
		const doneOrder = queue
			.mergeQueueWithLocal(doneRows, [], [], 'samarinda', 'fixture-user')
			.map((card: { idempotency_key: string; waktu: string }) => ({
				key: card.idempotency_key,
				waktu: card.waktu
			}));
		const pendingRows = fixtures.slice(0, 3).map((row, index) => ({
			...row,
			waktu: index < 2 ? '2026-10-02T01:00:00.000Z' : '2026-10-02T01:01:00.000Z'
		}));
		const pendingOrder = queue
			.mergeQueueWithLocal(pendingRows, [], [], 'samarinda', 'fixture-user')
			.map((card: { idempotency_key: string }) => card.idempotency_key);
		const overlay = queue.mergeQueueWithLocal(
			[fixtures[0]],
			[],
			[
				{
					branch: 'samarinda',
					idempotency_key: fixtures[0].idempotency_key,
					target: 'done',
					expected_revision: 0,
					userId: 'fixture-user',
					updated_at: Date.UTC(2026, 9, 2, 10, 0)
				}
			],
			'samarinda',
			'fixture-user'
		)[0];
		return {
			doneOrder: doneOrder.slice(0, 3),
			doneLength: doneOrder.length,
			pendingOrder,
			overlay: {
				state: overlay.preparation_state,
				completedAt: overlay.preparation_completed_at,
				waktu: overlay.waktu,
				nominal: overlay.nominal
			}
		};
	}, queueFixtures(201));
	expect(result.doneOrder.map((row: { key: string }) => row.key)).toEqual([
		'antrean-fixture-0002',
		'antrean-fixture-0001',
		'antrean-fixture-0201'
	]);
	expect(result.doneLength).toBe(201);
	expect(result.doneOrder[0].waktu).toBe('2026-10-02T01:01:00.000Z');
	expect(result.pendingOrder).toEqual([
		'antrean-fixture-0001',
		'antrean-fixture-0002',
		'antrean-fixture-0003'
	]);
	expect(result.overlay).toEqual({
		state: 'done',
		completedAt: '2026-10-02T10:00:00.000Z',
		waktu: '2026-10-02T01:00:00.000Z',
		nominal: 10000
	});
});

test('online queue keeps 201 loaded rows while the offline snapshot caps at the oldest 200', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page, 201);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(50);
	for (const expectedCount of [100, 150, 200, 201]) {
		await page.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
		await expect(page.locator('article')).toHaveCount(expectedCount);
	}
	const snapshot = await page.evaluate(async () => {
		const queue = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
		const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
		const current = session.readOfflineSessionSnapshot();
		const user = current?.user as { id?: string; username?: string } | undefined;
		const userId = user?.id || user?.username || '';
		const saved = await queue.loadQueueSnapshot('samarinda', userId);
		return {
			pendingCount: saved?.pending_count,
			keys: saved?.items.map((item: { idempotency_key: string }) => item.idempotency_key) ?? []
		};
	});
	expect(snapshot.pendingCount).toBe(201);
	expect(snapshot.keys).toHaveLength(200);
	expect(snapshot.keys[0]).toBe('antrean-fixture-0001');
	expect(snapshot.keys.at(-1)).toBe('antrean-fixture-0200');
	await context.setOffline(true);
	try {
		await page.getByRole('tab', { name: /^Belum selesai/ }).click();
		await expect(page.locator('article')).toHaveCount(200);
		await expect(
			page.getByText('200 pesanan belum selesai tersimpan di perangkat ini')
		).toBeVisible();
		await expect(
			page.getByRole('status', { name: '200 pesanan belum selesai dari data perangkat' })
		).toHaveText('99+');
	} finally {
		await context.setOffline(false);
	}
});

test('obsolete pending response cannot replace a newer view or offline snapshot', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	let release: (() => Promise<void>) | undefined;
	let held = false;
	await page.route('**/api/antrean?*', async (route) => {
		const url = new URL(route.request().url());
		const old = !held && url.searchParams.get('limit') === '50';
		const items = old ? queueFixtures(1) : queueFixtures(2).slice(1);
		if (old) {
			held = true;
			await new Promise<void>((resolve) => {
				release = async () => {
					release = undefined;
					await route.fulfill({
						json: {
							ok: true,
							data: {
								items,
								pending_count: 1,
								hasMore: false,
								nextCursor: null
							}
						}
					});
					resolve();
				};
			});
		} else {
			await route.fulfill({
				json: {
					ok: true,
					data: {
						items,
						pending_count: 1,
						hasMore: false,
						nextCursor: null
					}
				}
			});
		}
	});
	try {
		await page.goto('/antrean');
		await expect.poll(() => Boolean(release)).toBe(true);
		await page.getByRole('button', { name: 'Muat ulang Antrean', exact: true }).click();
		await expect(page.locator('article', { hasText: 'Pelanggan fixture 2' })).toBeVisible();
		await release?.();
		await context.setOffline(true);
		await page.getByRole('button', { name: 'Muat ulang Antrean', exact: true }).click();
		await expect(page.locator('article', { hasText: 'Pelanggan fixture 2' })).toBeVisible();
		await expect(page.locator('article', { hasText: 'Pelanggan fixture 1' })).toHaveCount(0);
	} finally {
		await release?.();
		await context.setOffline(false);
	}
});
test('status staging storage failure waits for a new explicit retry', async ({ page }) => {
	await page.goto('/login');
	const key = `antrean-stage-storage-${Date.now()}`;
	let statusPosts = 0;
	let statusBody: unknown;
	const csrfRoute = async (route: import('@playwright/test').Route) => {
		await route.fulfill({ json: { ok: true, token: 'csrf-fixture' } });
	};
	const statusRoute = async (route: import('@playwright/test').Route) => {
		statusPosts++;
		statusBody = route.request().postDataJSON();
		await route.fulfill({ status: 503, json: { message: 'Injected retry outage' } });
	};
	await page.route('**/api/csrf', csrfRoute);
	await page.route('**/api/antrean/status', statusRoute);
	try {
		const failed = await page.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			session.persistOfflineSessionSnapshot(
				{
					id: 'uat-antrean-stage-storage',
					username: 'pemilik',
					role: 'pemilik',
					branch: 'samarinda'
				},
				Date.now() + 60_000
			);
			const card = {
				idempotency_key: idempotencyKey,
				buku_kas_id: `bk-${idempotencyKey}`,
				transaction_id: `transaction-${idempotencyKey}`,
				nominal: 10000,
				nomor_harian: 7,
				nama_pelanggan: 'Pelanggan staging failure',
				waktu: '2026-10-02T01:00:00.000Z',
				preparation_state: 'pending',
				preparation_revision: 0,
				preparation_completed_at: null,
				items: [
					{ nama: 'Jus fixture', jumlah: 1, gula: null, es: null, catatan: null, tambahan: [] }
				],
				unsynced: false
			};
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: idempotencyKey,
				target: 'done',
				expected_revision: 0,
				userId: 'uat-antrean-stage-storage',
				card
			});
			const original = IDBDatabase.prototype.transaction;
			let failures = 0;
			IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
				const names = Array.isArray(args[0]) ? args[0] : [args[0]];
				if (
					this.name === 'zatiaras-queue-v1' &&
					names.includes('order-queue') &&
					args[1] === 'readwrite' &&
					failures === 0
				) {
					failures++;
					throw new DOMException('Injected stage write failure', 'InvalidStateError');
				}
				return original.apply(this, args);
			};
			(window as Window & { restoreStageTransaction?: () => void }).restoreStageTransaction =
				() => {
					IDBDatabase.prototype.transaction = original;
				};
			const messages: string[] = [];
			const onMessage = (event: Event) => {
				messages.push((event as CustomEvent<{ kind: string }>).detail.kind);
			};
			window.addEventListener('antrean-sync-message', onMessage);
			const result = await sync.syncOrderStatusIntents('samarinda');
			window.removeEventListener('antrean-sync-message', onMessage);
			const intents = await local.loadStatusIntents('samarinda');
			return {
				result,
				failures,
				intentCount: intents.length,
				staged: Boolean(intents[0]?.in_flight),
				cardName: intents[0]?.card?.nama_pelanggan,
				message: messages.at(-1)
			};
		}, key);
		expect(failed).toEqual({
			result: { synced: 0, failed: 1, conflicts: 0 },
			failures: 1,
			intentCount: 1,
			staged: false,
			cardName: 'Pelanggan staging failure',
			message: 'storage'
		});
		expect(statusPosts).toBe(0);

		await page.evaluate(() =>
			(window as Window & { restoreStageTransaction?: () => void }).restoreStageTransaction?.()
		);
		const retryResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/antrean/status') && response.request().method() === 'POST'
		);
		const retry = await page.evaluate(async () => {
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			return await sync.syncOrderStatusIntents('samarinda');
		});
		expect(retry).toEqual({ synced: 0, failed: 1, conflicts: 0 });
		expect(statusPosts).toBe(1);
		const response = await retryResponse;
		expect(response.status()).toBe(503);
		expect(statusBody).toEqual({ idempotency_key: key, target: 'done', expected_revision: 0 });
		const retained = await page.evaluate(async (idempotencyKey) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === idempotencyKey
			);
			return {
				stagedTarget: intent?.in_flight?.target,
				cardName: intent?.card?.nama_pelanggan
			};
		}, key);
		expect(retained).toEqual({
			stagedTarget: 'done',
			cardName: 'Pelanggan staging failure'
		});
	} finally {
		await page.evaluate(async (idempotencyKey) => {
			(window as Window & { restoreStageTransaction?: () => void }).restoreStageTransaction?.();
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string; in_flight?: unknown }) =>
					item.idempotency_key === idempotencyKey
			);
			if (intent?.in_flight) await local.rejectStagedStatusIntent('samarinda', intent.in_flight);
			else await local.removeStatusIntent('samarinda', idempotencyKey);
			session.clearOfflineSessionSnapshot();
		}, key);
		await page.unroute('**/api/antrean/status', statusRoute);
		await page.unroute('**/api/csrf', csrfRoute);
	}
});

test('failed queue refresh preserves the search pagination cursor', async ({ page }) => {
	await loginAsOwner(page);
	await routeQueueFixtures(page);
	await page.goto('/antrean');
	await expect(page.locator('article')).toHaveCount(50);
	await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
	const search = page.getByPlaceholder('Cari nama / nomor, misal 001 haura...');
	await search.fill('Pelanggan fixture 51');
	await expect(page.getByText('Tidak ada yang cocok', { exact: true })).toBeVisible();
	let failedRefresh = false;
	const failOneRefresh = async (route: import('@playwright/test').Route) => {
		const url = new URL(route.request().url());
		if (!failedRefresh && url.searchParams.get('limit') === '50') {
			failedRefresh = true;
			await route.fulfill({ status: 503, json: { message: 'Temporary queue read failure' } });
			return;
		}
		await route.fallback();
	};
	await page.route('**/api/antrean?*', failOneRefresh);
	await page.getByRole('button', { name: 'Muat ulang Antrean', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Muat lebih banyak', exact: true })).toBeVisible();
	await expect(search).toHaveValue('Pelanggan fixture 51');
	await page.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
	await expect(page.locator('article', { hasText: 'Pelanggan fixture 51' })).toBeVisible();
	await page.unroute('**/api/antrean?*', failOneRefresh);
});
test('failed status rejection storage keeps its message and staged intent', async ({ page }) => {
	await loginAsOwner(page);
	const order = await checkoutUatOrder(page, `UAT rejection storage ${Date.now()}`);
	let statusResponses = 0;
	const statusRoute = async (route: import('@playwright/test').Route) => {
		statusResponses++;
		if (statusResponses === 1) {
			await route.fulfill({ status: 404, json: { message: 'Injected missing order' } });
			return;
		}
		await route.continue();
	};
	await page.route('**/api/antrean/status', statusRoute);
	try {
		const first = await page.evaluate(async (transactionId) => {
			const local = await import(/* @vite-ignore */ '/src/lib/utils/orderQueueLocal.ts');
			const session = await import(/* @vite-ignore */ '/src/lib/auth/offlineSession.ts');
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			const response = await fetch('/api/antrean?state=pending&limit=100');
			const payload = await response.json();
			const row = payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === transactionId
			);
			if (!row) throw new Error('UAT order is missing from the server queue');
			const snapshot = session.readOfflineSessionSnapshot();
			const user = snapshot?.user as { id?: string; username?: string } | undefined;
			await local.saveStatusIntent({
				branch: 'samarinda',
				idempotency_key: row.idempotency_key,
				target: 'done',
				expected_revision: row.preparation_revision,
				userId: user?.id || user?.username || ''
			});
			const original = IDBDatabase.prototype.transaction;
			let writes = 0;
			IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
				const names = Array.isArray(args[0]) ? args[0] : [args[0]];
				if (
					this.name === 'zatiaras-queue-v1' &&
					names.includes('order-queue') &&
					args[1] === 'readwrite'
				) {
					writes++;
					if (writes === 2)
						throw new DOMException('Injected reject write failure', 'InvalidStateError');
				}
				return original.apply(this, args);
			};
			(window as Window & { restoreRejectTransaction?: () => void }).restoreRejectTransaction =
				() => {
					IDBDatabase.prototype.transaction = original;
				};
			const messages: string[] = [];
			const onMessage = (event: Event) => {
				messages.push((event as CustomEvent<{ kind: string }>).detail.kind);
			};
			window.addEventListener('antrean-sync-message', onMessage);
			const result = await sync.syncOrderStatusIntents('samarinda');
			window.removeEventListener('antrean-sync-message', onMessage);
			const intent = (await local.loadStatusIntents('samarinda')).find(
				(item: { idempotency_key: string }) => item.idempotency_key === row.idempotency_key
			);
			return {
				result,
				writes,
				message: messages.at(-1),
				target: intent?.target,
				stagedTarget: intent?.in_flight?.target
			};
		}, order.transactionId);
		expect(first).toEqual({
			result: { synced: 0, failed: 1, conflicts: 0 },
			writes: 3,
			message: 'storage',
			target: 'done',
			stagedTarget: 'done'
		});
		expect(statusResponses).toBe(1);

		await page.evaluate(() =>
			(window as Window & { restoreRejectTransaction?: () => void }).restoreRejectTransaction?.()
		);
		const retry = await page.evaluate(async () => {
			const sync = await import(/* @vite-ignore */ '/src/lib/services/orderQueueSync.ts');
			return await sync.syncOrderStatusIntents('samarinda');
		});
		expect(retry).toEqual({ synced: 1, failed: 0, conflicts: 0 });
		expect(statusResponses).toBe(2);
		const committed = await page.evaluate(async (transactionId) => {
			const response = await fetch('/api/antrean?state=done&limit=100');
			const payload = await response.json();
			return payload.data.items.find(
				(item: { transaction_id: string }) => item.transaction_id === transactionId
			);
		}, order.transactionId);
		expect(committed).toMatchObject({ preparation_state: 'done', preparation_revision: 1 });
	} finally {
		await page.evaluate(() =>
			(window as Window & { restoreRejectTransaction?: () => void }).restoreRejectTransaction?.()
		);
		await page.unroute('**/api/antrean/status', statusRoute);
		await cleanupTransaction(page, order.transactionId);
	}
});
