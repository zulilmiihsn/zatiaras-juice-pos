import { expect, test, type Page, type Request } from '@playwright/test';
import { gotoHydrated } from './helpers';

test('cashier opens settings order history while the financial ledger remains PIN locked', async ({
	page
}) => {
	await mockSettingsSession(page, 'kasir');
	await page.route('**/api/pengaturan?*', (route) =>
		route.fulfill({
			json: [
				{
					id: 'cashier-history-locks',
					pinConfigured: true,
					halaman_terkunci: ['pengaturan', 'catat', 'beranda']
				}
			]
		})
	);
	let ledgerReads = 0;
	let orderReads = 0;
	await page.route('**/api/buku-kas**', async (route) => {
		ledgerReads++;
		await route.fulfill({ status: 403, json: { message: 'PIN_REQUIRED' } });
	});
	await page.route('**/api/pos/history**', async (route) => {
		orderReads++;
		await route.fulfill({
			json: {
				data: [
					{
						id: 'order-history-1',
						transaction_id: 'order-1',
						nomor_harian: 7,
						waktu: '2026-10-20T04:00:00.000Z',
						deskripsi: 'Penjualan Jus Kasir',
						nama_pelanggan: 'Rina Riwayat',
						nominal: 25_000,
						tipe: 'in',
						sumber: 'pos',
						metode_bayar: 'tunai'
					}
				],
				nextCursor: null,
				hasMore: false
			}
		});
	});
	await gotoHydrated(page, '/pengaturan', 'h2:text-is("Kasir Kios")');
	await page.getByRole('link', { name: /Riwayat.*Hari Ini/ }).click();
	await expect(page.getByRole('button', { name: /Penjualan Jus Kasir/ })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Akses Terkunci' })).toHaveCount(0);
	expect(orderReads).toBeGreaterThan(0);
	expect(ledgerReads).toBe(0);
	await page.getByRole('button', { name: '7 hari', exact: true }).click();
	await expect(
		page.getByRole('heading', { name: 'Riwayat Pesanan 7 Hari', exact: true })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Penjualan Jus Kasir/ })).toBeVisible();
	expect(ledgerReads).toBe(0);
	await page.goto('/pengaturan/printer');
	await expect(page.getByRole('dialog', { name: 'Akses Terkunci' })).toBeVisible();
});

async function openPrinterSettings(page: Page) {
	await mockSettingsSession(page);
	await gotoHydrated(page, '/pengaturan/printer', '#nama-toko');
	// The textbox exists in SSR; its loaded value proves the component has actually mounted.
	await expect(page.locator('#nama-toko')).toHaveValue('Zatiaras Juice');
}

