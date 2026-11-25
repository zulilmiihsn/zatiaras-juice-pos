// This temporary fixture never receives a database, user session, or browser credentials.
export default {
	/** @param {Request} request @param {{CUTOVER_STEP: string, TARGET?: string, LEGACY?: {fetch(request: Request): Promise<Response>}}} env */
	async fetch(request, env) {
		if (request.method !== 'GET' || new URL(request.url).pathname !== '/probe')
			return new Response(null, { status: 404 });
		const headers = { 'cache-control': 'no-store' };
		if (env.CUTOVER_STEP === 'source' || env.CUTOVER_STEP === 'target')
			return Response.json({ from: env.CUTOVER_STEP }, { headers });
		if (env.CUTOVER_STEP === 'paused')
			return Response.json({ from: 'paused' }, { status: 503, headers });
		if (env.CUTOVER_STEP === 'cross-account' && env.TARGET)
			return fetch(new Request(new URL('/probe', env.TARGET), { redirect: 'error' }));
		if (env.CUTOVER_STEP === 'local' && env.LEGACY)
			return env.LEGACY.fetch(new Request('https://cutover-fixture.internal/probe'));
		return new Response(null, { status: 503, headers });
	}
};
