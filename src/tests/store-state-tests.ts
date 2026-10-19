import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { calculateCartTotal } from '../lib/utils/performance.js';

interface HarnessProps {
	emptyCart?: boolean;
	customerName?: string;
	paymentMethod?: string;
	quantity?: number;
	portion?: 'reguler' | 'jumbo';
	jumboPrice?: number | null;
	catatMode?: 'pemasukan' | 'pengeluaran';
	repeatMode?: boolean;
}

const root = realpathSync.native(process.cwd());
const cacheParent = realpathSync.native(tmpdir());
const cacheDir = mkdtempSync(join(cacheParent, 'zatiaras-store-tests-'));
let server: ViteDevServer | undefined;
let dispose: (() => void) | undefined;
try {
	server = await createServer({
		root,
		configFile: false,
		cacheDir,
		logLevel: 'error',
		plugins: [
			{
				name: 'store-test-kit-boundaries',
				resolveId(id) {
					if (id === 'state-test-render') return '\0state-test-render';
					if (id === '$app/environment' || id === '$app/navigation') return `\0store-test:${id}`;
				},
				load(id) {
					if (id === '\0state-test-render') {
						// Renderer dan komponen harus memakai instance runtime Svelte yang sama.
						return `import {render} from 'svelte/server';
import Harness from '/src/tests/StoreStateHarness.svelte';
import {smartCache} from '$lib/utils/cache';
export function run(props) { return render(Harness, {props}).body; }
export function dispose() { smartCache.destroy(); }`;
					}
					if (id === '\0store-test:$app/environment')
						return 'export const browser=false, dev=false, building=false;';
					if (id === '\0store-test:$app/navigation')
						return 'export function goto() { throw new Error("Unexpected navigation in state contract"); }';
				}
			},
			svelte({ configFile: false })
		],
		resolve: { alias: { $lib: join(root, 'src/lib') }, dedupe: ['svelte'] },
		server: { middlewareMode: true, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
		appType: 'custom'
	});
	const harness = (await server.ssrLoadModule('state-test-render')) as {
		run: (props: HarnessProps) => string;
		dispose: () => void;
	};
	dispose = harness.dispose;
	function state(props: HarnessProps = {}): Record<string, string> {
		const html = harness.run(props);
		assert.match(html, /<output\s/);
		return Object.fromEntries(
			[...html.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])
		);
	}

	// Test POS Cart Calculation Logic (Bayar State Domain Logic)
	await test('actual payment store and cart utility agree on portion, add-ons, and quantity', () => {
		const cases: ReadonlyArray<readonly [HarnessProps, number]> = [
			[{}, 24_000],
			[{ quantity: 3, portion: 'jumbo', jumboPrice: 15_000 }, 51_000],
			[{ portion: 'jumbo', jumboPrice: 0 }, 4_000],
			[{ portion: 'jumbo', jumboPrice: null }, 24_000]
		];
		for (const [props, expected] of cases) {
			const actual = state(props);
			assert.equal(Number(actual.total), expected); // (10000 + 2000) * 2 = 24000
			const calculated = calculateCartTotal([
				{
					product: { harga: 10_000, harga_jumbo: props.jumboPrice ?? null },
					jumlah: props.quantity ?? 2,
					porsi: props.portion ?? 'reguler',
					addOns: [{ harga: 2_000 }]
				}
			]);
			assert.equal(calculated.total, expected);
			assert.equal(calculated.items, props.quantity ?? 2);
		}
	});

	await test('actual canPay rejects empty cart, missing customer, and missing payment', () => {
		assert.equal(state()['online-can-pay'], 'true');
		for (const props of [{ emptyCart: true }, { customerName: '  ' }, { paymentMethod: '' }]) {
			assert.equal(state(props)['online-can-pay'], 'false');
		}
	});

	// Offline mode fallback: QRIS is disabled or falls back to tunai
	await test('actual offline transition requires cash and retains checkout prerequisites', () => {
		for (const paymentMethod of ['qris', 'transfer', 'tunai']) {
			const actual = state({ paymentMethod });
			assert.equal(actual['offline-method'], 'tunai');
			assert.equal(actual['offline-can-pay'], 'true');
		}
		assert.equal(state({ emptyCart: true })['offline-can-pay'], 'false');
		assert.equal(state({ customerName: '' })['offline-can-pay'], 'false');
	});

	// Test Catat State Mode Switching
	await test('actual Catat transitions reset the form and choose the canonical category', () => {
		for (const [catatMode, expectedCategory] of [
			['pengeluaran', 'beban_usaha'],
			['pemasukan', 'pendapatan_usaha']
		] as const) {
			const actual = state({ catatMode });
			assert.equal(actual.mode, catatMode);
			assert.equal(actual.category, expectedCategory);
			// Reset nama when switching mode
			assert.equal(actual.name, '');
		}
	});
	await test('reselecting the active Catat mode retains entered text', () => {
		for (const catatMode of ['pemasukan', 'pengeluaran'] as const) {
			assert.equal(state({ catatMode, repeatMode: true }).name, 'Catatan dipertahankan');
		}
	});

	// Test Cash Calculation & Exact Amount (Uang Pas)
	await test('actual exact-cash action matches the total and yields zero change', () => {
		for (const props of [{}, { emptyCart: true }, { quantity: 3 }]) {
			const actual = state(props);
			assert.equal(Number(actual.cash), Number(actual.total));
			assert.equal(Number(actual.change), 0);
		}
	});
} finally {
	try {
		dispose?.();
		await server?.close();
	} finally {
		const target = realpathSync.native(cacheDir);
		assert.equal(dirname(target), cacheParent, 'Unexpected store-test cache cleanup parent');
		assert.match(
			basename(target),
			/^zatiaras-store-tests-/,
			'Unexpected store-test cache cleanup directory'
		);
		rmSync(target, { recursive: true, force: true });
		assert.equal(existsSync(target), false);
	}
}

console.log('store-state-tests: actual Svelte stores and production cart policy passed');