test('cashier shares one PIN across pages and store actions for a fixed 60 seconds', async ({
	page
}) => {
	await mockSettingsSession(page, 'kasir');
	let now = Date.parse('2026-10-20T04:00:00.000Z');
	let unlockExpiresAt = 0;
	let verifications = 0;
	await page.route('**/api/pengaturan?*', (route) =>
		route.fulfill({
			json: [
				{ pinConfigured: true, halaman_terkunci: ['beranda', 'laporan', 'catat', 'pengaturan'] }
			]
		})
	);
	await page.route('**/api/pin/verify', async (route) => {
		if (route.request().method() === 'POST') {
			verifications++;
			expect(route.request().postDataJSON().pin).toBe('2580');
			unlockExpiresAt = now + 60_000;
		}
		await route.fulfill({
			json: { ok: true, expiresAt: unlockExpiresAt > now ? unlockExpiresAt : 0 }
		});
	});
	await gotoHydrated(page, '/', 'h2:text-is("Akses Terkunci")');
	const locked = page.getByRole('dialog', { name: 'Akses Terkunci', exact: true });
	await expect(locked).toBeVisible();
	await page.keyboard.type('2580');
	await expect(locked).toHaveCount(0);
	expect(verifications).toBe(1);
	await page.getByRole('button', { name: /Kios Tutup/ }).click();
	await expect(page.getByRole('dialog', { name: 'Verifikasi Aksi' })).toHaveCount(0);
	await expect(page.locator('#modal-kas-input')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('#modal-kas-input')).toHaveCount(0);

	await page.getByRole('link', { name: 'Catat', exact: true }).click();
	await expect(page).toHaveURL(/\/catat$/);
	await expect(locked).toHaveCount(0);
	now += 59_999;
	await page.clock.setFixedTime(now);
	await page.getByRole('link', { name: 'Beranda', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(locked).toHaveCount(0);
	const restored = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/pin/verify' &&
			response.request().method() === 'GET'
	);
	await page.reload();
	await restored;
	// Respons status dapat selesai sebelum halaman terhidrasi dan metadata izin diterapkan.
	await expect(page.getByText('Samarinda', { exact: true }).first()).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const modulePath = '/src/lib/services/pinAccessService.ts';
				const { hasPinAccess } = await import(/* @vite-ignore */ modulePath);
				return hasPinAccess();
			})
		)
		.toBe(true);
	await expect(locked).toHaveCount(0);
	expect(verifications).toBe(1);
	expect(unlockExpiresAt).toBe(now + 1);

	now++;
	await page.clock.setFixedTime(now);
	await page.getByRole('button', { name: /Kios Tutup/ }).click();
	await expect(page.getByRole('dialog', { name: 'Verifikasi Aksi', exact: true })).toBeVisible();
	await page.keyboard.type('2580');
	await expect(page.locator('#modal-kas-input')).toBeVisible();
	expect(verifications).toBe(2);
	await page.keyboard.press('Escape');
	await page.getByRole('link', { name: 'Catat', exact: true }).click();
	await expect(page).toHaveURL(/\/catat$/);
	await expect(locked).toHaveCount(0);

	// Pencabutan server (misalnya pemilik mengganti PIN) berlaku saat navigasi berikutnya.
	unlockExpiresAt = 0;
	await page.getByRole('link', { name: 'Beranda', exact: true }).click();
	await expect(locked).toBeVisible();
});

test('cashier rejects malformed PIN status and clears access on branch change and logout', async ({
	page
}) => {
	await mockSettingsSession(page, 'kasir');
	await page.route('**/api/pengaturan?*', (route) =>
		route.fulfill({ json: [{ pinConfigured: true, halaman_terkunci: ['catat', 'pengaturan'] }] })
	);
	let mode: 'invalid' | 'unavailable' | 'verified' = 'invalid';
	await page.route('**/api/pin/verify', async (route) => {
		if (mode === 'unavailable') {
			await route.abort('failed');
			return;
		}
		await route.fulfill({
			json:
				mode === 'verified'
					? { ok: true, expiresAt: Date.parse('2026-10-20T04:01:00.000Z') }
					: { ok: true, expiresAt: 'invalid' }
		});
	});
	await page.goto('/catat');
	const locked = page.getByRole('dialog', { name: 'Akses Terkunci', exact: true });
	await expect(locked).toBeVisible();
	await page.keyboard.type('2580');
	await expect(locked.getByText('Verifikasi PIN gagal', { exact: true })).toBeVisible();
	mode = 'unavailable';
	await page.reload();
	await expect(locked).toBeVisible();
	mode = 'verified';
	await page.keyboard.type('2580');
	await expect(locked).toHaveCount(0);
	await page.evaluate(async () => {
		const modulePath = '/src/lib/stores/selectedBranch.svelte.ts';
		const { selectedBranch } = await import(/* @vite-ignore */ modulePath);
		selectedBranch.value = 'berau';
	});
	await expect(locked).toBeVisible();
	mode = 'invalid';
	const loggedOut = await page.evaluate(async () => {
		const authPath = '/src/lib/auth/auth.ts';
		const accessPath = '/src/lib/stores/securitySettings.svelte.ts';
		const { auth } = await import(/* @vite-ignore */ authPath);
		const { pinAccess } = await import(/* @vite-ignore */ accessPath);
		await auth.logout();
		return { access: pinAccess.value, request: pinAccess.request };
	});
	expect(loggedOut).toEqual({ access: null, request: null });
});

