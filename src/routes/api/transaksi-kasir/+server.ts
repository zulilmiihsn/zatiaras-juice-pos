import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { decodeDataCursor, parseDataLimit } from '$lib/server/dataPagination';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import {
	listTransaksiKasirForBranch,
	voidTransaksiKasirForBranch
} from '$lib/server/services/transaksiKasirService';
import type { RequestHandler } from './$types';

/**
 * /api/transaksi-kasir — Resource route controller untuk tabel `transaksi_kasir`.
 * Menangani HTTP auth, validasi request, dan delegasi ke transaksiKasirService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));

	const limit = parseDataLimit(url.searchParams.get('limit'));
	const cursor = decodeDataCursor(url.searchParams.get('cursor'));
	const cursorPagination = url.searchParams.get('pagination') === 'cursor' || cursor !== null;

	const filter = {
		startTime: url.searchParams.get('start'),
		endTime: url.searchParams.get('end'),
		id: url.searchParams.get('id'),
		transactionId: url.searchParams.get('transaction_id'),
		bukuKasIds: url.searchParams.get('buku_kas_ids')?.split(',').filter(Boolean) || null
	};

	const result = await listTransaksiKasirForBranch(
		platform,
		branch,
		filter,
		limit,
		cursor,
		cursorPagination
	);
	return json(result.isPage ? result.page : result.rows);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	// [CATATAN]: Blokir: transaksi POS harus lewat /api/pos/transaction (yang juga maintain agregat harian).
	throw kitError(409, 'Transaksi POS harus lewat /api/pos/transaction');
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const transactionId = url.searchParams.get('transaction_id');
	if (!transactionId) throw kitError(400, 'transaction_id diperlukan');

	const result = await voidTransaksiKasirForBranch(platform, branch, session, transactionId);
	return json(result);
};
