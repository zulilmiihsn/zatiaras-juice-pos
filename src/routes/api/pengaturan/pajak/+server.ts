import { json } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import { TAX_CONTRACT_VERSION } from '$lib/tax/engine';
import {
	loadTaxEnvelopeForBranch,
	saveTaxConfigForBranch
} from '$lib/server/services/taxConfigService';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const stored = await loadTaxEnvelopeForBranch(platform, branch);
	return json({
		ok: true,
		schema_version: TAX_CONTRACT_VERSION,
		revision: stored.revision,
		settings: stored.settings,
		// Kompatibel reader lama: bentuk legacy tunggal.
		data: stored.legacy
	});
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const body = (await parseBody<Record<string, unknown>>(request)) ?? {};
	// Intent cabang client harus sama dengan sesi; jangan tulis cabang lain diam-diam.
	const branch = requireSessionBranch(locals, (body.branch as string | null) ?? null);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const result = await saveTaxConfigForBranch(platform, branch, session, body);
	return json(result);
};