test('cashier ignores late PIN responses after verification or a session change', async ({
	page
}) => {
	await mockSettingsSession(page, 'kasir');
	await page.route('**/api/pengaturan?*', (route) =>
		route.fulfill({ json: [{ pinConfigured: true, halaman_terkunci: ['catat'] }] })
	);
	let releaseStatus!: () => void;
	const statusGate = new Promise<void>((resolve) => {
		releaseStatus = resolve;
	});
	let releaseVerification!: () => void;
	const verificationGate = new Promise<void>((resolve) => {
		releaseVerification = resolve;
	});
	let firstStatus = true;
	let unlockExpiresAt = 0;
	let holdVerification = false;
	let verifying = false;
	await page.route('**/api/pin/verify', async (route) => {
		if (route.request().method() === 'GET') {
			const expiresAt = unlockExpiresAt;
			if (firstStatus) {
				firstStatus = false;
				await statusGate;
			}
			await route.fulfill({ json: { ok: true, expiresAt } });
			return;
		}
		if (holdVerification) {
			verifying = true;
			await verificationGate;
		}
		unlockExpiresAt = Date.parse('2026-10-20T04:01:00.000Z');
		await route.fulfill({ json: { ok: true, expiresAt: unlockExpiresAt } });
	});
	await page.goto('/catat');
	const locked = page.getByRole('dialog', { name: 'Akses Terkunci', exact: true });
	await expect(locked).toBeVisible();
	await page.keyboard.type('2580');
	await expect(locked).toHaveCount(0);
	const lateStatus = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/pin/verify' &&
			response.request().method() === 'GET'
	);
	releaseStatus();
	await lateStatus;
	await expect(locked).toHaveCount(0);

	holdVerification = true;
	unlockExpiresAt = 0;
	await page.reload();
	await expect(locked).toBeVisible();
	await page.keyboard.type('2580');
	await expect.poll(() => verifying).toBe(true);
	await page.evaluate(async () => {
		const modulePath = '/src/lib/stores/userRole.svelte.ts';
		const { setUserRole } = await import(/* @vite-ignore */ modulePath);
		setUserRole('kasir', { id: 'replacement-user', username: 'kasir-baru', branch: 'samarinda' });
	});
	releaseVerification();
	await expect(
		locked.getByText('Sesi kasir berubah. Masukkan PIN kembali', { exact: true })
	).toBeVisible();
	await expect(locked).toBeVisible();
});

test('receipt preview recovers from a canvas failure', async ({ page }) => {
	await openPrinterSettings(page);
	await page.evaluate(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		Object.defineProperty(window, 'restoreReceiptCanvas', {
			value: () => {
				HTMLCanvasElement.prototype.getContext = original;
			}
		});
		HTMLCanvasElement.prototype.getContext = (() => null) as typeof original;
	});
	await page.getByRole('button', { name: 'Tampilan Struk', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Browser tidak dapat merender struk');
	await page.evaluate(() =>
		(window as unknown as { restoreReceiptCanvas: () => void }).restoreReceiptCanvas()
	);
	await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
	await expect(page.getByTestId('receipt-preview')).toBeVisible();
});

test('receipt printer settings report blocked storage', async ({ page }) => {
	await openPrinterSettings(page);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.evaluate(() => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
			if (key === 'pos_printer_config')
				throw new DOMException('Blocked fixture', 'QuotaExceededError');
			return original.call(this, key, value);
		};
	});
	await page.getByRole('button', { name: 'Koneksi Printer POS', exact: true }).click();
	await page.getByRole('button', { name: 'Simpan Metode Printer', exact: true }).click();
	await expect(
		page.getByText('Pengaturan printer tidak dapat disimpan.', { exact: false })
	).toBeVisible();
	expect(errors).toEqual([]);
});

test('receipt Android method reports unsupported desktop instead of claiming print success', async ({
	page
}) => {
	await openPrinterSettings(page);
	await page.getByRole('button', { name: 'Koneksi Printer POS', exact: true }).click();
	await page.getByRole('button', { name: 'Coba Tes Cetak Struk', exact: true }).click();
	await expect(
		page.getByText('Metode Aplikasi Android membutuhkan perangkat Android', { exact: false })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Coba Tes Cetak Struk', exact: true })
	).toBeEnabled();
});

