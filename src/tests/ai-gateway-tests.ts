import assert from 'node:assert/strict';
import {
	AI_FALLBACK_MODELS,
	AiGatewayError,
	DEFAULT_AI_MODEL,
	callAiChat,
	isFreeModel,
	resolveAiModel,
	publicAiErrorMessage,
	publicAiErrorStatus,
	pumpAiStream,
	redactForLog,
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
	model: 'test/model-utama:free',
	fallbacks: ['test/model-cadangan:free'],
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
	assert.equal(bodyOf(calls[0]).model, 'test/model-utama:free');
	assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
}

// 2. Primary 429 -> fallback dipakai.
{
	const { fetchImpl, calls } = scripted([status(429), okContent('cadangan')]);
	const out = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl);
	assert.equal(out, 'cadangan');
	assert.equal(calls.length, 2);
	assert.equal(bodyOf(calls[1]).model, 'test/model-cadangan:free');
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
	const tools = [{ type: 'function', function: { name: 'cari' } }];
	const { fetchImpl, calls } = scripted([status(400), okContent('tanpa-tools')]);
	const out = await callAiChat(KEY, URL, MESSAGES, { ...BASE, tools }, fetchImpl);
	assert.equal(out, 'tanpa-tools');
	assert.equal(calls.length, 2);
	assert.ok('tools' in bodyOf(calls[0]));
	assert.ok(!('tools' in bodyOf(calls[1])));
}

// 8. Primary 500 + fallback tanpa konten -> UPSTREAM_ERROR 500 (dulu '' = gelembung
// jawaban kosong; status primary tetap dilaporkan secara deterministik).
{
	const { fetchImpl } = scripted([
		status(500),
		new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
	]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl).catch((e) => e);
	assert.equal(error?.code, 'UPSTREAM_ERROR');
	assert.equal(error?.status, 500);
}

// 8b. primary 200 tanpa konten (model kehabisan token) -> fallback dipakai.
{
	const { fetchImpl, calls } = scripted([
		new Response(
			JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: null } }] }),
			{ status: 200 }
		),
		okContent('dari cadangan')
	]);
	assert.equal(await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl), 'dari cadangan');
	assert.equal(calls.length, 2);
	assert.equal(bodyOf(calls[1]).model, 'test/model-cadangan:free');
	// Reasoning dimatikan agar max_tokens dipakai untuk jawaban.
	assert.deepEqual(bodyOf(calls[0]).reasoning, { enabled: false });
}

