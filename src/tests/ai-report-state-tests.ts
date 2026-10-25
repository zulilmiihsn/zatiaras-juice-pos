import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { AiReportError, streamAiReport } from '../lib/services/aiReportService';
import { clearCsrfTokenCache } from '../lib/utils/csrf';
import type { AiReportEvent } from '../lib/types/ai';
import type { createAiReportState } from '../lib/stores/aiReportState.svelte';
import type { selectedBranch } from '../lib/stores/selectedBranch.svelte';

type Stream = typeof streamAiReport;
type StreamInput = Parameters<Stream>[0];

function controlledStream() {
	const requests: Array<{ input: StreamInput; send: (event?: AiReportEvent) => Promise<void> }> =
		[];
	const stream: Stream = async function* (input) {
		type Packet = { event?: AiReportEvent; processed: () => void };
		const queue: Packet[] = [];
		let waiting: ((packet: Packet) => void) | undefined;
		requests.push({
			input,
			send: (event) =>
				new Promise<void>((processed) => {
					const packet = { event, processed };
					if (waiting) {
						const receive = waiting;
						waiting = undefined;
						receive(packet);
					} else queue.push(packet);
				})
		});
		// Deliberately allow late completion after abort: request ownership must reject it.
		while (true) {
			const packet =
				queue.shift() ??
				(await new Promise<Packet>((resolve) => {
					waiting = resolve;
				}));
			if (!packet.event) {
				packet.processed();
				return;
			}
			try {
				yield packet.event;
			} finally {
				packet.processed();
			}
		}
	};
	return { stream, requests };
}

