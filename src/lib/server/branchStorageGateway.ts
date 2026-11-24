import type { BranchId } from './branchResolver';
import { constantTimeEqual } from './secureCompare';
import { isBranchStorageKey } from './branchStoragePolicy';
import { readBinaryBody, RequestBodyError } from './requestBody';
import { PRODUCT_IMAGE_MAX_BYTES } from './r2ObjectPolicy';
import { ARCHIVE_CHUNK_MAX_BYTES } from './archiveChunkReader';

interface SharedBucket {
	get(
		key: string
	): Promise<null | { body: ReadableStream<Uint8Array>; httpMetadata?: { contentType?: string } }>;
	put(
		key: string,
		value: Uint8Array,
		options: { httpMetadata: { contentType: string }; customMetadata?: Record<string, string> }
	): Promise<unknown>;
	delete(key: string): Promise<void>;
}

/** Transport is internal only; authorization is based on the per-branch key, not caller input. */
export function createBranchStorageGateway(
	bucket: SharedBucket,
	secrets: ReadonlyMap<BranchId, string>
) {
	if (
		secrets.size !== 3 ||
		new Set(secrets.values()).size !== 3 ||
		[...secrets.values()].some((s) => s.length < 32)
	)
		throw new Error('Kunci penyimpanan cabang tidak valid');
	return async (request: Request): Promise<Response> => {
		const supplied = request.headers.get('x-storage-secret') ?? '';
		let branch: BranchId | undefined;
		for (const [candidate, expected] of secrets) {
			if (constantTimeEqual(supplied, expected)) branch = candidate;
		}
		if (!branch) return new Response(null, { status: 401 });
		const url = new URL(request.url);
		const key = url.searchParams.get('key');
		if (
			url.pathname !== '/object' ||
			url.searchParams.getAll('key').length !== 1 ||
			!isBranchStorageKey(branch, key)
		)
			return new Response(null, { status: 404 });
		if (!['GET', 'PUT', 'DELETE'].includes(request.method))
			return new Response(null, { status: 405 });
		try {
			if (request.method === 'GET') {
				const object = await bucket.get(key);
				if (!object) return new Response(null, { status: 404 });
				return new Response(object.body, {
					headers: {
						'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
						'cache-control': 'no-store'
					}
				});
			}
			if (request.method === 'DELETE') {
				// Archive snapshots must never be deleted through the runtime relay.
				if (!key.startsWith('produk/')) return new Response(null, { status: 403 });
				await bucket.delete(key);
				return new Response(null, { status: 204 });
			}
			const archive = key.startsWith('arsip/');
			const contentType = request.headers.get('content-type') ?? '';
			if (
				archive
					? contentType !== 'application/json'
					: !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
			)
				return new Response(null, { status: 415 });
			const bytes = await readBinaryBody(
				request,
				archive ? ARCHIVE_CHUNK_MAX_BYTES : PRODUCT_IMAGE_MAX_BYTES
			);
			const rawMetadata = request.headers.get('x-storage-metadata');
			let customMetadata: Record<string, string> | undefined;
			if (rawMetadata) {
				if (rawMetadata.length > 4096) return new Response(null, { status: 400 });
				let decoded: unknown;
				try {
					const bytes = Uint8Array.from(atob(rawMetadata), (value) => value.charCodeAt(0));
					decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
				} catch {
					return new Response(null, { status: 400 });
				}
				if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
					return new Response(null, { status: 400 });
				const entries = Object.entries(decoded);
				if (
					entries.length > 8 ||
					entries.some(
						([name, value]) =>
							!/^[a-z][a-z0-9_]{0,31}$/.test(name) ||
							typeof value !== 'string' ||
							value.length > 256
					)
				)
					return new Response(null, { status: 400 });
				customMetadata = Object.fromEntries(entries) as Record<string, string>;
				if (customMetadata.branch !== branch) return new Response(null, { status: 403 });
			}
			await bucket.put(key, bytes, { httpMetadata: { contentType }, customMetadata });
			return new Response(null, { status: 204 });
		} catch (cause) {
			if (cause instanceof RequestBodyError) return new Response(null, { status: cause.status });
			// Do not leak provider errors, credentials, or object contents.
			console.warn('[branch-storage] Object operation failed', branch);
			return new Response(null, { status: 503 });
		}
	};
}
