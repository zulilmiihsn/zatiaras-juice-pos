import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Halaman online-only: tanpa sesi server langsung 302 ke /login.
 * Redirect hanya mengandalkan guard client menunggu hidrasi halaman +
 * fetch sesi (flaky di E2E). API di balik halaman tetap menegakkan
 * auth/role/branch sendiri.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.authSession) {
		throw redirect(302, '/login');
	}
	return {};
};
