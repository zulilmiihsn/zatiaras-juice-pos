import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-19T00:00:00.000Z'));
});

const stamp = '2026-10-19T00:00:00.000Z';
const network = {
	products: [{ id: 'p-network', nama: 'Jus Jambu Baru', harga: 15000 }],
	categories: [{ id: 'c-network', nama: 'Menu Baru' }],
	addOns: [{ id: 'a-network', nama: 'Susu Baru', harga: 3000 }]
};
const old = {
	products: [{ id: 'p-old', nama: 'Jus Jambu Lama', harga: 12000 }],
	categories: [{ id: 'c-old', nama: 'Menu Lama' }],
	addOns: [{ id: 'a-old', nama: 'Susu Lama', harga: 2000 }]
};

test('logout removes private cached data while retaining pending offline transactions', async ({
	page
}) => {
	await probe(page, 'healthy');
	const result = await page.evaluate(async () => {
		const [{ auth }, { smartCache }, offline] = await Promise.all([
			import('/src/lib/auth/auth.ts'),
			import('/src/lib/utils/cache.ts'),
			import('/src/lib/utils/offline.ts')
		]);
		const privateData = { omzet: 515000 };
		const freshData = { omzet: 0 };
		await smartCache.get('dashboard_stats_samarinda', async () => privateData, {
			backgroundRefresh: false
		});
		async function storeValue(
			databaseName: string,
			storeName: string,
			key: string,
			value?: unknown
		) {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 1);
				request.onupgradeneeded = () => request.result.createObjectStore(storeName);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				const tx = database.transaction(storeName, value === undefined ? 'readonly' : 'readwrite');
				const request =
					value === undefined
						? tx.objectStore(storeName).get(key)
						: tx.objectStore(storeName).put(value, key);
				const result = await new Promise<unknown>((resolve, reject) => {
					request.onsuccess = () => resolve(request.result ?? null);
					request.onerror = () => reject(request.error);
				});
				await new Promise<void>((resolve, reject) => {
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});
				return result;
			} finally {
				database.close();
			}
		}
		await storeValue('keyval-store', 'keyval', 'pos_kas_7hari_samarinda_2026-10-19', privateData);
		await storeValue('keyval-store', 'keyval', 'pending_transactions', [{ id: 'legacy-pending' }]);
		await offline.addPendingTransaction(
			{
				queue_id: 'pending-on-logout',
				type: 'pos_transaction',
				request: { idempotency_key: 'pending-on-logout-key' }
			},
			'samarinda'
		);
		await auth.logout();
		return {
			current: await smartCache.get('dashboard_stats_samarinda', async () => freshData, {
				backgroundRefresh: false
			}),
			legacyMetrics: await storeValue(
				'keyval-store',
				'keyval',
				'pos_kas_7hari_samarinda_2026-10-19'
			),
			legacyQueue: await storeValue('keyval-store', 'keyval', 'pending_transactions'),
			queue: await offline.getPendingTransactions(),
			catalog: await storeValue('zatiaras-catalog-v2', 'catalog', 'pos-catalog:v2:samarinda')
		};
	});
	expect(result.current).toEqual({ omzet: 0 });
	expect(result.legacyMetrics).toBeNull();
	expect(result.catalog).toBeNull();
	expect(result.legacyQueue).toEqual([{ id: 'legacy-pending' }]);
	expect(result.queue).toMatchObject([{ queue_id: 'pending-on-logout' }]);
});
function snapshot(data: typeof network) {
	return {
		version: 2,
		branch: 'samarinda',
		...data,
		fetched_at: stamp,
		expires_at: '2030-01-01T00:00:00.000Z',
		signing_key_id: 'audit-fixture'
	};
}

