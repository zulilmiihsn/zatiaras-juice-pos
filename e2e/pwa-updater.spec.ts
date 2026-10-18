import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';

async function startFixture() {
	const updaterScript = transpileModule(
		readFileSync(new URL('../src/lib/utils/pwaUpdater.ts', import.meta.url), 'utf8'),
		{ compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }
	).outputText;
	let version = 1;
	let responds = true;
	const server = createServer((request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		if (request.url === '/sw.js') {
			response.setHeader('Content-Type', 'application/javascript');
			// Match the production worker's prompt protocol, including no clients.claim().
			response.end(`// fixture version ${version}
                self.addEventListener('message', event => {
                    if (${responds} && event.data?.type === 'SKIP_WAITING') {
                        event.waitUntil(self.skipWaiting());
                    }
                });`);
		} else if (request.url === '/updater.js') {
			response.setHeader('Content-Type', 'application/javascript');
			response.end(updaterScript);
		} else {
			response.setHeader('Content-Type', 'text/html; charset=utf-8');
			response.end(`<!doctype html><html lang="id"><title>Uji siklus PWA</title>
                <p id="version">${version}</p><p id="state">idle</p>
                <button type="button" disabled>Perbarui</button>
                <script type="module">
                    import { createPwaUpdater } from '/updater.js';
                    const registration = await navigator.serviceWorker.register('/sw.js');
                    await navigator.serviceWorker.ready;
                    const button = document.querySelector('button');
                    const updater = createPwaUpdater({
                        getWaiting: () => registration.waiting,
                        reload: () => {
                            sessionStorage.setItem('reloads', String(Number(sessionStorage.getItem('reloads')) + 1));
                            location.reload();
                        },
                        onState: state => {
                            document.querySelector('#state').textContent = state;
                            button.disabled = state === 'idle' || state === 'updating';
                        }
                    });
                    navigator.serviceWorker.addEventListener('controllerchange', () => updater.controlled());
                    registration.addEventListener('updatefound', () => {
                        registration.installing?.addEventListener('statechange', () => updater.sync());
                    });
                    updater.sync();
                    button.addEventListener('click', () => updater.apply());
                    document.body.dataset.ready = 'true';
                </script></html>`);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Port fixture PWA tidak tersedia');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		upgrade: (respondToMessages = true) => {
			version++;
			responds = respondToMessages;
		},
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	};
}

async function openUncontrolledTabWithUpdate(
	context: BrowserContext,
	page: Page,
	fixture: Awaited<ReturnType<typeof startFixture>>,
	responds = true
) {
	await page.goto(fixture.origin);
	await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
	expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
	// Another controlled tab holds the old worker active while the original tab stays uncontrolled.
	const blocker = await context.newPage();
	await blocker.goto(fixture.origin);
	await expect(blocker.locator('body')).toHaveAttribute('data-ready', 'true');
	expect(await blocker.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
	fixture.upgrade(responds);
	await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
	await expect(page.locator('#state')).toHaveText('available');
	await expect(blocker.locator('#state')).toHaveText('available');
	return blocker;
}

test('PWA update reloads an uncontrolled tab after activation without controllerchange', async ({
	context,
	page
}) => {
	const fixture = await startFixture();
	try {
		await openUncontrolledTabWithUpdate(context, page, fixture);
		await page.getByRole('button', { name: 'Perbarui' }).click();
		await expect(page.locator('#version')).toHaveText('2');
		await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
		expect(await page.evaluate(() => sessionStorage.getItem('reloads'))).toBe('1');
		expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
	} finally {
		await fixture.close();
	}
});

test('PWA activation from another tab waits for consent before reloading an uncontrolled tab', async ({
	context,
	page
}) => {
	const fixture = await startFixture();
	try {
		const other = await openUncontrolledTabWithUpdate(context, page, fixture);
		await other.getByRole('button', { name: 'Perbarui' }).click();
		await expect(other.locator('#version')).toHaveText('2');
		await expect(page.locator('#state')).toHaveText('reload');
		await expect(page.locator('#version')).toHaveText('1');
		expect(await page.evaluate(() => sessionStorage.getItem('reloads'))).toBeNull();
		await page.getByRole('button', { name: 'Perbarui' }).click();
		await expect(page.locator('#version')).toHaveText('2');
		expect(await page.evaluate(() => sessionStorage.getItem('reloads'))).toBe('1');
	} finally {
		await fixture.close();
	}
});

test('PWA worker without a response offers manual reload after the bounded wait', async ({
	context,
	page
}) => {
	const fixture = await startFixture();
	try {
		await openUncontrolledTabWithUpdate(context, page, fixture, false);
		await page.getByRole('button', { name: 'Perbarui' }).click();
		await expect(page.locator('#state')).toHaveText('updating');
		await expect(page.locator('#state')).toHaveText('retry');
		await expect(page.locator('#version')).toHaveText('1');
		expect(await page.evaluate(() => sessionStorage.getItem('reloads'))).toBeNull();
		await page.getByRole('button', { name: 'Perbarui' }).click();
		await expect(page.locator('#version')).toHaveText('2');
		expect(await page.evaluate(() => sessionStorage.getItem('reloads'))).toBe('1');
	} finally {
		await fixture.close();
	}
});
