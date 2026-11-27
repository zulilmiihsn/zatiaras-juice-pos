import { createHash } from 'node:crypto';

/** @typedef {{key: string, size: number, etag: string, lastModified: string}} ArchiveVersion */
/** @typedef {ArchiveVersion & {sha256: string}} ArchiveReference */

/**
 * A stable read, not delete authorization. A future delete must independently prevent a version
 * change after this check. The body reader is scoped to the requested key and exact byte limit.
 * @param {ArchiveReference} reference
 * @param {{metadata: (key: string) => Promise<ArchiveVersion|null>, read: (key: string, expectedSize: number) => Promise<Uint8Array|null>}} reader
 */
export async function compareArchiveVersion(reference, reader) {
	/** @param {ArchiveVersion} actual */
	const sameVersion = (actual) =>
		actual.key === reference.key &&
		actual.size === reference.size &&
		actual.etag === reference.etag &&
		actual.lastModified === reference.lastModified;
	try {
		const before = await reader.metadata(reference.key);
		if (!before) return 'missing';
		if (!sameVersion(before)) return 'changed';
		const body = await reader.read(reference.key, reference.size);
		if (!body) return 'missing';
		if (
			body.byteLength !== reference.size ||
			createHash('sha256').update(body).digest('hex') !== reference.sha256
		)
			return 'changed';
		const after = await reader.metadata(reference.key);
		if (!after) return 'missing';
		return sameVersion(after) ? 'matched' : 'changed';
	} catch {
		// Cloudflare failures are not evidence of either a match or a missing archive.
		return 'unverified';
	}
}
