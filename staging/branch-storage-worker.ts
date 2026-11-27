import { createBranchStorageGateway } from '../src/lib/server/branchStorageGateway.ts';

/** Only this worker owns the shared R2 binding; application backends authenticate individually. */
export default {
	async fetch(request: Request, env: Record<string, unknown>) {
		let handler;
		try {
			if (
				!env.STORAGE ||
				typeof env.STORAGE_SECRET_SAMARINDA !== 'string' ||
				typeof env.STORAGE_SECRET_BALIKPAPAN !== 'string' ||
				typeof env.STORAGE_SECRET_BERAU !== 'string'
			)
				throw new Error('Storage unavailable');
			handler = createBranchStorageGateway(
				env.STORAGE as Parameters<typeof createBranchStorageGateway>[0],
				new Map([
					['samarinda', env.STORAGE_SECRET_SAMARINDA],
					['balikpapan', env.STORAGE_SECRET_BALIKPAPAN],
					['berau', env.STORAGE_SECRET_BERAU]
				]),
				{
					readOnly:
						env.STORAGE_PRODUCTION_READ_ONLY !== undefined &&
						env.STORAGE_PRODUCTION_READ_ONLY !== 'no'
				}
			);
		} catch {
			return new Response(null, { status: 503 });
		}
		return handler(request);
	}
};
