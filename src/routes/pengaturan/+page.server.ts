import { requireSessionBranch } from '$lib/server/apiAuth';
import { kioskPilotEnvironment } from '$lib/server/kioskLoginPolicy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform }) => {
	const branch = locals.authSession?.role === 'pemilik' ? requireSessionBranch(locals) : null;
	return {
		kioskBranch: branch,
		kioskPilot: branch ? kioskPilotEnvironment(platform?.env, branch) : null
	};
};