// 9. Stream tangguh: primary+no-tools gagal -> fallback sukses.
{
	const withTools = [{ type: 'function', function: { name: 'cari' } }];
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
	assert.deepEqual(titles, ['T', 'T (No Tools)', 'T (Fallback test/model-cadangan:free)']);
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

// 13. headers cepat tapi body macet -> UPSTREAM_TIMEOUT, tanpa bocor key.
{
	const stalled = new Response(new ReadableStream(), { status: 200 });
	const { fetchImpl } = scripted([stalled]);
	const started = Date.now();
	const error = await callAiChat(KEY, URL, MESSAGES, { ...BASE, timeoutMs: 50 }, fetchImpl).catch(
		(e) => e
	);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
	noKeyLeak(error);
	assert.ok(Date.now() - started < 5000);
}

// 14. stream tanpa chunk melewati idle -> TIMEOUT + reader dibatalkan.
{
	let cancelled = false;
	const idle = new ReadableStream({
		cancel() {
			cancelled = true;
		}
	});
	const reader = idle.getReader();
	const started = Date.now();
	const error = await pumpAiStream(reader, {
		totalMs: 5000,
		idleMs: 50,
		errorLabel: 'AI Stream Error',
		onChunk: () => {}
	}).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
	assert.equal(cancelled, true);
	assert.ok(Date.now() - started < 5000);
}

// 15. tetesan lambat melewati total -> TIMEOUT walau chunk datang.
{
	const trickle = new ReadableStream({
		async start(controller) {
			controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
			await new Promise((resolve) => setTimeout(resolve, 200));
			controller.enqueue(new TextEncoder().encode('data: {"a":2}\n\n'));
		}
	});
	const seen: string[] = [];
	const error = await pumpAiStream(trickle.getReader(), {
		totalMs: 50,
		idleMs: 5000,
		errorLabel: 'AI Stream Error',
		onChunk: (value) => {
			seen.push(new TextDecoder().decode(value));
		}
	}).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
	assert.equal(seen.length, 1);
}

// 16. putus klien -> 'aborted' diam-diam + upstream dibatalkan.
{
	let cancelled = false;
	const infinite = new ReadableStream({
		cancel() {
			cancelled = true;
		}
	});
	const client = new AbortController();
	const outcome = pumpAiStream(infinite.getReader(), {
		totalMs: 5000,
		idleMs: 5000,
		errorLabel: 'AI Stream Error',
		clientSignal: client.signal,
		onChunk: () => {}
	});
	client.abort();
	assert.equal(await outcome, 'aborted');
	assert.equal(cancelled, true);
}

// 17. onChunk minta berhenti -> 'done', lock dilepas.
{
	const two = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
			controller.enqueue(new TextEncoder().encode('data: {"a":2}\n\n'));
			controller.close();
		}
	});
	const chunks: string[] = [];
	const outcome = await pumpAiStream(two.getReader(), {
		totalMs: 5000,
		idleMs: 5000,
		errorLabel: 'AI Stream Error',
		onChunk: (value) => {
			const text = new TextDecoder().decode(value);
			chunks.push(text);
			return text.includes('[DONE]');
		}
	});
	assert.equal(outcome, 'done');
	assert.equal(chunks.length, 1);
}

// 18. attempt dibatalkan klien sejak awal -> TIMEOUT tanpa fetch gantung.
{
	const client = new AbortController();
	client.abort();
	const fetchImpl = (async (_url: string, init?: RequestInit) => {
		if ((init?.signal as AbortSignal | null)?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}
		return hang(init?.signal ?? null);
	}) as typeof fetch;
	const error = await requestAiStream(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, timeoutMs: 5000, clientSignal: client.signal },
		fetchImpl
	).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	// Putus klien dibedakan dari timeout provider.
	assert.equal(error.code, 'CLIENT_ABORTED');
	assert.equal(publicAiErrorStatus(error), 499);
	noKeyLeak(error);
}

// 19. pesan publik tetap per kelas; teks mentah tak bocor.
{
	assert.equal(
		publicAiErrorMessage(new AiGatewayError('UPSTREAM_TIMEOUT', 'x')),
		'Asisten AI kehabisan waktu. Silakan coba lagi.'
	);
	assert.equal(publicAiErrorStatus(new AiGatewayError('UPSTREAM_TIMEOUT', 'x')), 504);
	assert.equal(
		publicAiErrorMessage(new AiGatewayError('INVALID_RESPONSE', 'x')),
		'Respons AI tidak valid. Silakan coba lagi.'
	);
	assert.equal(publicAiErrorStatus(new AiGatewayError('INVALID_RESPONSE', 'x')), 502);
	assert.equal(
		publicAiErrorMessage(new AiGatewayError('UPSTREAM_ERROR', 'x', { status: 500 })),
		'Asisten AI sementara tidak dapat merespons. Silakan coba lagi.'
	);
	assert.equal(publicAiErrorStatus(new AiGatewayError('UPSTREAM_ERROR', 'x')), 502);
	assert.equal(
		publicAiErrorMessage(new Error('boom')),
		'Terjadi kesalahan saat memproses pertanyaan. Silakan coba lagi.'
	);
	assert.equal(publicAiErrorStatus(new Error('boom')), 500);
}

