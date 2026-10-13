import { expect, test, type Page } from '@playwright/test';

const CLEAN_ROWS = [{ id: 'p-bersih', nama: 'Bersih' }];
const MARKER_ROWS = [{ id: 'm-stale', nama: 'STALE-MARKER' }];

async function mockSession(page: Page, authenticated = false) {
	// These service/cache tests mount /login; a signed-in fixture legitimately redirects away.
	await page.addInitScript((isAuthenticated) => {
		// Target flight harus milik testcase, bukan idle-prefetch layout yang memakai endpoint sama.
		window.requestIdleCallback = () => 1;
		window.cancelIdleCallback = () => undefined;
		localStorage.setItem('selectedBranch', 'samarinda');
		localStorage.setItem(
			'zatiaras_session',
			JSON.stringify({
				isAuthenticated,
				user: { id: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' },
				expiresAt: 4102444800000
			})
		);
	}, authenticated);
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated,
						user: { id: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' },
						expiresAt: 4102444800000
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: [];
		await route.fulfill({ json: data });
	});
}

async function initializeDevModuleRuntime(page: Page): Promise<void> {
	// Raw source imports bypass the async app bootstrap. Use Vite's real initializer,
	// which installs Kit's configured dev defines, before importing $app dependencies.
	await page.evaluate(async () => {
		await import('/@vite/env');
	});
}

type ProdukGate = { release: (rows: Array<Record<string, unknown>>) => void };

async function installProdukGate(page: Page): Promise<{
	seenBranches: string[];
	gate: ProdukGate;
	calls: () => number;
}> {
	const seenBranches: string[] = [];
	let calls = 0;
	let held = false;
	let release!: (rows: Array<Record<string, unknown>>) => void;
	const gatePromise = new Promise<Array<Record<string, unknown>>>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/produk?*', async (route) => {
		calls += 1;
		seenBranches.push(new URL(route.request().url()).searchParams.get('branch') ?? '');
		if (!held) {
			held = true;
			const rows = await gatePromise;
			await route.fulfill({ json: rows });
			return;
		}
		await route.fulfill({ json: CLEAN_ROWS });
	});
	return { seenBranches, gate: { release }, calls: () => calls };
}

