import { error as kitError, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.authSession) {
		throw redirect(302, '/login');
	}

	// `admin` adalah operator platform lintas-cabang. `pemilik` tetap tenant-owner
	// dan tidak boleh membaca observability tenant lain.
	if (locals.authSession.role !== 'admin') {
		throw kitError(403, 'Monitoring hanya untuk administrator platform');
	}

	return {
		user: {
			username: locals.authSession.username,
			role: locals.authSession.role,
			branch: locals.authSession.branch
		}
	};
};