async function probe(page: Page, scenario: string) {
	const requests: string[] = [];
	await page.addInitScript(() => {
		window.requestIdleCallback = () => 1;
		window.cancelIdleCallback = () => undefined;
		localStorage.setItem('selectedBranch', 'samarinda');
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const resources: Record<string, unknown> = {
			'/api/produk': network.products,
			'/api/kategori': network.categories,
			'/api/tambahan': network.addOns,
			'/api/pos/catalog': snapshot(network)
		};
		if (Object.hasOwn(resources, path)) {
			requests.push(path);
			if (scenario === 'network-down') {
				await route.fulfill({ status: 503, json: { message: 'Injected upstream outage' } });
				return;
			}
			if (path === '/api/pos/catalog' && scenario === 'foreign-catalog') {
				await route.fulfill({ json: { ...snapshot(network), branch: 'berau' } });
				return;
			}
			if (path === '/api/pos/catalog' && scenario === 'malformed-catalog') {
				await route.fulfill({ json: { ...snapshot(network), products: null } });
				return;
			}
			await route.fulfill({ json: resources[path] });
			return;
		}
		await route.fulfill({
			json:
				path === '/api/session'
					? { success: true, authenticated: false }
					: path === '/api/csrf'
						? { success: true, token: 'audit-fixture' }
						: []
		});
	});
	await page.goto('/offline');
	const result = await page.evaluate(
		async ({ scenario, old, oldCatalog, stamp }) => {
			await import('/@vite/env');
			const [{ ProductService }, { selectedBranch }] = await Promise.all([
				import('/src/lib/services/productService.ts'),
				import('/src/lib/stores/selectedBranch.svelte.ts')
			]);
			selectedBranch.value = 'samarinda';
			const hasOldCache = ['write-old', 'network-down', 'offline'].includes(scenario);
			if (hasOldCache) {
				const database = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('zatiaras-catalog-v2', 1);
					request.onupgradeneeded = () => request.result.createObjectStore('catalog');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				const transaction = database.transaction('catalog', 'readwrite');
				const store = transaction.objectStore('catalog');
				for (const [key, data] of Object.entries(old)) {
					const prefix = key === 'addOns' ? 'addons' : key;
					store.put({ version: 1, data, updated_at: stamp }, `table:${prefix}:samarinda`);
				}
				store.put(oldCatalog, 'pos-catalog:v2:samarinda');
				await new Promise<void>((resolve, reject) => {
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
					transaction.onabort = () => reject(transaction.error);
				});
				database.close();
			}
			let faults = 0;
			const put = IDBObjectStore.prototype.put;
			const open = IDBFactory.prototype.open;
			if (scenario.startsWith('write-')) {
				IDBObjectStore.prototype.put = function (...args) {
					if (this.transaction.db.name === 'zatiaras-catalog-v2') {
						faults += 1;
						throw new DOMException('Injected catalog quota exhaustion', 'QuotaExceededError');
					}
					return put.apply(this, args);
				};
			}
			if (scenario === 'storage-denied') {
				IDBFactory.prototype.open = function (...args) {
					if (args[0] === 'zatiaras-catalog-v2') {
						faults += 1;
						throw new DOMException('Injected catalog storage denial', 'SecurityError');
					}
					return open.apply(this, args);
				};
			}
			if (scenario === 'offline') Object.defineProperty(navigator, 'onLine', { value: false });
			try {
				const service = new ProductService();
				const products = await service.getProducts();
				const categories = await service.getCategories();
				const addOns = await service.getAddOns();
				const pos = await service.getPosCatalog();
				return { scenario, products, categories, addOns, pos, faults, online: navigator.onLine };
			} finally {
				IDBObjectStore.prototype.put = put;
				IDBFactory.prototype.open = open;
			}
		},
		{ scenario, old, oldCatalog: snapshot(old), stamp }
	);

	return { ...result, requests };
}

test('a late catalog response cannot recreate session data after logout', async ({ page }) => {
	await probe(page, 'healthy');
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/pos/catalog', async (route) => {
		await gate;
		await route.fulfill({ json: snapshot(network) });
	});
	const requested = page.waitForRequest(
		(request) => new URL(request.url()).pathname === '/api/pos/catalog'
	);
	const late = page.evaluate(async () =>
		(await import('/src/lib/services/productService.ts')).productService.getPosCatalog()
	);
	await requested;
	try {
		await page.evaluate(async () => (await import('/src/lib/auth/auth.ts')).auth.logout());
	} finally {
		release();
	}
	await late;
	const cached = await page.evaluate(async () => {
		Object.defineProperty(navigator, 'onLine', { value: false });
		return (await import('/src/lib/services/productService.ts')).productService.getPosCatalog();
	});
	expect(cached.source).toBe('unavailable');
	expect(cached.products).toEqual([]);
});

