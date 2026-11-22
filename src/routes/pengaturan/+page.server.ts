import { requireSessionBranch } from '$lib/server/apiAuth';
import { kioskPilotEnvironment } from '$lib/server/kioskLoginPolicy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform }) => {
	const session = locals.authSession;
	const canManageKiosk = session?.role === 'pemilik';
	const branch =
		session && (canManageKiosk || session.role === 'kasir') ? requireSessionBranch(locals) : null;
	return {
		kioskBranch: branch,
		kioskAccount: branch ? (session?.username ?? null) : null,
		canManageKiosk,
		kioskPilot: canManageKiosk && branch ? kioskPilotEnvironment(platform?.env, branch) : null
	};
};
