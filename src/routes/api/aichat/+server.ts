import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { resolveAiModel } from '$lib/server/aiGateway';
import {
	checkAiChatPageAccess,
	checkAiChatRateLimit,
	handleAnalyzeTransaction,
	handleRegularChat
} from '$lib/server/ai/aiChatUseCase';

// OpenRouter / AI Model configuration (env). Daftar fallback model,
// timeout, dan retry dimiliki $lib/server/aiGateway; orkestrasi AI di aiChatUseCase.
// Env dibaca di route (modul use case bebas $env agar suite unit tsx jalan).
const OPENROUTER_API_URL = env.AI_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';

function getOpenRouterApiKey(platform: App.Platform | undefined): string | undefined {
	return (
		((platform?.env as Record<string, unknown> | undefined)?.OPENROUTER_API_KEY as string) ||
		env.OPENROUTER_API_KEY
	);
}

function getOpenRouterModel(platform: App.Platform | undefined): string {
	const platformEnv = platform?.env as Record<string, unknown> | undefined;
	return resolveAiModel(
		platformEnv?.AI_MODEL as string | undefined,
		platformEnv?.OPENROUTER_MODEL as string | undefined,
		env.AI_MODEL,
		env.OPENROUTER_MODEL
	);
}

// POST Endpoint Utama /api/aichat
// Route hanya auth + rate-limit + parsing + response; orkestrasi AI di aiChatUseCase.
// Route tipis: DB + provider di use case via BranchContext.
export const POST: RequestHandler = async (event) => {
	const { url } = event;
	const session = requireAuthSession(event.locals);
	const branch = requireSessionBranch(event.locals);

	const limited = await checkAiChatRateLimit(event.platform, branch, session.userId);
	if (limited) {
		return json(limited.body, { status: limited.status, headers: limited.headers });
	}

	const action = url.searchParams.get('action');
	if (action === 'analyze') {
		const body = await event.request.json().catch(() => null);
		// Analisis teks kasir: tanpa gate halaman laporan (dipakai kasir).
		const deps = {
			apiKey: getOpenRouterApiKey(event.platform) || '',
			model: getOpenRouterModel(event.platform),
			url: OPENROUTER_API_URL,
			clientSignal: event.request.signal
		};
		const result = await handleAnalyzeTransaction(event.platform, branch, body, deps);
		return json(result.body, { status: result.status });
	}

	await checkAiChatPageAccess(event.platform, branch, session);
	const body = await event.request.json().catch(() => null);
	const result = await handleRegularChat({
		platform: event.platform,
		session,
		rawBody: body,
		deps: {
			apiKey: getOpenRouterApiKey(event.platform) || '',
			model: getOpenRouterModel(event.platform),
			url: OPENROUTER_API_URL
		},
		chatModel: getOpenRouterModel(event.platform),
		clientSignal: event.request.signal
	});
	if (result.kind === 'stream') {
		return new Response(result.stream, {
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			}
		});
	}
	return json(result.body, { status: result.status });
};
