import assert from 'node:assert/strict';
import {
	AiGatewayError,
	callAiChat,
	requestAiStream,
	requestAiStreamResilient,
	type AiChatMessage
} from '$lib/server/aiGateway';

const URL = 'https://openrouter.test/v1/chat/completions';
const KEY = 'secret-key-123';
const MESSAGES: AiChatMessage[] = [{ role: 'user', content: 'halo' }];
const BASE = {
	title: 'T',
	maxTokens: 10,
	temperature: 0,
	model: 'model-utama',
	fallbacks: ['model-cadangan'],
	errorLabel: 'AI 1 Error'
};

const okContent = (content: string) =>
	new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number) => new Response('err', { status: code });
const hang = (signal?: AbortSignal | null) =>
	new Promise<Response>((_, reject) => {
		if (!signal) return;
		if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
		signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
			once: true
		});
	});

type Call = { url: string; init: RequestInit };
function scripted(
	responses: Array<Response | ((signal?: AbortSignal | null) => Promise<Response>)>
) {
	const calls: Call[] = [];
	let index = 0;
	const fetchImpl = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init: init ?? {} });
		const next = responses[Math.min(index++, responses.length - 1)];
		if (typeof next === 'function') return next(init?.signal ?? null);
		return next;
	}) as typeof fetch;
	return { fetchImpl, calls };
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body));
const noKeyLeak = (error: unknown) => assert.ok(!String((error as Error)?.message).includes(KEY));

// 1. Primary sukses: satu panggilan, model + auth benar.
{
	const { fetchImpl, calls } = scripted([okContent('hai')]);
	const out = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl);
	assert.equal(out, 'hai');
	assert.equal(calls.length, 1);
	assert.equal(bodyOf(calls[0]).model, 'model-utama');
	assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
}

// 2. Primary 429 -> fallback dipakai.
{
	const { fetchImpl, calls } = scripted([status(429), okContent('cadangan')]);
	const out = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl);
	assert.equal(out, 'cadangan');
	assert.equal(calls.length, 2);
	assert.equal(bodyOf(calls[1]).model, 'model-cadangan');
	assert.match(String((calls[1].init.headers as Record<string, string>)['X-Title']), /Fallback/);
}

// 3. Semua gagal -> UPSTREAM_ERROR + status, tanpa bocor key.
{
	const { fetchImpl, calls } = scripted([status(500), status(503)]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_ERROR');
	assert.equal(error.status, 500);
	assert.equal(error.message, 'AI 1 Error: 500');
	noKeyLeak(error);
	assert.equal(calls.length, 2);
}

// 4. Primary gantung -> timeout + abort signal.
{
	let seenSignal: AbortSignal | null = null;
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		seenSignal = (init?.signal as AbortSignal | null) ?? null;
		return hang(seenSignal);
	}) as typeof fetch;
	const started = Date.now();
	const error = await callAiChat(KEY, URL, MESSAGES, { ...BASE, timeoutMs: 50 }, fetchImpl).catch(
		(e) => e
	);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
	assert.equal(error.message, 'AI 1 Error: upstream timeout');
	noKeyLeak(error);
	assert.ok(Date.now() - started < 5000);
	assert.equal((seenSignal as AbortSignal | null)?.aborted, true);
}

// 5. Fallback gantung -> timeout juga (dulu tanpa deadline).
{
	const { fetchImpl } = scripted([status(500), (signal) => hang(signal)]);
	const error = await callAiChat(KEY, URL, MESSAGES, { ...BASE, timeoutMs: 50 }, fetchImpl).catch(
		(e) => e
	);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
}

// 6. Body malformed -> INVALID_RESPONSE.
{
	const { fetchImpl } = scripted([new Response(JSON.stringify({}), { status: 200 })]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'INVALID_RESPONSE');
	noKeyLeak(error);
}

// 7. Gagal dengan tools -> ulang tanpa tools.
{
	const tools = [{ type: 'openrouter:web_search' }];
	const { fetchImpl, calls } = scripted([status(400), okContent('tanpa-tools')]);
	const out = await callAiChat(KEY, URL, MESSAGES, { ...BASE, tools }, fetchImpl);
	assert.equal(out, 'tanpa-tools');
	assert.equal(calls.length, 2);
	assert.ok('tools' in bodyOf(calls[0]));
	assert.ok(!('tools' in bodyOf(calls[1])));
}

// 8. Fallback malformed -> '' (parity perilaku lama).
{
	const { fetchImpl } = scripted([
		status(500),
		new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
	]);
	assert.equal(await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl), '');
}

// 9. Stream tangguh: primary+no-tools gagal -> fallback sukses.
{
	const withTools = [{ type: 'openrouter:web_search' }];
	const good = new Response('stream', { status: 200 });
	const { fetchImpl, calls } = scripted([status(500), status(500), good]);
	const res = await requestAiStreamResilient(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, tools: withTools },
		fetchImpl
	);
	assert.equal(res.ok, true);
	assert.equal(calls.length, 3);
	const titles = calls.map((c) => String((c.init.headers as Record<string, string>)['X-Title']));
	assert.deepEqual(titles, ['T', 'T (No Tools)', 'T (Fallback model-cadangan)']);
}

// 10. Stream semua gagal -> respons terakhir (route memetakan 502).
{
	const { fetchImpl } = scripted([status(502), status(500)]);
	const res = await requestAiStreamResilient(KEY, URL, MESSAGES, BASE, fetchImpl);
	assert.equal(res.ok, false);
	assert.equal(res.status, 500);
}

// 11. Stream semua melempar -> error terakhir dilempar.
{
	const boom = new Error('jaringan putus');
	const fetchImpl = (async () => {
		throw boom;
	}) as typeof fetch;
	const error = await requestAiStreamResilient(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, fallbacks: [] },
		fetchImpl
	).catch((e) => e);
	assert.equal(error, boom);
}

// 12. Stream tunggal punya deadline respons awal.
{
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		return hang(init?.signal ?? null);
	}) as typeof fetch;
	const error = await requestAiStream(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, timeoutMs: 50 },
		fetchImpl
	).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
}

console.log('ai-gateway-tests: all assertions passed');
process.exit(0);