test('receipt server times out and releases loading state', async ({ page }) => {
	await openPrinterSettings(page);
	await page.clock.install({ time: new Date('2026-10-20T04:00:00.000Z') });
	await page.evaluate(() => {
		const state = { sockets: 0, requests: 0, sent: 0 };
		Object.defineProperty(window, 'receiptTimeoutState', { value: state });
		class HangingSocket {
			onopen = null;
			onclose = null;
			onerror = null;
			constructor() {
				state.sockets++;
			}
			send() {
				state.sent++;
			}
			close() {
				this.onclose = null;
			}
		}
		Object.defineProperty(window, 'WebSocket', { configurable: true, value: HangingSocket });
		const original = window.fetch.bind(window);
		window.fetch = (input, init) => {
			if (!String(input).includes(':40213/')) return original(input, init);
			state.requests++;
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => reject(new DOMException('Fixture timeout', 'AbortError')),
					{ once: true }
				);
			});
		};
	});
	const state = () =>
		page.evaluate(
			() =>
				(
					window as unknown as {
						receiptTimeoutState: { sockets: number; requests: number; sent: number };
					}
				).receiptTimeoutState
		);
	await page.getByRole('button', { name: 'Koneksi Printer POS', exact: true }).click();
	await page.locator('input[value="server"]').check();
	const button = page.getByRole('button', { name: 'Coba Tes Cetak Struk', exact: true });
	await button.click();
	await expect.poll(async () => (await state()).sockets).toBe(1);
	await page.clock.runFor(5_001);
	await expect.poll(async () => (await state()).sockets).toBe(2);
	await page.clock.runFor(5_001);
	await expect.poll(async () => (await state()).requests).toBe(0);
	await expect(
		page.getByText('Server printer lokal tidak merespons.', { exact: false })
	).toBeVisible();
	await expect(button).toBeEnabled();
	expect((await state()).sent).toBe(0);
});