// 20. injeksi SQL/skema/endpoint/kredensial tak muncul di publik/log.
{
	const injected = [
		"error near SELECT * FROM profil WHERE password='x'",
		'D1_ERROR: no such table: buku_kas',
		'fetch failed: https://openrouter.ai/api/v1/chat/completions 500',
		'key sk-or-v1-abc123XYZ qwerty',
		'Authorization: Bearer sk-live-999',
		'OPENROUTER_API_KEY=sk-secret-1',
		'password=kasir123 bocor'
	];
	for (const payload of injected) {
		const error = new Error(payload);
		const publicMessage = publicAiErrorMessage(error);
		assert.ok(!publicMessage.includes(payload.slice(0, 20)), payload);
		assert.ok(!/SELECT|sk-|Bearer|password|OPENROUTER/i.test(publicMessage), payload);
		const logged = redactForLog(error);
		assert.ok(!logged.includes('sk-or-v1-abc123XYZ'), payload);
		assert.ok(!logged.includes('sk-live-999'), payload);
		assert.ok(!logged.includes('sk-secret-1'), payload);
		assert.ok(!logged.includes('kasir123'), payload);
		assert.ok(!logged.includes('Bearer sk-live-999'), payload);
	}
	// Batas panjang log.
	assert.ok(redactForLog(new Error('x'.repeat(2000))).length <= 500);
	// Non-error ikut teredaksi.
	assert.ok(!redactForLog('token sk-abcdef12345 끝').includes('sk-abcdef12345'));
}

// / F-034: resource upstream dilepas, bukan hanya respons dibatasi.
const encoder = new TextEncoder();
function tracked(chunks: string[], close: boolean) {
	const state = { cancelled: false };
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			if (close) controller.close();
		},
		cancel() {
			state.cancelled = true;
		}
	});
	return { stream, state };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// 21. Headers 200 + body macet: body dibatalkan, bukan sekadar respons 504.
{
	const body = tracked([], false);
	const { fetchImpl } = scripted([new Response(body.stream, { status: 200 })]);
	const started = Date.now();
	const error = await callAiChat(KEY, URL, MESSAGES, { ...BASE, timeoutMs: 50 }, fetchImpl).catch(
		(e) => e
	);
	await settle();
	assert.ok(error instanceof AiGatewayError);
	assert.equal(error.code, 'UPSTREAM_TIMEOUT');
	assert.equal(body.state.cancelled, true);
	assert.ok(Date.now() - started < 5000);
}

// 22. Tetesan lambat melewati deadline body: timeout + body dibatalkan.
{
	const state = { cancelled: false };
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			for (let i = 0; i < 20 && !state.cancelled; i++) {
				try {
					controller.enqueue(encoder.encode(' '));
				} catch {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		},
		cancel() {
			state.cancelled = true;
		}
	});
	const { fetchImpl } = scripted([new Response(stream, { status: 200 })]);
	const error = await callAiChat(KEY, URL, MESSAGES, { ...BASE, timeoutMs: 100 }, fetchImpl).catch(
		(e) => e
	);
	await settle();
	assert.equal(error?.code, 'UPSTREAM_TIMEOUT');
	assert.equal(state.cancelled, true);
}

// 23. JSON terpotong -> INVALID_RESPONSE tanpa bocor key.
{
	const body = tracked(['{"choices":[{"message":{"content":"ha'], true);
	const { fetchImpl } = scripted([new Response(body.stream, { status: 200 })]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl).catch((e) => e);
	assert.equal(error?.code, 'INVALID_RESPONSE');
	noKeyLeak(error);
}

// 24. Body melampaui batas ukuran -> INVALID_RESPONSE + body dibatalkan.
{
	const huge = JSON.stringify({ choices: [{ message: { content: 'x'.repeat(1_100_000) } }] });
	const body = tracked([huge.slice(0, 600_000), huge.slice(600_000)], false);
	const { fetchImpl } = scripted([new Response(body.stream, { status: 200 })]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl).catch((e) => e);
	await settle();
	assert.equal(error?.code, 'INVALID_RESPONSE');
	assert.equal(body.state.cancelled, true);
}

