import { error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import type { RequestHandler } from './$types';

/**
 * Unduh objek arsip R2 milik cabang aktif (AUD-040).
 * Lookup dari identitas job terverifikasi (id + cabang + completed),
 * BUKAN key R2 arbitrer — traversal/cabang silang ditolak 404.
 * Retry unduhan tak mengarsip/menghapus apa pun.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const jobId = String(url.searchParams.get('job_id') || '').trim();
	if (!jobId || jobId.length > 200) {
		throw kitError(400, 'Parameter job_id tidak valid');
	}

	const rawDb = getRawDb(platform, branch);
	const job = (await rawDb
		.prepare(
			`SELECT id, object_key, checksum, counts FROM archive_jobs
			 WHERE id = ? AND cabang_id = ? AND status = 'completed' LIMIT 1`
		)
		.bind(jobId, branch)
		.first()
		.catch(() => null)) as {
		id?: string;
		object_key?: string | null;
		checksum?: string | null;
		counts?: string | null;
	} | null;

	if (!job?.object_key) {
		throw kitError(404, 'Arsip tidak ditemukan untuk cabang ini');
	}

	const bucket = platform?.env?.STORAGE as
		| {
				get: (k: string) => Promise<null | {
					text: () => Promise<string>;
					arrayBuffer: () => Promise<ArrayBuffer>;
				}>;
		  }
		| undefined;
	if (!bucket) {
		throw kitError(503, 'Storage tidak tersedia');
	}
	const object = await bucket.get(job.object_key).catch(() => null);
	if (!object) {
		throw kitError(502, 'File arsip di cloud tidak dapat dibaca. Coba lagi.');
	}

	let filename = `arsip-${branch}.json`;
	const keyBase = job.object_key.split('/').pop() || filename;
	if (/^[A-Za-z0-9._-]+\.json$/.test(keyBase)) filename = keyBase;

	return new Response(await object.arrayBuffer(), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store',
			...(job.checksum ? { 'X-Archive-Sha256': job.checksum } : {}),
			'X-Archive-Id': job.id || jobId
		}
	});
};
