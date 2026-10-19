const PRODUCT_IMAGE_PREFIX = 'produk/';

const MIME_EXTENSIONS = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
} as const;

export type ProductImageMime = keyof typeof MIME_EXTENSIONS;

export function isAllowedProductImageMime(value: string): value is ProductImageMime {
	return Object.hasOwn(MIME_EXTENSIONS, value);
}

export function productImageExtension(mime: ProductImageMime): string {
	return MIME_EXTENSIONS[mime];
}

export function isPublicProductImageKey(key: unknown): key is string {
	if (typeof key !== 'string' || !key.startsWith(PRODUCT_IMAGE_PREFIX)) return false;
	if (key.includes('..') || key.includes('\\') || key.includes('//')) return false;
	return /^produk\/(?:[a-z0-9_-]+\/)?[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(key);
}

export function extractBranchFromProductImageKey(key: string): string | null {
	const match = /^produk\/([a-z0-9_-]+)\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.exec(key);
	return match ? match[1] : null;
}

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Multipart menambah boundary, nama file, dan field form di luar byte gambar.
export const PRODUCT_IMAGE_REQUEST_MAX_BYTES = PRODUCT_IMAGE_MAX_BYTES + 256 * 1024;

/** Cocokkan magic bytes dengan MIME yang diklaim; Content-Type dari klien tidak dipercaya. */
export function hasProductImageSignature(
	data: ArrayBuffer | Uint8Array,
	mimeType: string
): boolean {
	const view = data instanceof Uint8Array ? data : new Uint8Array(data);
	const bytes = view.subarray(0, 16);
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

/** Jenis gambar dari isi file; null bila bukan jpg/png/webp. */
export function sniffProductImageMime(data: ArrayBuffer | Uint8Array): ProductImageMime | null {
	for (const mime of Object.keys(MIME_EXTENSIONS) as ProductImageMime[]) {
		if (hasProductImageSignature(data, mime)) return mime;
	}
	return null;
}

/** URL proxy same-origin untuk gambar produk di R2 (r2.dev diblokir ISP Indonesia). */
export function productImageProxyPath(key: string): string {
	return `/api/upload?key=${encodeURIComponent(key)}`;
}