// 25. Klien putus saat body dibaca: body dibatalkan, tidak lanjut ke fallback.
{
	const body = tracked([], false);
	const client = new AbortController();
	const { fetchImpl, calls } = scripted([
		new Response(body.stream, { status: 200 }),
		okContent('tidak boleh dipanggil')
	]);
	const pending = callAiChat(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, timeoutMs: 5000, clientSignal: client.signal },
		fetchImpl
	).catch((e) => e);
	await settle();
	client.abort();
	const error = await pending;
	await settle();
	assert.ok(error instanceof AiGatewayError);
	assert.equal(body.state.cancelled, true);
	assert.equal(calls.length, 1);
}

// 26. Primary gagal lalu klien putus: fallback tidak memanggil upstream.
{
	const client = new AbortController();
	const { fetchImpl, calls } = scripted([
		async () => {
			client.abort();
			return status(500);
		},
		okContent('tidak boleh dipanggil')
	]);
	const error = await callAiChat(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, clientSignal: client.signal },
		fetchImpl
	).catch((e) => e);
	assert.ok(error instanceof AiGatewayError);
	assert.equal(calls.length, 1);
}

// 27. Respons gagal yang dibuang (retry/fallback) dibatalkan; fallback sah tetap jalan.
{
	const failed = tracked(['rate limited'], false);
	const { fetchImpl } = scripted([new Response(failed.stream, { status: 429 }), okContent('ok')]);
	assert.equal(await callAiChat(KEY, URL, MESSAGES, BASE, fetchImpl), 'ok');
	await settle();
	assert.equal(failed.state.cancelled, true);
}

// 28. Stream tangguh: respons gagal dibuang dibatalkan; klien putus menghentikan rantai.
{
	const failed = tracked(['err'], false);
	const good = tracked(['data: [DONE]\n\n'], true);
	const { fetchImpl } = scripted([
		new Response(failed.stream, { status: 503 }),
		new Response(good.stream, { status: 200 })
	]);
	const response = await requestAiStreamResilient(KEY, URL, MESSAGES, BASE, fetchImpl);
	await settle();
	assert.equal(response.status, 200);
	assert.equal(failed.state.cancelled, true);

	const client = new AbortController();
	const chain = scripted([
		async () => {
			client.abort();
			return status(503);
		},
		new Response('x', { status: 200 })
	]);
	await requestAiStreamResilient(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, clientSignal: client.signal },
		chain.fetchImpl
	).catch((e) => e);
	assert.equal(chain.calls.length, 1);
}

// 29. Pump: klien sudah putus sebelum mulai, atau onChunk berhenti -> upstream dibatalkan.
{
	const early = tracked(['data: x\n\n'], false);
	const client = new AbortController();
	client.abort();
	const outcome = await pumpAiStream(early.stream.getReader(), {
		errorLabel: 'AI Stream Error',
		clientSignal: client.signal,
		onChunk: () => {}
	});
	await settle();
	assert.equal(outcome, 'aborted');
	assert.equal(early.state.cancelled, true);

	const rest = tracked(['data: [DONE]\n\n', 'data: sisa\n\n'], false);
	const stopped = await pumpAiStream(rest.stream.getReader(), {
		errorLabel: 'AI Stream Error',
		onChunk: () => true
	});
	await settle();
	assert.equal(stopped, 'done');
	assert.equal(rest.state.cancelled, true);
}

// 30. Anggaran rantai non-stream: fallback berhenti saat anggaran habis.
{
	const { fetchImpl, calls } = scripted([
		status(500),
		(signal) => hang(signal),
		(signal) => hang(signal)
	]);
	const started = Date.now();
	const error = await callAiChat(
		KEY,
		URL,
		MESSAGES,
		{ ...BASE, fallbacks: ['test/fb-1:free', 'test/fb-2:free'], timeoutMs: 50, budgetMs: 30 },
		fetchImpl
	).catch((e) => e);
	assert.equal(error?.code, 'UPSTREAM_TIMEOUT');
	assert.equal(calls.length, 2);
	assert.ok(Date.now() - started < 1000);
}

