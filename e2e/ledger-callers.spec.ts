import { expect, test, type Page } from '@playwright/test';
import { csrfMutate, ownerUsernameForTest } from './helpers';

async function login(page: Page, title: string) {
	const password = process.env.UAT_PASSWORD;
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia pada environment terisolasi');
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(title));
	await page.getByPlaceholder('Masukkan password').fill(password);
	const response = page.waitForResponse(
		(r) => new URL(r.url()).pathname === '/api/veriflogin' && r.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	expect((await response).status()).toBe(200);
	await expect(page).toHaveURL(/\/$/);
}

async function ledger(page: Page, id: string) {
	const response = await page.request.get(`/api/buku-kas?id=${encodeURIComponent(id)}&limit=1`);
	expect(response.status()).toBe(200);
	return (await response.json()) as Array<{
		id: string;
		nominal: number;
		revision: number;
		deskripsi: string;
		sumber: string;
		cabang_id: string;
	}>;
}

async function pending(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const open = indexedDB.open('zatiaras-pending-transactions-v2');
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		try {
			return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
				const request = db
					.transaction('pending-transactions')
					.objectStore('pending-transactions')
					.get('pending_transactions');
				request.onsuccess = () => resolve(request.result || []);
				request.onerror = () => reject(request.error);
			});
		} finally {
			db.close();
		}
	});
}

test('compiled caller AI decimal update uses live consent, stale409 and cancel without rebase', async ({
	page
}) => {
	await login(page, test.info().title);
	const id = `owned-compiled-consent-${crypto.randomUUID()}`;
	const created = await csrfMutate(page, 'POST', '/api/buku-kas', {
		payload: {
			id,
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			sumber: 'catat',
			nominal: 10000,
			waktu: '2026-07-01T12:00:00.000Z',
			deskripsi: 'Live sebelum consent',
			metode_bayar: 'tunai'
		}
	});
	expect(created.status()).toBe(200);
	const model = {
		recommendations: [
			{
				action: 'update_transaction',
				title: 'MODEL TITLE NOT AUTHORITY',
				deskripsi: 'model',
				priority: 'high',
				data: {
					id,
					type: 'pemasukan',
					amount: '2.50006e4',
					deskripsi: 'Canonical sesudah consent',
					category: 'pendapatan_usaha',
					revision: 999999
				}
			}
		]
	};
	await page.route('**/api/aichat?action=analyze', (route) => route.fulfill({ json: model }));
	let writes = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/buku-kas' && request.method() === 'PATCH')
			writes++;
	});
	async function consent(revision: number) {
		await page
			.getByPlaceholder('Ceritakan transaksi Anda...')
			.fill('Koreksi nominal transaksi yang ditinjau');
		await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
		await expect(page.getByTestId('ai-update-before')).toContainText(`Revisi ${revision}`);
	}
	try {
		await page.getByRole('button', { name: 'Buka AI Assistant' }).first().click();
		await consent(0);
		await expect(page.getByTestId('ai-update-before')).toContainText('Live sebelum consent');
		await expect(page.getByTestId('ai-update-after')).toContainText('Canonical sesudah consent');
		await expect(page.getByText('MODEL TITLE NOT AUTHORITY', { exact: true })).toHaveCount(0);
		const committed = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname === '/api/buku-kas' &&
				r.request().method() === 'PATCH' &&
				r.status() === 200
		);
		await page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true }).click();
		const response = await committed;
		// PATCH acknowledges {ok:true}; unlike create, it never promises a data-row snapshot.
		expect(await response.json()).toEqual({ ok: true });
		expect(response.request().postDataJSON()).toMatchObject({
			where: { id },
			payload: { nominal: 25001, revision: 0 }
		});
		expect(await ledger(page, id)).toMatchObject([
			{ nominal: 25001, revision: 1, deskripsi: 'Canonical sesudah consent' }
		]);
		await expect(
			page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true })
		).toHaveCount(0);
		expect(writes).toBe(1);
		await consent(1);
		const external = await csrfMutate(page, 'PATCH', '/api/buku-kas', {
			where: { id },
			payload: { revision: 1, nominal: 60000, deskripsi: 'External current' }
		});
		expect(external.status()).toBe(200);
		const stale = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname === '/api/buku-kas' &&
				r.request().method() === 'PATCH' &&
				r.status() === 409
		);
		await page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true }).click();
		await stale;
		await expect(page.getByText(/1 rekomendasi gagal diterapkan/)).toBeVisible();
		expect(await ledger(page, id)).toMatchObject([
			{ nominal: 60000, revision: 2, deskripsi: 'External current' }
		]);
		await page.getByRole('button', { name: 'Batal', exact: true }).click();
		await consent(2);
		const beforeCancel = writes;
		await page.getByRole('button', { name: 'Batal', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'Terapkan Rekomendasi', exact: true })
		).toHaveCount(0);
		expect(writes).toBe(beforeCancel);
		expect(await ledger(page, id)).toMatchObject([{ nominal: 60000, revision: 2 }]);
	} finally {
		await page.unrouteAll({ behavior: 'wait' });
	}
});

