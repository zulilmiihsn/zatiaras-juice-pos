import type { BranchId } from './branchResolver';
import { isBranchStorageKey } from './branchStoragePolicy';

type Transport = (request: Request) => Promise<Response>;
type PutOptions = {
	httpMetadata?: { contentType?: string };
	customMetadata?: Record<string, string>;
};

/** Minimal adapter used only by the image and archive use cases; provider failures never look like misses. */
export function createBranchStorageClient(
	branch: BranchId,
	origin: string,
	secret: string,
	transport: Transport = fetch
) {
	const url = new URL(origin);
	if (url.protocol !== 'https:' || url.origin !== origin || secret.length < 32)
		throw new Error('Konfigurasi penyimpanan cabang tidak valid');
	async function send(
		method: 'GET' | 'PUT' | 'DELETE',
		key: string,
		body?: BodyInit,
		options?: PutOptions
	) {
		if (!isBranchStorageKey(branch, key)) throw new Error('Key penyimpanan cabang tidak valid');
		const target = new URL('/object', origin);
		target.searchParams.set('key', key);
		const headers = new Headers({ 'x-storage-secret': secret });
		if (options?.httpMetadata?.contentType)
			headers.set('content-type', options.httpMetadata.contentType);
		if (options?.customMetadata) {
			const bytes = new TextEncoder().encode(JSON.stringify(options.customMetadata));
			if (bytes.length > 3072) throw new Error('Metadata penyimpanan terlalu besar');
			headers.set(
				'x-storage-metadata',
				btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
			);
		}
		const result = await transport(
			new Request(target, {
				method,
				headers,
				body,
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000)
			})
		);
		if (method === 'GET' && result.status === 404) return null;
		// Match the native R2 put result when an archive key already exists.
		if (method === 'PUT' && key.startsWith('arsip/') && result.status === 412) return null;
		if (!result.ok) throw new Error('Penyimpanan cabang sementara tidak tersedia');
		return result;
	}
	return {
		async get(key: string) {
			const response = await send('GET', key);
			if (!response) return null;
			return {
				body: response.body,
				text: () => response.text(),
				httpMetadata: { contentType: response.headers.get('content-type') ?? undefined }
			};
		},
		async put(key: string, value: string | ArrayBuffer | Uint8Array, options?: PutOptions) {
			const body =
				typeof value === 'string'
					? value
					: value instanceof Uint8Array
						? new Uint8Array(value).buffer
						: value;
			const response = await send('PUT', key, body, options);
			if (!response) return null;
		},
		async delete(key: string) {
			await send('DELETE', key);
		}
	};
}
