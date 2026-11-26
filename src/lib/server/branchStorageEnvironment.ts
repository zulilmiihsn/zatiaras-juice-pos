import type { BranchId } from './branchResolver';
import { createBranchStorageClient } from './branchStorageClient';

/** Keep native local bindings unchanged until shared storage is explicitly configured. */
export function withBranchStorage(env: Record<string, unknown>, branch: BranchId) {
	const {
		BRANCH_STORAGE_ORIGIN: origin,
		BRANCH_STORAGE_SECRET: secret,
		BRANCH_STORAGE_LOCAL: local
	} = env;
	if (origin === undefined && secret === undefined && local === undefined) return env;
	if (typeof origin !== 'string' || typeof secret !== 'string' || env.STORAGE)
		throw new Error('Konfigurasi penyimpanan cabang ambigu');
	let transport: ((request: Request) => Promise<Response>) | undefined;
	if (local !== undefined) {
		if (
			!local ||
			typeof local !== 'object' ||
			!('fetch' in local) ||
			typeof local.fetch !== 'function'
		)
			throw new Error('Binding penyimpanan lokal tidak valid');
		const binding = local as { fetch(request: Request): Promise<Response> };
		transport = (request) => binding.fetch(request);
	}
	return { ...env, STORAGE: createBranchStorageClient(branch, origin, secret, transport) };
}
