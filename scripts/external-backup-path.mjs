import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE_ROOT = resolve(REPO_ROOT, '..');

/** @param {string} value */
export function normalizeForCompare(value) {
	const normalized = resolve(value).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** @param {string} candidate @param {string} parent */
function isInsideOrEqual(candidate, parent) {
	const childValue = normalizeForCompare(candidate);
	const parentValue = normalizeForCompare(parent);
	return childValue === parentValue || childValue.startsWith(`${parentValue}${sep}`);
}

/** @typedef {{ lstat?: typeof lstat, realpath?: typeof realpath }} PathFs */
/** @param {string} targetPath @param {PathFs} fs */
async function nearestExistingAncestor(targetPath, fs) {
	const pathLstat = fs.lstat ?? lstat;
	let cursor = resolve(targetPath);
	/** @type {string[]} */
	const suffix = [];
	while (true) {
		try {
			await pathLstat(cursor);
			return { ancestor: cursor, suffix: suffix.reverse() };
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw new Error('Tidak menemukan ancestor tujuan yang ada');
			suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
			cursor = parent;
		}
	}
}

/**
 * Check resolved paths rather than trusting a pathname through a junction/symlink.
 * @param {string} targetPath
 * @param {{repoRoot?: string, workspaceRoot?: string, mustExist?: boolean, fs?: PathFs}} [options]
 */
export async function canonicalizeExternalPath(
	targetPath,
	{ repoRoot = REPO_ROOT, workspaceRoot = WORKSPACE_ROOT, mustExist = false, fs = {} } = {}
) {
	if (!targetPath || !isAbsolute(targetPath)) throw new Error('Tujuan wajib berupa path absolut');
	const pathRealpath = fs.realpath ?? realpath;
	const pathLstat = fs.lstat ?? lstat;
	const absolute = resolve(targetPath);
	const { ancestor, suffix } = await nearestExistingAncestor(absolute, fs);
	const canonicalCandidate = resolve(await pathRealpath(ancestor), ...suffix);
	const forbidden = await Promise.all(
		[repoRoot, workspaceRoot].map((path) => pathRealpath(path).catch(() => resolve(path)))
	);
	if (forbidden.some((path) => isInsideOrEqual(canonicalCandidate, path)))
		throw new Error('Tujuan harus berada di luar repository dan workspace');
	if (!mustExist) return canonicalCandidate;
	await pathLstat(absolute);
	const resolvedTarget = await pathRealpath(absolute);
	if (forbidden.some((path) => isInsideOrEqual(resolvedTarget, path)))
		throw new Error('Tujuan ter-resolve ke dalam repository/workspace');
	return resolvedTarget;
}
