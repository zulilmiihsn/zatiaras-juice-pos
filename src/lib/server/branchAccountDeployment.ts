import { BRANCH_GROUPS, getBranchDbBinding, normalizeBranch } from './branchResolver';

const bindings = Object.keys(BRANCH_GROUPS);
const branches = Object.values(BRANCH_GROUPS).flat();

function required(env: Record<string, unknown>, key: string) {
	const value = env[key];
	if (typeof value !== 'string' || !value) throw new Error(`Konfigurasi ${key} belum tersedia`);
	return value;
}

/** Reject accidental shared resources instead of silently operating with weaker isolation. */
export function readBranchAccountDeployment(env: Record<string, unknown>) {
	const publicOrigin = required(env, 'BRANCH_PUBLIC_ORIGIN');
	const candidate = env.BRANCH_PRODUCTION_CANDIDATE === 'yes';
	if (candidate && env.BRANCH_CUTOVER_STATE !== 'paused')
		throw new Error('Kandidat produksi wajib tetap dijeda');
	const bound = bindings.filter((name) => env[name] != null);
	if (env.BRANCH_ACCOUNT_MODE === 'gateway') {
		if (bound.length || env.REALTIME_HUB || env.STORAGE)
			throw new Error('Gateway tidak boleh memiliki binding data cabang');
		const state = env.BRANCH_CUTOVER_STATE;
		if (state !== undefined && state !== 'paused' && state !== 'open')
			throw new Error('Status peralihan cabang tidak valid');
		return {
			mode: 'gateway',
			paused: state === 'paused',
			publicOrigin,
			routeSecret: required(env, 'BRANCH_ROUTE_SECRET'),
			backends: new Map(
				branches.map((branch) => {
					const suffix = branch.toUpperCase();
					return [
						branch,
						{
							origin: required(env, `BRANCH_ORIGIN_${suffix}`),
							secret: required(env, `BRANCH_RELAY_${suffix}`)
						}
					];
				})
			)
		} as const;
	}
	if (env.BRANCH_ACCOUNT_MODE === 'backend') {
		const branch = normalizeBranch(required(env, 'BRANCH_ACCOUNT_IDENTITY'));
		if (bound.length !== 1 || bound[0] !== getBranchDbBinding(branch) || !env.REALTIME_HUB)
			throw new Error('Backend hanya boleh memakai D1 dan koordinator cabangnya sendiri');
		return {
			mode: 'backend',
			candidate,
			publicOrigin,
			branch,
			secret: required(env, 'BRANCH_RELAY_SECRET')
		} as const;
	}
	throw new Error('Mode deployment cabang tidak valid');
}
