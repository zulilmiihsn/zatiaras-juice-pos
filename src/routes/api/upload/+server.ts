import { json } from '@sveltejs/kit';
import { bodyErrorResponse, readJsonBody, RequestBodyError } from '$lib/server/requestBody';
import { uploadToR2, deleteFromR2 } from '$lib/server/s3Client';
import { requireAuthSession, requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import {
	isAllowedProductImageMime,
	hasProductImageSignature,
	PRODUCT_IMAGE_MAX_BYTES,
	isPublicProductImageKey,
	productImageExtension,
	extractBranchFromProductImageKey
} from '$lib/server/r2ObjectPolicy';

export async function GET({ url, platform }) {
	const key = url.searchParams.get('key');
	const bucket = platform?.env?.STORAGE;
	if (!isPublicProductImageKey(key) || !bucket) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const object = await bucket.get(key);
	if (!object) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return new Response(object.body as unknown as ReadableStream, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}

export async function POST({ request, platform, locals }) {
	// Auth sebelum try: kitError tidak boleh ketelan catch jadi 500
	const branch = requireSessionBranch(locals);
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik', 'admin']);

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;

		if (!file) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		if (!isAllowedProductImageMime(file.type)) {
			return json({ error: 'Invalid file type. Allowed: jpg, png, webp' }, { status: 400 });
		}

		if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
			return json({ error: 'File too large. Max 5MB.' }, { status: 400 });
		}

		const bucket = platform?.env?.STORAGE;
		if (!bucket) {
			return json({ error: 'Storage unavailable' }, { status: 503 });
		}

		const buffer = await file.arrayBuffer();
		if (!hasProductImageSignature(buffer, file.type)) {
			return json(
				{ error: 'Isi file tidak valid (signature gambar tidak cocok)' },
				{ status: 400 }
			);
		}

		const ext = productImageExtension(file.type);
		const key = `produk/${branch}/${crypto.randomUUID()}.${ext}`;

		const publicUrl = await uploadToR2(key, buffer, file.type, bucket, {
			branch,
			uploaded_by: session.username,
			version: '1'
		});

		return json({ url: publicUrl, key });
	} catch (err) {
		console.error('[upload] Error:', err);
		return json({ error: 'Upload failed' }, { status: 500 });
	}
}

export async function DELETE({ request, platform, locals }) {
	// Auth sebelum try: kitError tidak boleh ketelan catch jadi 500
	const branch = requireSessionBranch(locals);
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik', 'admin']);

	try {
		const { key } = ((await readJsonBody(request)) ?? {}) as { key?: unknown };

		if (!isPublicProductImageKey(key)) {
			return json({ error: 'Invalid product image key' }, { status: 400 });
		}

		// Isolasi cabang: Pemilik cabang A tidak boleh menghapus gambar milik cabang B atau legacy key
		const keyBranch = extractBranchFromProductImageKey(key);
		if (session.role !== 'admin' && (!keyBranch || keyBranch !== branch)) {
			return json(
				{ error: 'Forbidden: Cannot delete images from other branches' },
				{ status: 403 }
			);
		}

		const bucket = platform?.env?.STORAGE;
		if (!bucket) {
			return json({ error: 'Storage unavailable' }, { status: 503 });
		}

		await deleteFromR2(key, bucket);
		return json({ success: true });
	} catch (err) {
		if (err instanceof RequestBodyError) return bodyErrorResponse(err);
		console.error('[upload] Delete error:', err);
		return json({ error: 'Delete failed' }, { status: 500 });
	}
}