test('healthy storage preserves the current online catalog', async ({ page }) => {
	const result = await probe(page, 'healthy');
	expect(result.products).toEqual(network.products);
	expect(result.categories).toEqual(network.categories);
	expect(result.addOns).toEqual(network.addOns);
	expect(result.pos.products).toEqual(network.products);
	expect(result.pos.source).toBe('network');
});

test('late dashboard follow-up queries retain the captured branch', async ({ page }) => {
	await probe(page, 'healthy');
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/dashboard/stats?**', async (route) => {
		await gate;
		await route.fulfill({
			json: {
				summary: [{ jumlah_item: 2, jumlah_transaksi: 1, penjualan_kotor: 15000, total_hpp: 5000 }]
			}
		});
	});
	await page.route('**/api/pengaturan/stok?**', (route) =>
		route.fulfill({ json: { data: { mode: 'tracked' } } })
	);
	const branches: Array<string | null> = [];
	await page.route('**/api/bahan*', (route) => {
		branches.push(new URL(route.request().url()).searchParams.get('branch'));
		return route.fulfill({ json: [] });
	});
	const requested = page.waitForRequest(
		(request) => new URL(request.url()).pathname === '/api/dashboard/stats'
	);
	const late = page.evaluate(async () =>
		(await import('/src/lib/services/dashboardService.ts')).dashboardService.getDashboardStats()
	);
	await requested;
	try {
		await page.evaluate(async () => {
			(await import('/src/lib/stores/selectedBranch.svelte.ts')).selectedBranch.value =
				'samarinda2';
		});
	} finally {
		release();
	}
	await late;
	expect(branches).toEqual(['samarinda', 'samarinda']);
});

for (const scenario of ['write-cold', 'write-old', 'storage-denied']) {
	test(`online network success survives ${scenario}`, async ({ page }) => {
		const result = await probe(page, scenario);
		expect(result.faults).toBeGreaterThan(0);
		expect(result.requests).toContain('/api/pos/catalog');
		expect.soft(result.products).toEqual(network.products);
		expect.soft(result.categories).toEqual(network.categories);
		expect.soft(result.addOns).toEqual(network.addOns);
		expect.soft(result.pos.products).toEqual(network.products);
		expect.soft(result.pos.source).toBe('network');
	});
}

test('network failure deliberately falls back to existing offline data', async ({ page }) => {
	const result = await probe(page, 'network-down');
	expect(result.products).toEqual(old.products);
	expect(result.categories).toEqual(old.categories);
	expect(result.addOns).toEqual(old.addOns);
	expect(result.pos.products).toEqual(old.products);
	expect(result.pos.source).toBe('cache');
});

test('offline mode deliberately uses persisted data without a network request', async ({
	page
}) => {
	const result = await probe(page, 'offline');
	expect(result.products).toEqual(old.products);
	expect(result.categories).toEqual(old.categories);
	expect(result.addOns).toEqual(old.addOns);
	expect(result.pos.products).toEqual(old.products);
	expect(result.pos.source).toBe('cache');
	expect(result.requests).toEqual([]);
});

for (const scenario of ['foreign-catalog', 'malformed-catalog']) {
	test(`catalog validation still rejects ${scenario}`, async ({ page }) => {
		const result = await probe(page, scenario);
		expect(result.pos.source).toBe('unavailable');
		expect(result.pos.products).toEqual([]);
		expect(result.pos.branch).toBe('samarinda');
		expect(result.pos.error).toBe('Format katalog POS tidak valid');
	});
}

