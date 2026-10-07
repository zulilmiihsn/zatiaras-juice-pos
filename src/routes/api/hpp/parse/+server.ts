import { json, error as kitError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAnyRole, requireAuthSession } from '$lib/server/apiAuth';
import { HppParseError, hppBranchDb, parseHppText } from '$lib/server/hppParseUseCase';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	const body = (await request.json().catch(() => null)) as { text?: string } | null;
	const text = String(body?.text || '').trim();
	if (!text) return json({ ok: true, source: 'ai', items: [] });

	const apiKey =
		((platform?.env as Record<string, unknown> | undefined)?.OPENROUTER_API_KEY as string) ||
		env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw kitError(503, 'AI belum aktif. Isi OPENROUTER_API_KEY atau input bahan manual.');
	}

	const { rawDb } = hppBranchDb(
		platform?.env as Record<string, unknown> | undefined,
		session.branch
	);
	try {
		const items = await parseHppText({
			rawDb,
			session: { userId: session.userId, role: session.role, branch: session.branch ?? '' },
			text,
			apiKey,
			platform
		});
		return json({ ok: true, source: 'ai', items });
	} catch (error) {
		if (error instanceof HppParseError) {
			if (error.code === 'RATE_LIMITED') {
				throw kitError(429, error.message);
			}
			if (error.code === 'RATE_LIMITER_UNAVAILABLE') {
				throw kitError(503, error.message);
			}
			if (error.code === 'EMPTY_RESULT') {
				throw kitError(422, error.message);
			}
			throw kitError(502, error.message);
		}
		throw error;
	}
};