async function readOfflineProducts(page: Page, branch: string): Promise<unknown> {
	return page.evaluate(async (b) => {
		const open = (): Promise<IDBDatabase> =>
			new Promise((resolve, reject) => {
				const request = indexedDB.open('zatiaras-catalog-v2');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		try {
			const database = await open();
			const value: unknown = await new Promise((resolve, reject) => {
				const tx = database.transaction('catalog', 'readonly');
				const request = tx.objectStore('catalog').get(`table:products:${b}`);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			database.close();
			return value ?? null;
		} catch {
			return null;
		}
	}, branch);
}

// AUD-020: respons cabang lama yang tiba belakangan tak boleh menimpa cache cabang baru.
test('late samarinda response cannot overwrite berau cache', async ({ page }) => {
	await mockSession(page);
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });
	await initializeDevModuleRuntime(page);
	const { seenBranches, gate, calls } = await installProdukGate(page);

	await page.evaluate(async () => {
		const [{ productService }, { selectedBranch }] = await Promise.all([
			import('/src/lib/services/productService.ts'),
			import('/src/lib/stores/selectedBranch.svelte.ts')
		]);
		selectedBranch.value = 'samarinda';
		(window as unknown as { __p1: Promise<unknown> }).__p1 = productService.getProducts();
	});
	// Latar aplikasi (prefetch idle) boleh ikut memanggil /api/produk; yang
	// dikunci: panggilan PERTAMA adalah fetch cabang capture yang ditahan.
	await expect.poll(() => calls()).toBeGreaterThanOrEqual(1);

	await page.evaluate(async () => {
		const [{ productService }, { selectedBranch }] = await Promise.all([
			import('/src/lib/services/productService.ts'),
			import('/src/lib/stores/selectedBranch.svelte.ts')
		]);
		selectedBranch.value = 'berau';
		(window as unknown as { __b: unknown }).__b = await productService.getProducts();
	});
	const berauData = await page.evaluate(
		() => (window as unknown as { __b: Array<{ nama?: string }> }).__b
	);
	expect(berauData.some((row) => row.nama === 'STALE-MARKER')).toBe(false);

	gate.release(MARKER_ROWS);
	const [slow, third] = await page.evaluate(async () => {
		const [{ productService }, { selectedBranch }] = await Promise.all([
			import('/src/lib/services/productService.ts'),
			import('/src/lib/stores/selectedBranch.svelte.ts')
		]);
		const w = window as unknown as { __p1: Promise<Array<{ nama?: string }>> };
		const slowData = await w.__p1;
		selectedBranch.value = 'samarinda';
		const thirdData = (await productService.getProducts()) as Array<{ nama?: string }>;
		return [slowData, thirdData];
	});

	// Basi memang tiba (return value), tapi tak commit ke cache/IDB.
	expect(slow.some((row) => row.nama === 'STALE-MARKER')).toBe(true);
	expect(third.some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	// Fetch membawa cabang capture, bukan cabang aktif saat tiba.
	expect(seenBranches[0]).toBe('samarinda');
	const offline = (await readOfflineProducts(page, 'samarinda')) as {
		data?: Array<{ nama?: string }>;
	} | null;
	if (offline) {
		expect((offline.data ?? []).some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	}
});

// ABA harus tetap menolak flight lama meskipun nilai cabang kembali sama.
test('returning to original branch cannot revive an obsolete catalog flight', async ({ page }) => {
	await mockSession(page, false);
	await page.goto('/offline');
	await initializeDevModuleRuntime(page);
	const { gate, calls } = await installProdukGate(page);
	await page.evaluate(async () => {
		const [{ productService }, { selectedBranch }] = await Promise.all([
			import('/src/lib/services/productService.ts'),
			import('/src/lib/stores/selectedBranch.svelte.ts')
		]);
		selectedBranch.value = 'samarinda';
		(window as unknown as { __p1: Promise<unknown> }).__p1 = productService.getProducts();
	});
	await expect.poll(() => calls()).toBe(1);
	await page.evaluate(async () => {
		const { selectedBranch } = await import('/src/lib/stores/selectedBranch.svelte.ts');
		selectedBranch.value = 'berau';
		selectedBranch.value = 'samarinda';
	});
	gate.release(MARKER_ROWS);
	const late = await page.evaluate(async () => {
		return (window as unknown as { __p1: Promise<Array<{ nama?: string }>> }).__p1;
	});
	expect(late.some((row) => row.nama === 'STALE-MARKER')).toBe(true);
	const offline = (await readOfflineProducts(page, 'samarinda')) as {
		data?: Array<{ nama?: string }>;
	} | null;
	expect((offline?.data ?? []).some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	const fresh = await page.evaluate(async () => {
		const { productService } = await import('/src/lib/services/productService.ts');
		return productService.getProducts();
	});
	expect(fresh.some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	expect(calls()).toBeGreaterThan(1);
});

test('invalidated IndexedDB read cannot promote obsolete data back into memory', async ({
	page
}) => {
	await mockSession(page, false);
	let releaseClient!: () => void;
	const clientHeld = new Promise<void>((resolve) => {
		releaseClient = resolve;
	});
	const clientRequested = page.waitForRequest(
		(request) => new URL(request.url()).pathname === '/@vite/client',
		{ timeout: 10_000 }
	);
	await page.route('**/@vite/client', async (route) => {
		await clientHeld;
		await route.continue();
	});
	try {
		// SSR is not proof that Vite's async client graph has installed its real SDK defines.
		await page.goto('/offline', { waitUntil: 'commit' });
		await expect(page.getByRole('heading', { name: 'Koneksi terputus' })).toBeVisible();
		await clientRequested;
		expect(
			await page.evaluate(
				() =>
					typeof (window as unknown as { __SVELTEKIT_APP_VERSION__?: string })
						.__SVELTEKIT_APP_VERSION__
			)
		).toBe('undefined');
		await initializeDevModuleRuntime(page);
		expect(
			await page.evaluate(
				() =>
					typeof (window as unknown as { __SVELTEKIT_APP_VERSION__?: string })
						.__SVELTEKIT_APP_VERSION__
			)
		).toBe('string');
		const result = await page.evaluate(async () => {
			const { SmartCache } = await import('/src/lib/utils/cache.ts');
			const cache = new SmartCache();
			const storage = (
				cache as unknown as { indexedDBCache: { get: (key: string) => Promise<unknown> } }
			).indexedDBCache;
			const originalGet = storage.get.bind(storage);
			let release!: (rows: Array<{ nama: string }>) => void;
			let started!: () => void;
			const ready = new Promise<void>((resolve) => {
				started = resolve;
			});
			const gate = new Promise<Array<{ nama: string }>>((resolve) => {
				release = resolve;
			});
			storage.get = () => {
				started();
				return gate;
			};
			try {
				const flight = cache.get('promotion_samarinda', async () => [{ nama: 'Bersih' }], {
					backgroundRefresh: false
				});
				await ready;
				await cache.invalidate('promotion_samarinda');
				release([{ nama: 'STALE-MARKER' }]);
				const late = await flight;
				storage.get = originalGet;
				const fresh = await cache.get('promotion_samarinda', async () => [{ nama: 'Bersih' }], {
					backgroundRefresh: false
				});
				return { late, fresh };
			} finally {
				storage.get = originalGet;
				cache.destroy();
			}
		});
		expect(result.late.some((row) => row.nama === 'STALE-MARKER')).toBe(true);
		expect(result.fresh.some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	} finally {
		releaseClient();
		await page.unrouteAll({ behavior: 'wait' });
	}
});

// Invalidation harus mencapai cold flight juga, bukan hanya key yang sudah pernah commit.
for (const pattern of ['products_samarinda', 'products_*']) {
	test(
		pattern.endsWith('*')
			? 'wildcard invalidation reaches an in-flight uncached catalog key'
			: 'stale response cannot resurrect cache after invalidate',
		async ({ page }) => {
			await mockSession(page);
			await page.goto('/login');
			await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });
			await initializeDevModuleRuntime(page);
			const { gate, calls } = await installProdukGate(page);

			await page.evaluate(async () => {
				const { productService } = await import('/src/lib/services/productService.ts');
				(window as unknown as { __p1: Promise<unknown> }).__p1 = productService.getProducts();
			});
			// Toleransi traffic latar yang sama seperti tes di atas.
			await expect.poll(() => calls()).toBeGreaterThanOrEqual(1);

			await page.evaluate(async (keyPattern) => {
				const { smartCache } = await import('/src/lib/utils/cache.ts');
				await smartCache.invalidate(keyPattern);
			}, pattern);

			gate.release(MARKER_ROWS);
			await page.evaluate(async () => {
				await (window as unknown as { __p1: Promise<unknown> }).__p1;
			});
			const offline = (await readOfflineProducts(page, 'samarinda')) as {
				data?: Array<{ nama?: string }>;
			} | null;
			expect((offline?.data ?? []).some((row) => row.nama === 'STALE-MARKER')).toBe(false);
			const fresh = await page.evaluate(async () => {
				const { productService } = await import('/src/lib/services/productService.ts');
				return (await productService.getProducts()) as Array<{ nama?: string }>;
			});
			expect(fresh.some((row) => row.nama === 'STALE-MARKER')).toBe(false);
			expect(calls()).toBeGreaterThan(1);
		}
	);
}