async function exercisePrinter(
	page: Page,
	method: 'usb' | 'bluetooth' | 'server',
	paperSize: '58mm' | '80mm',
	failure: '' | 'partial' | 'stall' | 'pre-send' | 'post-send' | 'concurrent' = ''
) {
	await openPrinterSettings(page);
	return page.evaluate(
		async ({ method, paperSize, failure }) => {
			const enginePath = '/src/lib/services/printerEngine.ts';
			const printPath = '/src/lib/utils/receiptPrint.ts';
			const rasterPath = '/src/lib/utils/receiptRaster.ts';
			const escposPath = '/src/lib/utils/escposBuilder.ts';
			const engine = (await import(
				enginePath
			)) as typeof import('../src/lib/services/printerEngine');
			const print = (await import(printPath)) as typeof import('../src/lib/utils/receiptPrint');
			const raster = (await import(rasterPath)) as typeof import('../src/lib/utils/receiptRaster');
			const escpos = (await import(escposPath)) as typeof import('../src/lib/utils/escposBuilder');
			const data = print.buildSampleReceipt(
				print.DEFAULT_RECEIPT_SETTINGS,
				new Date('2026-10-20T04:00:00.000Z')
			);
			data.customerName = 'Rina <script>alert(1)</script> ' + 'Pelanggan '.repeat(8);
			data.address = 'Alamat cabang dengan nama jalan dan keterangan sangat panjang '.repeat(4);
			data.items[0].name = 'Jus Mangga Jumbo dengan nama produk sangat panjang '.repeat(3);
			data.items[0].details = 'Catatan panjang '.repeat(12) + '\nCafe\u0301 \u6d4b\u8bd5';
			const expected = await raster.renderReceipt(data, paperSize);
			const chunks: Uint8Array[] = [];
			const messages: string[] = [];
			const socketUrls: string[] = [];
			let httpRequests = 0;
			let closed = false;
			let requests = 0;
			const originalFetch = window.fetch.bind(window);
			window.fetch = async (input, init) => {
				if (String(input).includes(':40213/')) {
					httpRequests++;
					messages.push(String(init?.body));
					return new Response('', { status: 200 });
				}
				return originalFetch(input, init);
			};
			const usbDevice = {
				opened: true,
				configuration: {
					interfaces: [
						{
							interfaceNumber: 0,
							alternates: [{ endpoints: [{ direction: 'out', endpointNumber: 1 }] }]
						}
					]
				},
				async open() {
					requests++;
				},
				async selectConfiguration() {
					requests++;
				},
				async claimInterface() {
					requests++;
				},
				async close() {
					closed = true;
				},
				async transferOut(_endpoint: number, bytes: Uint8Array) {
					if (failure === 'stall') return { status: 'stall', bytesWritten: 0 };
					const written = failure === 'partial' ? Math.min(31, bytes.length) : bytes.length;
					chunks.push(bytes.slice(0, written));
					return { status: 'ok', bytesWritten: written };
				}
			};
			Object.defineProperty(navigator, 'usb', {
				configurable: true,
				value: {
					async requestDevice() {
						requests++;
						return usbDevice;
					}
				}
			});
			const characteristic = {
				properties: { write: true },
				async writeValueWithResponse(bytes: Uint8Array) {
					chunks.push(bytes.slice());
				}
			};
			const gatt = {
				connected: true,
				async connect() {
					requests++;
					return gatt;
				},
				disconnect() {
					closed = true;
				},
				async getPrimaryService() {
					return {
						async getCharacteristics() {
							return [characteristic];
						}
					};
				}
			};
			Object.defineProperty(navigator, 'bluetooth', {
				configurable: true,
				value: {
					async requestDevice() {
						requests++;
						return { name: 'Printer Uji', gatt };
					}
				}
			});
			class PrinterSocket {
				onopen: (() => void) | null = null;
				onerror: (() => void) | null = null;
				onclose: (() => void) | null = null;
				bufferedAmount = 0;
				constructor(url: string) {
					socketUrls.push(url);
					queueMicrotask(() => (failure === 'pre-send' ? this.onerror?.() : this.onopen?.()));
				}
				send(message: string) {
					messages.push(message);
					if (failure === 'post-send') {
						this.bufferedAmount = 10;
						queueMicrotask(() => this.onerror?.());
					}
				}
				close() {
					this.onclose = null;
				}
			}
			Object.defineProperty(window, 'WebSocket', { configurable: true, value: PrinterSocket });
			engine.savePrinterConfig({ method, paperSize });
			let error = '';
			let concurrentError = '';
			try {
				const first = engine.printReceiptUnified({ receiptData: data });
				if (failure === 'concurrent') {
					try {
						await engine.printReceiptUnified({ receiptData: data });
					} catch (caught) {
						concurrentError = String(caught);
					}
				}
				await first;
			} catch (caught) {
				error = String(caught);
			}
			const bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
			const expectedBytes = escpos.buildReceiptEscPos(expected.bitmap);
			let serverBytes = new Uint8Array();
			if (method === 'server' && messages[0]) {
				const prefix = 'intent:base64,';
				const suffix = '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
				if (!messages[0].startsWith(prefix) || !messages[0].endsWith(suffix))
					throw new Error('Invalid vendor RawBT envelope');
				serverBytes = Uint8Array.from(
					atob(messages[0].slice(prefix.length, -suffix.length)),
					(char) => char.charCodeAt(0)
				);
			}
			const image = new Image();
			image.src = expected.imageUrl;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(image, 0, 0);
			const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			let pixelParity = true;
			for (let p = 0; p < canvas.width * canvas.height; p++) {
				const bit = !!(expected.bitmap.bytes[p >> 3] & (0x80 >> (p & 7)));
				if (pixels[p * 4] !== (bit ? 0 : 255) || pixels[p * 4 + 3] !== 255) pixelParity = false;
			}
			const overflow = expected.layout.nodes.filter((node) => {
				if (node.type !== 'text') return false;
				ctx.font = (node.bold ? 'bold ' : '') + node.size + 'px "Courier New", monospace';
				const width = ctx.measureText(node.text).width;
				const left =
					node.x - (node.align === 'right' ? width : node.align === 'center' ? width / 2 : 0);
				return (
					left < 11.9 || left + width > canvas.width - 11.9 || node.y + node.size > canvas.height
				);
			}).length;
			const orderLabel = expected.layout.nodes.find(
				(node) => node.type === 'text' && node.text === 'NOMOR PESANAN'
			);
			const orderNumber = expected.layout.nodes.find(
				(node) => node.type === 'text' && node.text === '007'
			);
			return {
				error,
				orderNumberProminent:
					orderLabel?.type === 'text' &&
					orderNumber?.type === 'text' &&
					orderNumber.bold &&
					orderNumber.size >= 40 &&
					orderNumber.size > orderLabel.size &&
					orderNumber.align === 'center' &&
					orderNumber.x === canvas.width / 2,
				concurrentError,
				closed,
				requests,
				httpRequests,
				sockets: socketUrls.length,
				messages: messages.length,
				wireParity:
					method === 'server'
						? serverBytes.length === expectedBytes.length &&
							serverBytes.every((byte, i) => byte === expectedBytes[i])
						: bytes.length === expectedBytes.length &&
							bytes.every((byte, i) => byte === expectedBytes[i]),
				maxChunk: Math.max(0, ...chunks.map((chunk) => chunk.length)),
				pixelParity,
				overflow,
				width: canvas.width,
				logoInk: expected.bitmap.bytes
					.slice((12 * canvas.width) / 8, (108 * canvas.width) / 8)
					.some((byte) => byte !== 0),
				paperMatches: method !== 'server' || serverBytes[9] === (paperSize === '80mm' ? 72 : 48),
				unsafeHtml: messages.some((message) => message.includes('<script>'))
			};
		},
		{ method, paperSize, failure }
	);
}