for (const mode of ['healthy', 'write-failed', 'read-failed', 'network-down']) {
	test(`dashboard cache isolation handles ${mode}`, async ({ page }) => {
		const requests: string[] = [];
		await page.addInitScript(() => {
			window.requestIdleCallback = () => 1;
			window.cancelIdleCallback = () => undefined;
			localStorage.setItem('selectedBranch', 'samarinda');
		});
		await page.route('**/api/**', async (route) => {
			const path = new URL(route.request().url()).pathname;
			requests.push(path);
			if (path === '/api/dashboard/stats' && mode === 'network-down') {
				await route.fulfill({ status: 503, json: { message: 'Injected upstream outage' } });
				return;
			}
			const json =
				path === '/api/dashboard/stats'
					? {
							summary: [
								{ jumlah_item: 2, jumlah_transaksi: 1, penjualan_kotor: 15000, total_hpp: 5000 }
							],
							kasir: [],
							kas: []
						}
					: path === '/api/pengaturan/stok'
						? { data: { mode: 'ignored' } }
						: path === '/api/session'
							? { success: true, authenticated: false }
							: [];
			await route.fulfill({ json });
		});
		await page.goto('/offline');
		const result = await page.evaluate(async (mode) => {
			await import('/@vite/env');
			const [{ DashboardService }, { selectedBranch }] = await Promise.all([
				import('/src/lib/services/dashboardService.ts'),
				import('/src/lib/stores/selectedBranch.svelte.ts')
			]);
			selectedBranch.value = 'samarinda';
			const put = IDBObjectStore.prototype.put;
			const open = IDBFactory.prototype.open;
			let faults = 0;
			IDBObjectStore.prototype.put = function (...args) {
				if (mode === 'write-failed' && this.transaction.db.name === 'keyval-store') {
					faults += 1;
					throw new DOMException('Injected dashboard quota exhaustion', 'QuotaExceededError');
				}
				return put.apply(this, args);
			};
			IDBFactory.prototype.open = function (...args) {
				if (mode === 'read-failed' && args[0] === 'keyval-store') {
					faults += 1;
					throw new DOMException('Injected dashboard storage denial', 'SecurityError');
				}
				return open.apply(this, args);
			};
			try {
				return { ok: true, data: await new DashboardService().getDashboardStats(), faults };
			} catch (error) {
				return { ok: false, error: String(error), faults };
			} finally {
				IDBObjectStore.prototype.put = put;
				IDBFactory.prototype.open = open;
			}
		}, mode);

		expect(requests).toContain('/api/dashboard/stats');
		if (mode.endsWith('-failed')) expect(result.faults).toBeGreaterThan(0);
		if (mode === 'network-down') {
			expect(result).toMatchObject({ ok: false, error: 'Error: Injected upstream outage' });
		} else {
			expect(result).toMatchObject({ ok: true, data: { omzet: 15000, itemTerjual: 2 } });
		}
	});
}

for (const rejectWrites of [false, true]) {
	test(`offline transaction persistence ${rejectWrites ? 'rejects a failed write' : 'acknowledges a durable write'}`, async ({
		page
	}) => {
		await page.goto('/offline');
		const result = await page.evaluate(async (rejectWrites) => {
			await import('/@vite/env');
			const { addPendingTransaction, getPendingTransactions } =
				await import('/src/lib/utils/offline.ts');
			const put = IDBObjectStore.prototype.put;
			let faults = 0;
			let changed = 0;
			const onChanged = () => changed++;
			window.addEventListener('pending-changed', onChanged);
			IDBObjectStore.prototype.put = function (...args) {
				if (rejectWrites && this.transaction.db.name === 'zatiaras-pending-transactions-v2') {
					faults++;
					throw new DOMException('Injected transaction storage failure', 'QuotaExceededError');
				}
				return put.apply(this, args);
			};
			let saved = false;
			try {
				await addPendingTransaction(
					{
						queue_id: 'durable-pending',
						type: 'pos_transaction',
						request: { idempotency_key: 'durable-pending-key', mode: 'offline_replay' }
					},
					'samarinda'
				);
				saved = true;
			} catch (error) {
				if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
			} finally {
				IDBObjectStore.prototype.put = put;
				window.removeEventListener('pending-changed', onChanged);
			}
			return { saved, faults, changed, queue: await getPendingTransactions() };
		}, rejectWrites);
		if (rejectWrites) {
			expect(result.saved).toBe(false);
			expect(result.faults).toBeGreaterThan(0);
			expect(result.changed).toBe(0);
			expect(result.queue).toEqual([]);
		} else {
			expect(result.saved).toBe(true);
			expect(result.changed).toBe(1);
			expect(result.queue).toMatchObject([{ queue_id: 'durable-pending', branch: 'samarinda' }]);
		}
	});
}