// Budget AI pemilik Rp 0 — hanya model gratis, ditolak sebelum request keluar.
{
	// Router gratis memilih model acak (termasuk content-safety): tidak diizinkan.
	assert.equal(isFreeModel('openrouter/free'), false);
	assert.ok(isFreeModel('nvidia/nemotron-3.5-lightning:free'));
	assert.ok(isFreeModel(DEFAULT_AI_MODEL));
	assert.equal(resolveAiModel(undefined), DEFAULT_AI_MODEL);
	// Kandidat berbayar dilewati; kandidat :free berikutnya tetap dipakai.
	assert.equal(
		resolveAiModel('deepseek/deepseek-chat', undefined, 'google/gemma-4-31b-it:free'),
		'google/gemma-4-31b-it:free'
	);
	assert.equal(resolveAiModel('google/gemma-4-31b-it:free'), 'google/gemma-4-31b-it:free');
	for (const configured of ['openrouter/free', 'deepseek/deepseek-chat'])
		assert.equal(resolveAiModel(configured), DEFAULT_AI_MODEL, configured);
	for (const paid of [
		'deepseek/deepseek-chat',
		'openai/gpt-5',
		'x/y:free:extra',
		'free',
		'a/b:freebie'
	])
		assert.equal(isFreeModel(paid), false, paid);
	assert.ok(AI_FALLBACK_MODELS.every(isFreeModel), 'fallback default wajib gratis');

	for (const run of [
		(f: typeof fetch) =>
			callAiChat(KEY, URL, MESSAGES, { ...BASE, model: 'deepseek/deepseek-chat' }, f),
		(f: typeof fetch) =>
			requestAiStream(KEY, URL, MESSAGES, { ...BASE, model: 'deepseek/deepseek-chat' }, f)
	]) {
		let fetched = 0;
		const f = (async () => {
			fetched++;
			return okContent('tidak boleh');
		}) as unknown as typeof fetch;
		await assert.rejects(run(f), (error) => {
			assert.ok(error instanceof AiGatewayError);
			assert.equal(error.code, 'PAID_AI_REFUSED');
			assert.equal(publicAiErrorStatus(error), 500);
			assert.doesNotMatch(publicAiErrorMessage(error), /deepseek|berbayar/);
			return true;
		});
		assert.equal(fetched, 0, 'model berbayar tidak pernah dikirim ke provider');
	}
}

// Tool berbayar, konten '', dan penolakan budget yang tak boleh tertelan.
{
	let fetched = 0;
	const counting = (async () => {
		fetched++;
		return okContent('x');
	}) as unknown as typeof fetch;
	const paidTool = [{ type: 'openrouter:web_search' }];
	for (const run of [
		() => callAiChat(KEY, URL, MESSAGES, { ...BASE, tools: paidTool }, counting),
		() => requestAiStreamResilient(KEY, URL, MESSAGES, { ...BASE, tools: paidTool }, counting),
		() =>
			requestAiStreamResilient(
				KEY,
				URL,
				MESSAGES,
				{ ...BASE, model: 'deepseek/deepseek-chat' },
				counting
			)
	])
		await assert.rejects(run(), (error) => (error as AiGatewayError).code === 'PAID_AI_REFUSED');
	assert.equal(fetched, 0, 'tak ada request berbayar maupun fallback diam-diam');

	// Konten '' (bukan null) juga memicu fallback.
	const empty = scripted([okContent(''), okContent('isi')]);
	assert.equal(await callAiChat(KEY, URL, MESSAGES, BASE, empty.fetchImpl), 'isi');
	assert.equal(empty.calls.length, 2);

	// Primary kosong + fallback 429 -> UPSTREAM_ERROR 429 (kuota gratis), bukan "tidak valid".
	const quota = scripted([okContent(''), status(429)]);
	const error = await callAiChat(KEY, URL, MESSAGES, BASE, quota.fetchImpl).catch((e) => e);
	assert.equal(error?.code, 'UPSTREAM_ERROR');
	assert.equal(error?.status, 429);
}

console.log('ai-gateway-tests: all assertions passed');
process.exit(0);