for (const paperSize of ['58mm', '80mm'] as const) {
	for (const method of ['usb', 'bluetooth', 'server'] as const) {
		test(`receipt renderer preserves pixels, logo, wrapping and paper for ${method} ${paperSize}`, async ({
			page
		}) => {
			const result = await exercisePrinter(page, method, paperSize);
			expect(result.error).toBe('');
			expect(result.wireParity).toBe(true);
			expect(result.pixelParity).toBe(true);
			expect(result.orderNumberProminent).toBe(true);
			expect(result.logoInk).toBe(true);
			expect(result.overflow).toBe(0);
			expect(result.width).toBe(paperSize === '80mm' ? 576 : 384);
			expect(result.paperMatches).toBe(true);
			expect(result.unsafeHtml).toBe(false);
			if (method !== 'server')
				expect(result.maxChunk).toBeLessThanOrEqual(method === 'usb' ? 4096 : 20);
		});
	}
}

for (const failure of ['partial', 'stall', 'concurrent'] as const) {
	test(`receipt USB handles ${failure} without silent loss or duplicate print`, async ({
		page
	}) => {
		const result = await exercisePrinter(page, 'usb', '58mm', failure);
		if (failure === 'stall') {
			expect(result.error).toContain('Pengiriman USB tidak lengkap');
			expect(result.closed).toBe(true);
		} else {
			expect(result.error).toBe('');
			expect(result.wireParity).toBe(true);
		}
		if (failure === 'concurrent')
			expect(result.concurrentError).toContain('Pencetakan masih berlangsung');
	});
}

for (const failure of ['pre-send', 'post-send'] as const) {
	test(`receipt server handles ${failure} without uncertain automatic retries`, async ({
		page
	}) => {
		const result = await exercisePrinter(page, 'server', '58mm', failure);
		if (failure === 'pre-send') {
			expect(result.error).toContain('Server printer lokal tidak merespons');
			expect(result.sockets).toBe(2);
			expect(result.httpRequests).toBe(0);
		} else {
			expect(result.error).toContain('Periksa struk sebelum mencetak ulang');
			expect(result.sockets).toBe(1);
			expect(result.httpRequests).toBe(0);
		}
		expect(result.messages).toBe(failure === 'pre-send' ? 0 : 1);
	});
}

for (const width of [1440, 320]) {
	test(`receipt preview uses renderer, changes paper and fits viewport ${width}`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 900 });
		await openPrinterSettings(page);
		await page.locator('#nama-toko').fill('Zatiaras Cabang Pengujian Nama Panjang');
		await page.locator('#alamat').fill('Alamat cabang panjang '.repeat(8));
		await page.getByRole('button', { name: 'Tampilan Struk', exact: true }).click();
		const preview = page.getByTestId('receipt-preview');
		await expect(preview).toBeVisible();
		await expect(preview).toHaveAttribute('width', '384');
		await preview.screenshot({ path: test.info().outputPath(`receipt-${width}-58mm-paper.png`) });
		const first = await preview.getAttribute('src');
		await page.getByRole('radio', { name: '80 mm', exact: true }).check();
		await expect(preview).toHaveAttribute('width', '576');
		expect(await preview.getAttribute('src')).not.toBe(first);
		await page.getByText('Isi contoh struk', { exact: true }).click();
		await expect(page.locator('pre')).toContainText('Rp39.000');
		await expect(page.locator('pre')).toContainText('Rp11.000');
		await expect(page.locator('pre')).toContainText(/NOMOR PESANAN\s+007/);
		await preview.screenshot({ path: test.info().outputPath(`receipt-${width}-80mm-paper.png`) });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({
			path: test.info().outputPath(`receipt-${width}-80mm.png`),
			fullPage: true
		});
	});
}

