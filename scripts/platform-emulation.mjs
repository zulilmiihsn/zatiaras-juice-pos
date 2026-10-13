/** @param {import('@sveltejs/kit').Adapter} adapter */
export function withSingleFlightEmulation(adapter) {
	if (!adapter.emulate) return adapter;
	const emulate = adapter.emulate;
	return {
		...adapter,
		async emulate() {
			const emulator = await emulate.call(adapter);
			const platform = emulator.platform;
			if (!platform) return emulator;
			/** @type {Promise<App.Platform> | undefined} */
			let initialization;
			return {
				...emulator,
				/** @param {Parameters<NonNullable<import('@sveltejs/kit').Emulator['platform']>>[0]} details */
				async platform(details) {
					// Cache the in-flight initialization, not its awaited result. Cold concurrent requests
					// must not start multiple workerd proxies on the same SQLite/DO persistence.
					initialization ??= Promise.resolve().then(() => platform.call(emulator, details));
					const owned = initialization;
					try {
						await owned;
					} catch (error) {
						if (initialization === owned) initialization = undefined;
						throw error;
					}
					// The upstream now owns the initialized proxy; retain its live/prerender distinction.
					return platform.call(emulator, details);
				}
			};
		}
	};
}
