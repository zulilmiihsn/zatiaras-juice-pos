import { error } from '@sveltejs/kit';
import { getD1Database, type BranchContext, type BranchId } from './branchResolver';

export type KioskDeviceProfile = {
	userId: string;
	username: string;
	role: string;
	verifier: string;
};

export async function enrollCashierDevice(
	platform: App.Platform | undefined,
	branch: BranchContext,
	target: { username: string } | { userId: string; role: 'pemilik' | 'kasir' }
) {
	const profile = await getD1Database(platform?.env, branch)
		.prepare(
			`SELECT id AS userId, username, role, password AS verifier FROM profil WHERE cabang_id=? AND ${'userId' in target ? 'id=?' : 'username=?'} AND role=? LIMIT 2`
		)
		.bind(
			branch,
			'userId' in target ? target.userId : target.username,
			'role' in target ? target.role : 'kasir'
		)
		.all<KioskDeviceProfile>();
	if (profile.results.length !== 1)
		throw error(400, 'Akun tidak ditemukan atau tidak unik di cabang ini');
	return enrollVerifiedKioskDevice(platform, branch, profile.results[0]);
}

export async function enrollVerifiedKioskDevice(
	platform: App.Platform | undefined,
	branch: BranchId,
	profile: KioskDeviceProfile,
	previousToken?: string
) {
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw error(503, 'Layanan perangkat kios belum tersedia');
	const response = await hub.get(hub.idFromName('cashier:' + branch)).fetch(
		new Request('https://cashier.internal/device/enroll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...profile, previousToken }),
			signal: AbortSignal.timeout(3000)
		})
	);
	if (!response.ok) throw error(503, 'Pendaftaran perangkat belum berhasil');
	const result = (await response.json()) as { ok?: boolean; token?: unknown };
	if (
		result.ok !== true ||
		typeof result.token !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.token)
	)
		throw error(503, 'Pendaftaran perangkat belum berhasil');
	return result.token;
}