// Halaman Pengaturan Pemilik > Keamanan setelah dipecah ke store +
// kartu. Mock jaringan; tidak ada kredensial atau PIN nyata yang diubah.
async function mockSettingsSession(page: Page, role: 'pemilik' | 'kasir' = 'pemilik') {
	const writes: Array<{ method: string; url: string; body: unknown }> = [];
	await page.clock.setFixedTime(new Date('2026-10-20T04:00:00.000Z'));
	const expiresAt = Date.parse('2026-10-20T05:00:00.000Z');
	await page.addInitScript(
		({ role, expiresAt }) => {
			localStorage.setItem('selectedBranch', 'samarinda');
			localStorage.setItem(
				'zatiaras_session',
				JSON.stringify({
					isAuthenticated: true,
					user: { id: 'u', username: 'pengaturanuji', role, branch: 'samarinda' },
					expiresAt
				})
			);
		},
		{ role, expiresAt }
	);
	await page.route('**/api/**', async (route) => {
		const request: Request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		if (request.method() !== 'GET') {
			writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
			await route.fulfill({ json: { ok: true } });
			return;
		}
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated: true,
						user: { id: 'u', username: 'pengaturanuji', role, branch: 'samarinda' },
						expiresAt
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: path === '/api/pengaturan'
						? [{ id: 'cfg-1', pinConfigured: true, halaman_terkunci: ['catat'] }]
						: (path === '/api/buku-kas' ||
									path === '/api/transaksi-kasir' ||
									path === '/api/pos/history') &&
							  url.searchParams.get('pagination') === 'cursor'
							? { data: [], nextCursor: null, hasMore: false }
							: [];
		await route.fulfill({ json: data });
	});
	return writes;
}

function expectOnlyNotificationRegistration(
	writes: Awaited<ReturnType<typeof mockSettingsSession>>
) {
	// Layout mendaftarkan perangkat notifikasi saat mount; navigasi tidak boleh memutasi pengaturan.
	for (const write of writes) {
		expect(new URL(write.url).pathname).toBe('/api/antrean/notifikasi/perangkat');
		expect(write.method).toBe('POST');
	}
}

for (const viewport of [
	{ name: 'desktop', width: 1440, height: 900, columns: 4 },
	{ name: 'tablet', width: 820, height: 1180, columns: 2 },
	{ name: 'mobile', width: 390, height: 844, columns: 1 },
	{ name: 'small mobile', width: 320, height: 740, columns: 1 }
]) {
	test(`settings keep four balanced menus and owner access (${viewport.name})`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		const writes = await mockSettingsSession(page);
		await gotoHydrated(page, '/pengaturan', 'h2:text-is("Pemilik Kios")');
		const manageBusiness = page.getByRole('link', { name: 'Kelola usaha', exact: true });
		await expect(manageBusiness).toBeVisible();
		await expect(manageBusiness).toHaveAttribute('href', '/pengaturan/pemilik');

		const menus = page.getByRole('navigation', { name: 'Menu pengaturan', exact: true });
		const items = menus.locator('a, button');
		await expect(menus.getByRole('link')).toHaveCount(3);
		await expect(menus.getByRole('button')).toHaveCount(1);
		await expect(items).toHaveCount(4);
		await expect(items).toHaveText([
			/Antrean.*Notifikasi/,
			/Draft Struk.*Thermal/,
			/Riwayat.*Hari Ini/,
			/Install PWA.*App Offline/
		]);
		await expect(menus.getByRole('link', { name: 'Kelola usaha' })).toHaveCount(0);
		await expect(menus.getByRole('button', { name: /^Install PWA/ })).toBeEnabled();
		const bounds = await items.evaluateAll((elements) =>
			elements.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			})
		);
		expect(new Set(bounds.map(({ x }) => Math.round(x))).size).toBe(viewport.columns);
		expect(new Set(bounds.map(({ y }) => Math.round(y))).size).toBe(4 / viewport.columns);
		for (const item of bounds) {
			expect(Math.abs(item.width - bounds[0].width)).toBeLessThan(1);
			expect(Math.abs(item.height - bounds[0].height)).toBeLessThan(1);
			expect(item.height).toBeGreaterThanOrEqual(44);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({
			path: test.info().outputPath(`settings-${viewport.name.replaceAll(' ', '-')}.png`),
			fullPage: true
		});

		await manageBusiness.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/pengaturan\/pemilik$/);
		expectOnlyNotificationRegistration(writes);
	});
}

