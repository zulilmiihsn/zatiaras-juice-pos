import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Halaman online-only: tanpa sesi server langsung 302 ke /login.
 * Tanpa ini, redirect hanya mengandalkan guard client yang menunggu
 * kompilasi/hidrasi halaman besar + fetch sesi (flaky >10s di E2E).
 * API di balik halaman tetap menegakkan auth/role/branch sendiri.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.authSession) {
		throw redirect(302, '/login');
	}
	return {};
};
