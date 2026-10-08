import { expect, test, type Page } from '@playwright/test';

const CLEAN_ROWS = [{ id: 'p-bersih', nama: 'Bersih' }];
const MARKER_ROWS = [{ id: 'm-stale', nama: 'STALE-MARKER' }];

async function mockSession(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('selectedBranch', 'samarinda');
		localStorage.setItem(
			'zatiaras_session',
			JSON.stringify({
				isAuthenticated: true,
				user: { id: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' },
				expiresAt: Date.now() + 3600000
			})
		);
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated: true,
						user: { id: 'u', username: 'owner', role: 'pemilik' },
						expiresAt: Date.now() + 3600000
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: [];
		await route.fulfill({ json: data });
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

// AUD-020: respons basi tak boleh bangkitkan cache sesudah invalidate.
test('stale response cannot resurrect cache after invalidate', async ({ page }) => {
	await mockSession(page);
	await page.goto('/login');
	await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });
	const { gate, calls } = await installProdukGate(page);

	await page.evaluate(async () => {
		const { productService } = await import('/src/lib/services/productService.ts');
		(window as unknown as { __p1: Promise<unknown> }).__p1 = productService.getProducts();
	});
	// Toleransi traffic latar yang sama seperti tes di atas.
	await expect.poll(() => calls()).toBeGreaterThanOrEqual(1);

	await page.evaluate(async () => {
		const { smartCache } = await import('/src/lib/utils/cache.ts');
		await smartCache.invalidate('products_samarinda');
	});

	gate.release(MARKER_ROWS);
	const fresh = await page.evaluate(async () => {
		const { productService } = await import('/src/lib/services/productService.ts');
		const w = window as unknown as { __p1: Promise<unknown> };
		await w.__p1;
		return (await productService.getProducts()) as Array<{ nama?: string }>;
	});
	expect(fresh.some((row) => row.nama === 'STALE-MARKER')).toBe(false);
	expect(calls()).toBeGreaterThan(1);
});
