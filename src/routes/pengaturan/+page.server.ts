import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, platform }) => ({
	stagingKioskPilot:
		platform?.env.KIOSK_STAGING_PILOT === 'balikpapan' &&
		locals.authSession?.branch === 'balikpapan' &&
		locals.authSession.role === 'pemilik'
});
