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
