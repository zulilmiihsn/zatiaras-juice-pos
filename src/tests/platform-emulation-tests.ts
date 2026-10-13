import assert from 'node:assert/strict';
import test from 'node:test';
import type { Adapter, Emulator } from '@sveltejs/kit';
import { withSingleFlightEmulation } from '../../scripts/platform-emulation.mjs';

const details = { config: {}, prerender: false as const };
function fixture() {
	let starts = 0;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const live = { env: {} } as App.Platform;
	const prerender = { env: {} } as App.Platform;
	const adapter: Adapter = {
		name: 'owned-platform-fixture',
		adapt: async () => {},
		emulate() {
			let cached: { live: App.Platform; prerender: App.Platform } | undefined;
			return {
				async platform(options) {
					// Reproduce the installed adapter's awaited assignment, not an invented transport failure.
					cached ??= await (async () => {
						starts++;
						await gate;
						return { live, prerender };
					})();
					return options.prerender ? cached.prerender : cached.live;
				}
			};
		}
	};
	return { adapter, release, live, prerender, starts: () => starts };
}
await test('cold concurrent requests initialize one proxy and preserve per-request prerender semantics', async () => {
	const f = fixture();
	const emulation = await withSingleFlightEmulation(f.adapter).emulate!();
	const requests = [
		emulation.platform!(details),
		emulation.platform!({ ...details, prerender: true }),
		emulation.platform!(details)
	];
	f.release();
	const result = await Promise.all(requests);
	assert.equal(f.starts(), 1, 'Each extra proxy competes for the same local SQLite/DO persistence');
	assert.equal(result[0], f.live);
	assert.equal(result[1], f.prerender);
	assert.equal(result[2], f.live);
});
await test('adapter wrapper stays lazy and preserves adapter capabilities and distinct emulator ownership', async () => {
	const f = fixture();
	const wrapped = withSingleFlightEmulation(f.adapter);
	assert.equal(wrapped.name, f.adapter.name);
	assert.equal(wrapped.adapt, f.adapter.adapt);
	const first = await wrapped.emulate!(),
		second = await wrapped.emulate!();
	assert.equal(f.starts(), 0);
	const requests = [first.platform!(details), second.platform!(details)];
	f.release();
	await Promise.all(requests);
	assert.equal(f.starts(), 2, 'One proxy per emulator, not a cross-environment singleton');
});
await test('startup failure propagates to all waiters and a later explicit request can recover', async () => {
	let starts = 0;
	const failure = new Error('OWNED_PLATFORM_STARTUP_FAILURE');
	const platform = { env: {} } as App.Platform;
	let cached: App.Platform | undefined;
	const adapter: Adapter = {
		name: 'owned-failure',
		adapt: async () => {},
		emulate: () => ({
			platform: async () => {
				if (!cached) {
					starts++;
					if (starts === 1) throw failure;
					cached = platform;
				}
				return cached;
			}
		})
	};
	const emulator = await withSingleFlightEmulation(adapter).emulate!();
	const result = await Promise.allSettled([
		emulator.platform!(details),
		emulator.platform!(details)
	]);
	assert.ok(result.every((item) => item.status === 'rejected' && item.reason === failure));
	assert.equal(starts, 1);
	assert.equal(await emulator.platform!(details), platform);
	assert.equal(starts, 2);
});
await test('adapters without platform emulation and async emulator factories remain supported', async () => {
	const adapter: Adapter = { name: 'no-emulation', adapt: async () => {} };
	assert.equal(withSingleFlightEmulation(adapter), adapter);
	const empty: Emulator = {};
	const asyncAdapter: Adapter = { ...adapter, emulate: async () => empty };
	assert.equal(await withSingleFlightEmulation(asyncAdapter).emulate!(), empty);
});
