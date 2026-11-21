import { getD1Database, normalizeBranch, type BranchId } from './branchResolver';
import { isD1DailyLimit } from './d1DailyLimit';

export function kioskPilotEnvironment(
	env: App.Platform['env'] | undefined,
	branch: BranchId
): 'staging' | 'production' | null {
	if (branch !== 'balikpapan') return null;
	const staging = env?.KIOSK_STAGING_PILOT === branch;
	const production = env?.KIOSK_PRODUCTION_PILOT === branch;
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
	if (
		user.branch !== 'balikpapan' ||
		!platform ||
		kioskPilotEnvironment(platform.env, user.branch) !== 'production'
	)
		return false;
	const branch = normalizeBranch(user.branch);
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
