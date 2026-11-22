import { getD1Database, normalizeBranch, type BranchId } from './branchResolver';
import { isD1DailyLimit } from './d1DailyLimit';

export function includesKioskBranch(config: string | undefined, branch: BranchId): boolean {
	return config?.split(',').some((value) => value.trim() === branch) ?? false;
}

export function kioskPilotEnvironment(
	env: App.Platform['env'] | undefined,
	branch: BranchId
): 'staging' | 'production' | null {
	const staging = branch === 'balikpapan' && env?.KIOSK_STAGING_PILOT === branch;
	const production = includesKioskBranch(env?.KIOSK_PRODUCTION_PILOT, branch);
	return staging === production ? null : staging ? 'staging' : 'production';
}

/** Only a successfully authenticated cashier on the configured branch can be redirected
 * away from normal login. An owner retains central access while D1 is healthy. */
export async function shouldRouteCentralLoginToKiosk(
	platform: App.Platform | undefined,
	user: unknown
): Promise<boolean> {
	if (
		!user ||
		typeof user !== 'object' ||
		!('role' in user) ||
		user.role !== 'kasir' ||
		!('branch' in user)
	)
		return false;
	let branch: BranchId;
	try {
		branch = normalizeBranch(user.branch);
	} catch {
		return false; // No authenticated branch to route.
	}
	if (!platform || kioskPilotEnvironment(platform.env, branch) !== 'production') return false;
	try {
		return Boolean(
			await getD1Database(platform.env, branch)
				.prepare('SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id = ? LIMIT 1')
				.bind(branch)
				.first()
		);
	} catch (cause) {
		// A mid-login quota failure must not send the cashier to a dead central POS.
		if (isD1DailyLimit(cause)) return true;
		throw cause;
	}
}
