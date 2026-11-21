import { kioskPilotEnvironment } from '$lib/server/kioskLoginPolicy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform }) => ({
	kioskPilot:
		locals.authSession?.role === 'pemilik' && locals.authSession.branch === 'balikpapan'
			? kioskPilotEnvironment(platform?.env, 'balikpapan')
			: null
});
