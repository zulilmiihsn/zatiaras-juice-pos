import type { BranchId } from './branchResolver';
import { extractBranchFromProductImageKey, isPublicProductImageKey } from './r2ObjectPolicy';

/** The caller's authenticated branch, not the object's path, determines authority. */
export function isBranchStorageKey(branch: BranchId, key: unknown): key is string {
	if (isPublicProductImageKey(key)) return extractBranchFromProductImageKey(key) === branch;
	if (typeof key !== 'string' || key.includes('..') || key.includes('\\') || key.includes('//'))
		return false;
	const match =
		/^arsip\/(samarinda|balikpapan|berau)\/(\d{4})\/arsip-(samarinda|balikpapan|berau)-(?:sebelum-\d{4}|\d{4}-\d{2}-\d{2}-sampai-\d{4}-\d{2}-\d{2})-[0-9a-f]{8}(?:\.part-\d{4,})?\.json$/.exec(
			key
		);
	return Boolean(match && match[1] === branch && match[3] === branch);
}