const root = realpathSync.native(process.cwd());
const cacheParent = realpathSync.native(tmpdir());
const cacheDir = mkdtempSync(join(cacheParent, 'zatiaras-ai-state-'));
let server: ViteDevServer | undefined;
try {
	server = await createServer({
		root,
		configFile: false,
		cacheDir,
		logLevel: 'error',
		plugins: [svelte({ configFile: false })],
		resolve: { alias: { $lib: join(root, 'src/lib') }, dedupe: ['svelte'] },
		server: { middlewareMode: true, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
		appType: 'custom'
	});
	const stateModule = (await server.ssrLoadModule('/src/lib/stores/aiReportState.svelte.ts')) as {
		createAiReportState: typeof createAiReportState;
	};
	const branchModule = (await server.ssrLoadModule('/src/lib/stores/selectedBranch.svelte.ts')) as {
		selectedBranch: typeof selectedBranch;
	};
	const create = stateModule.createAiReportState;
	const branch = branchModule.selectedBranch;

	await test('actual report state accumulates typed metadata/tokens and snapshots history', async () => {
		const transport = controlledStream();
		const state = create(transport.stream);
		assert.equal(transport.requests.length, 0);
		await state.ask('   ');
		assert.equal(transport.requests.length, 0);
		const task = state.ask('  Analisis toko  ');
		assert.equal(state.isLoading, true);
		assert.equal(transport.requests[0].input.question, 'Analisis toko');
		assert.equal(transport.requests[0].input.branch, 'samarinda');
		await transport.requests[0].send({
			type: 'meta',
			dateRange: { start: '2026-10-01', end: '2026-10-02' },
			webSearch: false
		});
		await transport.requests[0].send({ type: 'token', text: 'Omzet ' });
		await transport.requests[0].send({ type: 'token', text: 'stabil.' });
		await transport.requests[0].send({ type: 'done' });
		await transport.requests[0].send();
		await task;
		assert.equal(state.isLoading, false);
		assert.equal(state.messages[1].content, 'Omzet stabil.');
		assert.deepEqual(state.messages[1].dateRange, { start: '2026-10-01', end: '2026-10-02' });
		assert.equal(state.messages[1].isStreaming, false);
		const next = state.ask('Lanjutkan');
		assert.deepEqual(transport.requests[1].input.history, [
			{ role: 'user', content: 'Analisis toko' },
			{ role: 'assistant', content: 'Omzet stabil.' }
		]);
		await transport.requests[1].send();
		await next;
		state.destroy();
	});

	await test('late stopped response cannot clear or append into its successor', async () => {
		const transport = controlledStream();
		const state = create(transport.stream);
		const old = state.ask('Pertama');
		await transport.requests[0].send({ type: 'token', text: 'Awal' });
		state.stop();
		assert.equal(transport.requests[0].input.signal.aborted, true);
		const current = state.ask('Kedua');
		await transport.requests[0].send({ type: 'token', text: 'Hasil basi' });
		await old;
		assert.equal(state.isLoading, true);
		assert.equal(transport.requests[1].input.signal.aborted, false);
		assert.equal(state.messages.at(-1)?.content, '');
		assert.ok(!state.messages.some((message) => message.content.includes('Hasil basi')));
		await transport.requests[1].send({ type: 'token', text: 'Hasil kedua' });
		await transport.requests[1].send();
		await current;
		assert.equal(state.messages.at(-1)?.content, 'Hasil kedua');
		assert.equal(state.isLoading, false);
		state.destroy();
	});

	await test('reset and destroy reject late events and abort their owned request', async () => {
		for (const action of ['reset', 'destroy'] as const) {
			const transport = controlledStream();
			const state = create(transport.stream);
			const pending = state.ask('Analisis');
			state[action]();
			assert.equal(transport.requests[0].input.signal.aborted, true);
			await transport.requests[0].send({ type: 'token', text: 'Terlambat' });
			await pending;
			assert.equal(state.messages.length, 0);
			assert.ok(!state.messages.some((message) => message.content.includes('Terlambat')));
			assert.equal(state.isLoading, false);
			if (action === 'destroy') {
				await state.ask('Setelah dibuang');
				assert.equal(transport.requests.length, 1);
			}
			state.destroy();
		}
	});

	await test('branch epoch rejects previous results even after switching back to the same branch', async () => {
		const transport = controlledStream();
		const state = create(transport.stream);
		const pending = state.ask('Analisis cabang');
		branch.value = 'berau';
		branch.value = 'samarinda';
		await transport.requests[0].send({ type: 'token', text: 'Konteks lama' });
		await pending;
		assert.equal(state.messages.length, 0);
		assert.equal(state.isLoading, false);
		assert.equal(transport.requests[0].input.signal.aborted, true);
		state.destroy();
	});

	await test('unexpected transport failures show a fixed Indonesian message', async () => {
		const state = create(async function* () {
			yield await Promise.reject<AiReportEvent>(new Error('private transport detail'));
		});
		await state.ask('Analisis');
		assert.match(state.messages.at(-1)?.content ?? '', /Terjadi kesalahan koneksi/);
		assert.ok(!state.messages.at(-1)?.content.includes('private transport detail'));
		assert.equal(state.isLoading, false);
		state.destroy();
	});

	await test('same-context notifications preserve a request while session changes invalidate it', async () => {
		const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		const storage = new Map<string, string>();
		Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value)
			}
		});
		const transport = controlledStream();
		const state = create(transport.stream);
		state.mount();
		const pending = state.ask('Tetap berjalan');
		try {
			const currentBranch = branch.value;
			branch.value = currentBranch;
			window.dispatchEvent(new Event('auth-session-refreshed'));
			assert.equal(state.isLoading, true);
			assert.equal(transport.requests[0].input.signal.aborted, false);
			storage.set('zatiaras_session_revision', 'new-session');
			window.dispatchEvent(new Event('auth-session-refreshed'));
			assert.equal(state.isLoading, false);
			assert.equal(state.messages.length, 0);
			assert.equal(transport.requests[0].input.signal.aborted, true);
		} finally {
			state.destroy();
			await transport.requests[0].send();
			await pending;
			if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
			else Reflect.deleteProperty(globalThis, 'window');
			if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		}
	});
} finally {
	await server?.close();
	assert.equal(
		dirname(cacheDir),
		cacheParent,
		'AI test cache must remain inside its temporary parent'
	);
	assert.ok(
		basename(cacheDir).startsWith('zatiaras-ai-state-'),
		'AI test cache must be owned by this suite'
	);
	rmSync(cacheDir, { recursive: true, force: true });
}

