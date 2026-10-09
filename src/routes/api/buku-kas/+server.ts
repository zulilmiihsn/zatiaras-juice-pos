import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { payloadRows } from '$lib/server/dataApiHelpers';
import { decodeDataCursor, parseDataLimit } from '$lib/server/dataPagination';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { requirePageAccessForBranch } from '$lib/server/pageAccess';
import {
	getBukuKasListForBranch,
	insertBukuKasRowsForBranch,
	updateBukuKasRowForBranch,
	deleteBukuKasRowForBranch,
	deleteBukuKasByTransactionForBranch
} from '$lib/server/services/bukuKasService';
import { LedgerValidationError } from '$lib/server/ledgerValidation';
import type { RequestHandler } from './$types';

/**
 * /api/buku-kas — Resource route controller untuk tabel `buku_kas`.
 * Menangani HTTP auth, validasi request, dan delegasi ke bukuKasService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const session = locals.authSession!;

	const idSesiToko = url.searchParams.get('id_sesi_toko');
	const sumber = url.searchParams.get('sumber');

	// [CATATAN]: Jika query buku_kas untuk shift kasir (hitung laci kasir), bypass cek halaman catat.
	// Jika query pos (grafik omzet mingguan dashboard), izinkan jika halaman beranda atau catat terbuka.
	if (!idSesiToko) {
		if (sumber === 'pos') {
			const isUnlocked =
				session.role !== 'kasir' ||
				(Number(session.unlockExpiresAt || 0) > Date.now() &&
					Boolean(
						session.unlockedPages?.includes('beranda') || session.unlockedPages?.includes('catat')
					));
			if (!isUnlocked) {
				await requirePageAccessForBranch(platform, branch, session, 'beranda');
			}
		} else {
			await requirePageAccessForBranch(platform, branch, session, 'catat');
		}
	}

	const limit = parseDataLimit(url.searchParams.get('limit'));
	const cursor = decodeDataCursor(url.searchParams.get('cursor'));
	const cursorPagination = url.searchParams.get('pagination') === 'cursor' || cursor !== null;

	const filter = {
		startTime: url.searchParams.get('start'),
		endTime: url.searchParams.get('end'),
		sumber: url.searchParams.get('sumber'),
		tipe: url.searchParams.get('tipe'),
		id: url.searchParams.get('id'),
		transactionId: url.searchParams.get('transaction_id'),
		idSesiToko: url.searchParams.get('id_sesi_toko'),
		direction: url.searchParams.get('direction'),
		search: url.searchParams.get('search'),
		metode: url.searchParams.get('metode')
	};

	const result = await getBukuKasListForBranch(
		platform,
		branch,
		filter,
		limit,
		cursor,
		cursorPagination
	);
	return json(result.isPage ? result.page : result.rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	await requirePageAccessForBranch(platform, branch, session, 'catat');

	const rows = payloadRows(body.payload, branch);

	let result;
	try {
		result = await insertBukuKasRowsForBranch(platform, branch, session, rows);
	} catch (error) {
		if (error instanceof LedgerValidationError) throw kitError(error.status, error.message);
		throw error;
	}
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || Array.isArray(body.payload) || !body.where?.id) {
		throw kitError(400, 'Payload / id tidak valid');
	}

	await requirePageAccessForBranch(platform, branch, session, 'catat');

	const rowId = String(body.where.id);
	let result;
	try {
		result = await updateBukuKasRowForBranch(
			platform,
			branch,
			session,
			rowId,
			body.payload as Record<string, unknown>
		);
	} catch (error) {
		if (error instanceof LedgerValidationError) throw kitError(error.status, error.message);
		throw error;
	}
	return json(result);
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	const transactionId = url.searchParams.get('transaction_id');
	if (!id && !transactionId) throw kitError(400, 'id atau transaction_id diperlukan');

	await requirePageAccessForBranch(platform, branch, session, 'catat');

	if (transactionId) {
		const result = await deleteBukuKasByTransactionForBranch(
			platform,
			branch,
			session,
			transactionId
		);
		return json(result);
	}

	const result = await deleteBukuKasRowForBranch(platform, branch, session, String(id));
	return json(result);
};
