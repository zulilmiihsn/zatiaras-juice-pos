import { error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { ArchiveUseCaseError, downloadArchiveForBranch } from '$lib/server/archiveUseCase';
import type { RequestHandler } from './$types';

/**
 * Unduh objek arsip R2 milik cabang aktif (AUD-040).
 * Lookup dari identitas job terverifikasi (id + cabang + completed),
 * BUKAN key R2 arbitrer — traversal/cabang silang ditolak 404.
 * Retry unduhan tak mengarsip/menghapus apa pun.
 * Route tipis (AUD-053): SQL + R2 di use case via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const jobId = String(url.searchParams.get('job_id') || '').trim();
	if (!jobId || jobId.length > 200) {
		throw kitError(400, 'Parameter job_id tidak valid');
	}

	try {
		const download = await downloadArchiveForBranch(platform, branch, jobId);
		return new Response(download.body, {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': `attachment; filename="${download.filename}"`,
				'Cache-Control': 'no-store',
				...(download.checksum ? { 'X-Archive-Sha256': download.checksum } : {}),
				'X-Archive-Id': download.jobId
			}
		});
	} catch (error) {
		if (error instanceof ArchiveUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};