function mockResponse(response: Response) {
	clearCsrfTokenCache();
	mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
		if (String(input) === '/api/csrf') return Response.json({ token: 'deterministic-test-csrf' });
		assert.equal(String(input), '/api/aichat');
		return response;
	});
}

async function collect(signal = new AbortController().signal) {
	const events: AiReportEvent[] = [];
	for await (const event of streamAiReport({
		question: 'Analisis',
		branch: 'samarinda',
		history: [],
		signal
	}))
		events.push(event);
	return events;
}

await test('report transport decodes split UTF-8, CRLF and multiline SSE data', async () => {
	const bytes = new TextEncoder().encode(
		': keepalive\r\ndata: {"type":"meta","webSearch":false}\r\n\r\ndata: {"type":"token",\r\ndata: "text":"Kafé stabil"}\r\n\r\ndata: {"type":"done"}\r\n\r\n'
	);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (let offset = 0; offset < bytes.length; offset += 7)
				controller.enqueue(bytes.slice(offset, offset + 7));
			controller.close();
		}
	});
	mockResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
	try {
		assert.deepEqual(await collect(), [
			{ type: 'meta', webSearch: false },
			{ type: 'token', text: 'Kafé stabil' },
			{ type: 'done' }
		]);
		assert.equal(body.locked, false);
	} finally {
		mock.restoreAll();
		clearCsrfTokenCache();
	}
});

await test('report transport preserves JSON fallback and safe HTTP errors', async () => {
	mockResponse(
		Response.json({ success: true, answer: 'Ringkasan', dateRange: { start: '2026-10-01' } })
	);
	try {
		assert.deepEqual(await collect(), [
			{ type: 'meta', dateRange: { start: '2026-10-01' } },
			{ type: 'token', text: 'Ringkasan' },
			{ type: 'done' }
		]);
	} finally {
		mock.restoreAll();
		clearCsrfTokenCache();
	}
	mockResponse(
		Response.json(
			{ error: 'Data tidak tersedia', suggestion: 'Pilih periode lain' },
			{ status: 404 }
		)
	);
	try {
		await assert.rejects(
			collect(),
			(error: unknown) =>
				error instanceof AiReportError && error.message.includes('Pilih periode lain')
		);
	} finally {
		mock.restoreAll();
		clearCsrfTokenCache();
	}
});

await test('malformed events fail clearly and release the body even when cancellation fails', async () => {
	for (const data of [
		'{"type":"token","text":42}',
		'{broken',
		'{"type":"meta","webSearch":"yes"}'
	]) {
		let cancelled = 0;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
			},
			cancel() {
				cancelled++;
				throw new Error('cancel failed');
			}
		});
		mockResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
		try {
			await assert.rejects(
				collect(),
				(error: unknown) => error instanceof AiReportError && /Format respons/.test(error.message)
			);
			assert.equal(cancelled, 1);
			assert.equal(body.locked, false);
		} finally {
			mock.restoreAll();
			clearCsrfTokenCache();
		}
	}
});

await test('abort interrupts a pending body read and releases its reader', async () => {
	let cancelled = 0;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('data: {"type":"meta"}\n\n'));
		},
		cancel() {
			cancelled++;
		}
	});
	mockResponse(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
	const abort = new AbortController();
	try {
		const iterator = streamAiReport({
			question: 'Analisis',
			branch: 'samarinda',
			history: [],
			signal: abort.signal
		});
		assert.equal((await iterator.next()).value?.type, 'meta');
		const reading = iterator.next();
		abort.abort();
		await assert.rejects(
			reading,
			(error: unknown) => error instanceof Error && error.name === 'AbortError'
		);
		assert.equal(cancelled, 1);
		assert.equal(body.locked, false);
	} finally {
		mock.restoreAll();
		clearCsrfTokenCache();
	}
});
