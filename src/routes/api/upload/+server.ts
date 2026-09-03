import { json } from '@sveltejs/kit';
import { uploadToR2, deleteFromR2 } from '$lib/server/s3Client';
import { requireAuthSession, requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import {
	isAllowedProductImageMime,
	isPublicProductImageKey,
	productImageExtension,
	extractBranchFromProductImageKey
} from '$lib/server/r2ObjectPolicy';
import { v4 as uuidv4 } from 'uuid';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

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

function isValidImageBytes(buffer: ArrayBuffer, mimeType: string): boolean {
	const bytes = new Uint8Array(buffer.slice(0, 16));
	if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
		return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	}
	if (mimeType === 'image/png') {
		return (
			bytes.length >= 8 &&
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[4] === 0x0d &&
			bytes[5] === 0x0a &&
			bytes[6] === 0x1a &&
			bytes[7] === 0x0a
		);
	}
	if (mimeType === 'image/webp') {
		return (
			bytes.length >= 12 &&
			bytes[0] === 0x52 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x46 &&
			bytes[3] === 0x46 &&
			bytes[8] === 0x57 &&
			bytes[9] === 0x45 &&
			bytes[10] === 0x42 &&
			bytes[11] === 0x50
		);
	}
	return false;
}

export async function POST({ request, platform, locals }) {
	// [CATATAN]: Auth sebelum try: kitError tidak boleh ketelan catch jadi 500
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

		if (file.size > MAX_SIZE_BYTES) {
			return json({ error: 'File too large. Max 5MB.' }, { status: 400 });
		}

		const bucket = platform?.env?.STORAGE;
		if (!bucket) {
			return json({ error: 'Storage unavailable' }, { status: 503 });
		}

		const buffer = await file.arrayBuffer();
		if (!isValidImageBytes(buffer, file.type)) {
			return json(
				{ error: 'Isi file tidak valid (signature gambar tidak cocok)' },
				{ status: 400 }
			);
		}

		const ext = productImageExtension(file.type);
		const key = `produk/${branch}/${uuidv4()}.${ext}`;

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
	// [CATATAN]: Auth sebelum try: kitError tidak boleh ketelan catch jadi 500
	const branch = requireSessionBranch(locals);
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik', 'admin']);

	try {
		const { key } = (await request.json()) as { key: string };

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
		console.error('[upload] Delete error:', err);
		return json({ error: 'Delete failed' }, { status: 500 });
	}
}
