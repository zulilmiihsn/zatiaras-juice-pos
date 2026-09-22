import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { ArchiveUseCaseError, previewArchive, runArchive } from '$lib/server/archiveUseCase';
import type { RequestHandler } from './$types';

/**
 * Preview arsip transaksi lama (sebelum tahun tertentu) tanpa mutasi data.
 * Route hanya auth + parsing + response; logika di archiveUseCase.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const year = Number(url.searchParams.get('before_year'));
	if (!Number.isInteger(year) || year < 2020 || year > 2100) {
		throw kitError(400, 'Parameter before_year tidak valid');
	}
	const rawDb = getRawDb(platform, branch);
	try {
		const preview = await previewArchive(rawDb, branch, year);
		return json({ ok: true, preview: true, ...preview });
	} catch (error) {
		if (error instanceof ArchiveUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};

/**
 * Arsip transaksi lama (sebelum tahun tertentu) milik cabang aktif.
 * Orkestrasi (klaim, snapshot R2, readback, finalisasi atomik) di archiveUseCase.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = (await request.json().catch(() => null)) as { before_year?: number } | null;
	const year = Number(body?.before_year);

	const rawDb = getRawDb(platform, branch);
	const bucket = platform?.env?.STORAGE as
		| {
				put: (k: string, v: string, o?: unknown) => Promise<unknown>;
				get: (k: string) => Promise<null | {
					text: () => Promise<string>;
					arrayBuffer: () => Promise<ArrayBuffer>;
				}>;
		  }
		| undefined;

	try {
		const result = await runArchive(rawDb, bucket, branch, year);
		if (result.kind === 'empty') {
			return json({ ok: true, count: 0, message: result.message });
		}
		if (result.kind === 'resumed') {
			return json({
				ok: true,
				resumed: true,
				count: result.count,
				key: result.key,
				...(result.filename ? { filename: result.filename } : {}),
				message: result.message
			});
		}
		return json({
			ok: true,
			count: result.count,
			key: result.key,
			filename: result.filename,
			content: result.content,
			counts: result.counts
		});
	} catch (error) {
		if (error instanceof ArchiveUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};