test('cashier settings preserve menu actions without owner access', async ({ page }) => {
	const writes = await mockSettingsSession(page, 'kasir');
	await gotoHydrated(page, '/pengaturan', 'h2:text-is("Kasir Kios")');
	await expect(page.getByRole('heading', { name: 'Kasir Kios', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Kelola usaha', exact: true })).toHaveCount(0);
	const menus = page.getByRole('navigation', { name: 'Menu pengaturan', exact: true });
	await expect(menus.getByRole('link')).toHaveCount(3);
	await expect(menus.getByRole('button')).toHaveCount(1);
	const install = menus.getByRole('button', { name: /^Install PWA/ });
	await expect(install).toBeEnabled();
	await page.locator('pwa-install').evaluate((element) => {
		Object.defineProperty(element, 'showDialog', {
			value: () => element.setAttribute('data-install-requested', 'true'),
			configurable: true
		});
	});
	await install.click();
	await expect(page.locator('pwa-install')).toHaveAttribute('data-install-requested', 'true');

	await page.getByRole('button', { name: 'Logout', exact: true }).click();
	const logout = page.getByRole('dialog', { name: 'Konfirmasi Logout', exact: true });
	await expect(logout).toBeVisible();
	await logout.getByRole('button', { name: 'Batal', exact: true }).click();
	await expect(logout).toBeHidden();
	expectOnlyNotificationRegistration(writes);

	for (const [menu, path] of [
		['Antrean', '/pengaturan/antrean'],
		['Draft Struk', '/pengaturan/printer'],
		['Riwayat', '/pengaturan/riwayat']
	]) {
		await gotoHydrated(page, '/pengaturan', 'h2:text-is("Kasir Kios")');
		await expect(page.getByRole('heading', { name: 'Kasir Kios', exact: true })).toBeVisible();
		await page
			.getByRole('navigation', { name: 'Menu pengaturan', exact: true })
			.getByRole('link', { name: new RegExp(`^${menu}`) })
			.click();
		await expect(page).toHaveURL(new RegExp(`${path}$`));
	}
	expectOnlyNotificationRegistration(writes);
});

test('security settings render, validate PIN locally, and save locked pages once', async ({
	page
}) => {
	const writes = await mockSettingsSession(page);
	await gotoHydrated(page, '/pengaturan/pemilik/gantikeamanan', 'text=Kredensial Akun');

	// Field PIN lama hanya muncul setelah mount() memuat pengaturan: penanda hidrasi.
	await expect(page.getByPlaceholder('PIN lama (4 angka)')).toBeVisible({ timeout: 15000 });

	// Kredensial: tab Kasir menampilkan form kasir; kembali ke Pemilik.
	await page.getByText('Akun Kasir', { exact: true }).click();
	await expect(page.getByPlaceholder('Masukkan password kasir saat ini')).toBeVisible();
	await page.getByText('Akun Pemilik', { exact: true }).click();
	await expect(page.getByPlaceholder('Masukkan password saat ini')).toBeVisible();

	// PIN: konfirmasi tidak cocok ditolak di klien tanpa request.
	await page.getByPlaceholder('PIN lama (4 angka)').fill('2580');
	await page.getByPlaceholder('PIN baru (4 angka)').fill('1357');
	await page.getByPlaceholder('Ulangi PIN (4 angka)').fill('1358');
	await page.getByPlaceholder('Ulangi PIN (4 angka)').press('Enter');
	await expect(page.getByText('Konfirmasi PIN tidak cocok.')).toBeVisible();
	expect(writes.filter((w) => w.url.includes('/api/pin'))).toHaveLength(0);

	// Halaman terkunci: status awal dari server dikirim ulang tepat sekali.
	await page.getByRole('button', { name: 'Simpan Pengaturan Halaman' }).click();
	await expect.poll(() => writes.filter((w) => w.url.includes('/api/pengaturan')).length).toBe(1);
	expect(JSON.stringify(writes.find((w) => w.url.includes('/api/pengaturan'))?.body)).toContain(
		'"halaman_terkunci":["catat"]'
	);
	await expect(page.getByText('Pengaturan halaman terkunci berhasil disimpan!')).toBeVisible();
});
