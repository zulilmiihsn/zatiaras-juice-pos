import { json } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { buildMonitoringSnapshotForBranch, clampWindowMinutes } from '$lib/server/monitoringStatus';
import type { RequestHandler } from './$types';

/**
 * Snapshot monitoring cabang: metrik request, error, audit, backup.
 * Route hanya auth + parsing + response; agregasi di monitoringStatus.
 * Route tipis (AUD-053): DB di boundary server via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['admin']);
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const windowMinutes = clampWindowMinutes(url.searchParams.get('windowMinutes'));

	return json(await buildMonitoringSnapshotForBranch(platform, branch, windowMinutes));
};
