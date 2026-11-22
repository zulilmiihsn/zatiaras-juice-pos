import { json, error } from '@sveltejs/kit';
import { requireAuthSession, requireExactRole, requireSessionBranch } from '$lib/server/apiAuth';
import { readJsonBody, bodyErrorResponse, RequestBodyError } from '$lib/server/requestBody';
import { enrollCashierDevice } from '$lib/server/enrollCashierDevice';
import { changeKioskPilot } from '$lib/server/activateKioskPilot';
import { prepareKioskCatalog } from '$lib/server/prepareKioskCatalog';
import type { RequestHandler } from './$types';
export const PUT: RequestHandler = async ({ locals, platform }) => {
	requireExactRole(requireAuthSession(locals).role, ['pemilik']);
	const branch = requireSessionBranch(locals);
	await prepareKioskCatalog(platform, branch);
	return json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
};
export const PATCH: RequestHandler = async ({ locals, platform, request }) => {
	requireExactRole(requireAuthSession(locals).role, ['pemilik']);
	const branch = requireSessionBranch(locals);
	let body: unknown;
	try {
		body = await readJsonBody(request, 256);
	} catch (cause) {
		if (cause instanceof RequestBodyError) return bodyErrorResponse(cause);
		throw cause;
	}
	if (!body || typeof body !== 'object' || !('confirm' in body) || typeof body.confirm !== 'string')
		throw error(400, 'Konfirmasi shift tutup dan antrean perangkat kosong diperlukan');
	const confirmation = /^(rollback-)?(samarinda|balikpapan|berau)-(staging|production)$/.exec(
		body.confirm
	);
	if (!confirmation) throw error(400, 'Konfirmasi pilot tidak valid');
	if (confirmation[2] !== branch) throw error(404, 'Pilot kios tidak tersedia');
	await changeKioskPilot(
		platform,
		branch,
		confirmation[1] ? 'rollback' : 'activate',
		confirmation[3] === 'staging' ? 'staging' : 'production'
	);
	return json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, platform, cookies }) => {
	const session = requireAuthSession(locals);
	const role = session.role;
	if (role !== 'pemilik' && role !== 'kasir') throw error(403, 'Akses ditolak');
	let body: unknown;
	try {
		body = await readJsonBody(request, 2048);
	} catch (cause) {
		if (cause instanceof RequestBodyError) return bodyErrorResponse(cause);
		throw cause;
	}
	if (!body || typeof body !== 'object') throw error(400, 'Data perangkat tidak valid');
	const target: Parameters<typeof enrollCashierDevice>[2] | null =
		'self' in body && body.self === true
			? { userId: session.userId, role }
			: role === 'pemilik' &&
				  'username' in body &&
				  typeof body.username === 'string' &&
				  body.username.trim()
				? { username: body.username.trim() }
				: null;
	if (!target) throw error(403, 'Daftarkan perangkat dengan akun yang sedang masuk');
	const branch = requireSessionBranch(locals, 'branch' in body ? body.branch : undefined);
	const token = await enrollCashierDevice(platform, branch, target);
	cookies.set('zatiaras_kiosk_' + branch, token, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: 48 * 60 * 60
	});
	return json({ success: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
