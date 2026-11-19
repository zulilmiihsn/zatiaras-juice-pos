import { error } from '@sveltejs/kit';
import { getD1Database, type BranchContext } from './branchResolver';

export async function enrollCashierDevice(
	platform: App.Platform | undefined,
	branch: BranchContext,
	target: { username: string } | { ownerId: string }
) {
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw error(503, 'Layanan perangkat kios belum tersedia');
	const profile = await getD1Database(platform?.env, branch)
		.prepare(
			`SELECT id AS userId, username, role, password AS verifier FROM profil WHERE cabang_id=? AND ${'ownerId' in target ? "id=? AND role='pemilik'" : "username=? AND role='kasir'"} LIMIT 2`
		)
		.bind(branch, 'ownerId' in target ? target.ownerId : target.username)
		.all<{ userId: string; username: string; role: string; verifier: string }>();
	if (profile.results.length !== 1)
		throw error(400, 'Akun tidak ditemukan atau tidak unik di cabang ini');
	const response = await hub.get(hub.idFromName('cashier:' + branch)).fetch(
		new Request('https://cashier.internal/device/enroll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(profile.results[0])
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
