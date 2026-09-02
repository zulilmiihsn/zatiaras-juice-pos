import { env } from '$env/dynamic/private';
import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Akses R2 untuk gambar produk. Satu metode: binding STORAGE Cloudflare.
 * (Binding selalu tersedia di Workers/Pages; tidak ada jalur S3-SDK.)
 */

/**
 * Upload buffer ke R2, kembalikan URL gambar.
 * - `R2_PUBLIC_URL` diisi (mis. custom domain) → URL langsung.
 * - kosong (default) → proxy same-origin `/api/upload?key=...`. Ini bukan
 *   fallback runtime, melainkan saklar konfigurasi: proxy dipilih karena r2.dev
 *   diblokir ISP Indonesia dan proxy ikut domain app.
 */
export const uploadToR2 = async (
	key: string,
	body: ArrayBuffer | Uint8Array,
	contentType: string,
	bucket: R2Bucket,
	customMetadata?: Record<string, string>
): Promise<string> => {
	await bucket.put(key, body, {
		httpMetadata: { contentType },
		customMetadata: customMetadata || {}
	});
	const publicUrl = env.R2_PUBLIC_URL || '';
	return publicUrl ? `${publicUrl}/${key}` : `/api/upload?key=${encodeURIComponent(key)}`;
};

/** Hapus objek dari R2 lewat binding. */
export const deleteFromR2 = async (key: string, bucket: R2Bucket): Promise<void> => {
	await bucket.delete(key);
};
