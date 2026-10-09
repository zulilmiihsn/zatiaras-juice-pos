import type { RequestHandler } from '@sveltejs/kit';
import { changeCredentials } from '$lib/server/services/credentialService';

/**
 * Ganti username/password akun cabang + cabut sesi user.
 * Route hanya gate role, parsing body, dan Response.
 * Seluruh kebijakan (rate-limit, race unik, audit) di credentialService.
 * Route tipis (AUD-053): DB di service via BranchContext.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, locals, platform }) => {
	const requesterRole = locals.authSession?.role;
	if (requesterRole !== 'pemilik' && requesterRole !== 'admin') {
		return new Response(
			JSON.stringify({ success: false, code: 'FORBIDDEN', message: 'Forbidden' }),
			{
				status: 403
			}
		);
	}

	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return new Response(
			JSON.stringify({
				success: false,
				code: 'SERVER_ERROR',
				message: 'Terjadi error pada server.'
			}),
			{ status: 500 }
		);
	}

	const result = await changeCredentials({
		platform,
		session: locals.authSession,
		clientIp: getClientAddress(),
		rawBody
	});
	return new Response(JSON.stringify(result.body), {
		status: result.status,
		headers: result.headers
	});
};
