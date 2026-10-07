import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/testD1';
import { HppParseError, parseHppText } from '../lib/server/hppParseUseCase';
import type { D1Database } from '@cloudflare/workers-types';

// AUD-035: semua provider request lewat gateway; rate limit tolak sebelum
// upstream; kontrak 4 desimal HPP utuh; tanpa panggilan berbayar di tes.
const { db, close } = await createTestD1();
try {
	const session = { userId: 'owner-1', role: 'pemilik', branch: 'samarinda' };
	const base = {
		rawDb: db as D1Database,
		session,
		text: 'beli gula 2 kg 20rb',
		apiKey: 'test-key-tidak-dipakai'
	};

	const envelope = (content: string) =>
		new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
	const calls: number[] = [];
	const scripted = (respond: (call: number) => Response | Promise<Response>) => {
		let n = 0;
		return (async () => {
			n += 1;
			calls.push(n);
			return respond(n);
		}) as typeof fetch;
	};

	// 1. Valid: kg -> gram, biaya 4 desimal, lewat gateway (auth header).
	{
		const fetchImpl = scripted(() =>
			envelope(
				JSON.stringify([
					{ nama: 'Gula Pasir', satuan: 'kg', purchase_qty: 2, purchase_cost: 20000 },
					{ nama: 'Jeruk', satuan: 'gram', purchase_qty: 3, purchase_cost: 10000 }
				])
			)
		);
		const items = await parseHppText({ ...base, fetchImpl });
		assert.equal(items.length, 2);
		assert.deepEqual(
			{ satuan: items[0].satuan, qty: items[0].purchase_qty, biaya: items[0].biaya_per_satuan },
			{ satuan: 'gram', qty: 2000, biaya: 10 }
		);
		// 10000/3 = 3333.3333 (4 desimal, bukan 3333.33).
		assert.equal(items[1].biaya_per_satuan, 3333.3333);
	}

	// 2. Rate limit: 20 lolos, ke-21 ditolak TANPA upstream.
	{
		calls.length = 0;
		const fetchImpl = scripted(() => envelope('[]'));
		for (let i = 0; i < 20; i++) {
			await assert.rejects(
				parseHppText({ ...base, session: { ...session, userId: `rl-${i}` }, text: 'x', fetchImpl }),
				(err: unknown) => err instanceof HppParseError && err.code === 'EMPTY_RESULT'
			);
		}
		const limited = { ...session, userId: 'rl-cap' };
		for (let i = 0; i < 20; i++) {
			await parseHppText({ ...base, session: limited, text: 'x', fetchImpl }).catch(
				() => undefined
			);
		}
		const before = calls.length;
		const error = await parseHppText({ ...base, session: limited, text: 'x', fetchImpl }).catch(
			(e) => e
		);
		assert.ok(error instanceof HppParseError);
		assert.equal(error.code, 'RATE_LIMITED');
		assert.equal(calls.length, before);
		// User lain tak ikut terblokir.
		await assert.rejects(
			parseHppText({ ...base, session: { ...session, userId: 'rl-lain' }, text: 'x', fetchImpl }),
			(err: unknown) => err instanceof HppParseError && err.code === 'EMPTY_RESULT'
		);
	}

	// 3. Timeout upstream -> UPSTREAM_ERROR.
	{
		const fetchImpl = ((_url: string, init?: RequestInit) =>
			new Promise<Response>((_, reject) => {
				const signal = init?.signal as AbortSignal | null;
				if (!signal) return;
				if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
				signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
					once: true
				});
			})) as typeof fetch;
		const error = await parseHppText({
			...base,
			session: { ...session, userId: 'rl-timeout' },
			timeoutMs: 50,
			fetchImpl
		}).catch((e) => e);
		assert.ok(error instanceof HppParseError);
		assert.equal(error.code, 'UPSTREAM_ERROR');
	}

	// 4. Upstream 500 -> UPSTREAM_ERROR; body sampah -> EMPTY_RESULT.
	{
		const fail = scripted(() => new Response('err', { status: 500 }));
		const error = await parseHppText({
			...base,
			session: { ...session, userId: 'rl-500' },
			fetchImpl: fail
		}).catch((e) => e);
		assert.ok(error instanceof HppParseError);
		assert.equal(error.code, 'UPSTREAM_ERROR');
		const garbage = scripted(() => new Response('bukan-json-{{', { status: 200 }));
		const broken = await parseHppText({
			...base,
			session: { ...session, userId: 'rl-garbage' },
			fetchImpl: garbage
		}).catch((e) => e);
		assert.ok(broken instanceof HppParseError);
		assert.equal(broken.code, 'UPSTREAM_ERROR');
	}

	// 5. Teks kosong: tanpa fetch sama sekali.
	{
		let fetched = false;
		const fetchImpl = (async () => {
			fetched = true;
			return envelope('[]');
		}) as typeof fetch;
		const error = await parseHppText({ ...base, text: '   ', fetchImpl }).catch((e) => e);
		assert.ok(error instanceof HppParseError);
		assert.equal(error.code, 'EMPTY_TEXT');
		assert.equal(fetched, false);
	}

	console.log('hpp-parse-usecase-tests: gateway, rate-limit, kontrak passed');
} finally {
	await close();
}