test('compiled caller legacy IndexedDB decimal lost delivery replays once and retains foreign queue', async ({
	page
}) => {
	await page.clock.setFixedTime(new Date('2026-07-01T12:00:00.000Z'));
	await login(page, test.info().title);
	const id = `owned-compiled-legacy-${crypto.randomUUID()}`;
	const foreignId = `owned-compiled-foreign-${crypto.randomUUID()}`;
	let posts = 0;
	const acknowledgements: Array<{ duplicate: boolean; nominal: number }> = [];
	await page.route('**/api/buku-kas*', async (route) => {
		const request = route.request();
		if (request.method() !== 'POST') {
			await route.continue();
			return;
		}
		const body = request.postDataJSON();
		if (body.payload?.id !== id && body.payload?.id !== foreignId) {
			await route.continue();
			return;
		}
		expect(body.payload.id).toBe(id);
		expect(body.payload.nominal).toBe('2.50006e4');
		posts++;
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		const result = await response.json();
		acknowledgements.push({
			duplicate: result.duplicate === true,
			nominal: result.data[0].nominal
		});
		if (posts === 1)
			await route.abort('failed'); // Commit exists; deliberately lose delivery to the real client.
		else await route.fulfill({ response });
	});
	try {
		// Known synthetic pre-v2 payload: no guessed production/history or source-module imports.
		await page.evaluate(
			async ({ id, foreignId }) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const open = indexedDB.open('zatiaras-pending-transactions-v2');
					open.onupgradeneeded = () => {
						if (!open.result.objectStoreNames.contains('pending-transactions'))
							open.result.createObjectStore('pending-transactions');
					};
					open.onsuccess = () => resolve(open.result);
					open.onerror = () => reject(open.error);
				});
				try {
					await new Promise<void>((resolve, reject) => {
						const transaction = db.transaction('pending-transactions', 'readwrite');
						const store = transaction.objectStore('pending-transactions');
						const existing = store.get('pending_transactions');
						existing.onsuccess = () => {
							if (Array.isArray(existing.result) && existing.result.length) {
								transaction.abort();
								return;
							}
							const row = {
								tipe: 'in',
								jenis: 'pendapatan_usaha',
								sumber: 'catat',
								nominal: '2.50006e4',
								waktu: '2026-07-01T12:00:00.000Z',
								deskripsi: 'Owned legacy fixture',
								metode_bayar: 'tunai'
							};
							store.put(
								[
									{ ...row, id, branch: 'samarinda' },
									{ ...row, id: foreignId, branch: 'berau' }
								],
								'pending_transactions'
							);
						};
						transaction.oncomplete = () => resolve();
						transaction.onabort = transaction.onerror = () =>
							reject(transaction.error || new Error('Owned legacy queue initialization failed'));
					});
				} finally {
					db.close();
				}
				window.dispatchEvent(new CustomEvent('pending-changed'));
			},
			{ id, foreignId }
		);
		await expect
			.poll(async () => (await pending(page)).find((row) => row.id === id)?.status)
			.toBe('failed');
		expect(posts).toBe(1);
		expect(acknowledgements).toEqual([{ duplicate: false, nominal: 25001 }]);
		// Independent cookie-authenticated read before any retry proves commit != queue acknowledgement.
		expect(await ledger(page, id)).toMatchObject([
			{ nominal: 25001, revision: 0, cabang_id: 'samarinda', sumber: 'catat' }
		]);
		const firstQueue = await pending(page);
		expect(firstQueue).toHaveLength(2);
		expect(firstQueue.find((row) => row.id === id)).toMatchObject({
			schema_version: 2,
			nominal: '2.50006e4',
			status: 'failed',
			failure_kind: 'network',
			attempt_count: 1
		});
		const banner = page.getByTestId('pending-transaction-banner');
		await expect(banner).toBeVisible();
		await banner.getByRole('button', { name: 'Sinkronkan', exact: true }).click();
		await expect.poll(async () => (await pending(page)).map((row) => row.id)).toEqual([foreignId]);
		expect(posts).toBe(2);
		expect(acknowledgements).toEqual([
			{ duplicate: false, nominal: 25001 },
			{ duplicate: true, nominal: 25001 }
		]);
		expect(await ledger(page, id)).toHaveLength(1);
		expect((await pending(page))[0]).toMatchObject({
			branch: 'berau',
			nominal: '2.50006e4',
			attempt_count: 0
		});
	} finally {
		await page.unrouteAll({ behavior: 'wait' });
	}
});
