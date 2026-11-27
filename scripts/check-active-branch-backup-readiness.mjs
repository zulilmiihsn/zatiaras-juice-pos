import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

/** A 503 can mean shift, queue, catalog or transport failure. Only 204 with the markers is proof. */
export async function checkActiveBranchBackupReadiness(inventory, master, fetchRemote = fetch) {
	assert.ok(/^[a-f0-9]{64}$/.test(master ?? ''), 'Kunci pemeriksaan produksi tidak valid');
	const { gateway, backends } = buildBranchStagingConfigs({
		...inventory,
		main: 'unused',
		publicAssets: 'unused',
		storageMain: 'unused'
	});
	assert.equal(gateway.name, 'zpos-gateway-staging');
	assert.equal(gateway.account_id, backends.samarinda.account_id);
	return Promise.all(
		Object.keys(backends).map(async (branch) => {
			const hostname = `zatiaraspos-${branch}-candidate.${inventory.backends[branch].subdomain}.workers.dev`;
			const origin = `https://${hostname}`;
			const key = createHmac('sha256', master).update(`candidate-relay:${branch}`).digest('hex');
			try {
				const result = await fetchRemote(new URL('/internal/cutover/connection', origin), {
					method: 'GET',
					headers: { 'x-zatiaras-relay-key': key, 'x-zatiaras-relay-branch': branch },
					redirect: 'error',
					signal: AbortSignal.timeout(20_000)
				});
				await result.body?.cancel();
				const verified =
					result.status === 204 &&
					result.headers.get('cache-control') === 'no-store' &&
					result.headers.get('x-zpos-operational-ready') === 'yes' &&
					result.headers.get('x-zpos-coordinator-shift') === 'closed';
				return { branch, verified, httpStatus: result.status };
			} catch {
				// No upstream errors or response bodies are operator output.
				return { branch, verified: false, httpStatus: null };
			}
		})
	);
}

async function main() {
	assert.equal(process.env.GITHUB_ACTIONS, 'true');
	assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
	assert.ok(process.env.GITHUB_STEP_SUMMARY);
	const results = await checkActiveBranchBackupReadiness(
		JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
		process.env.BRANCH_PRODUCTION_PREP_KEY
	);
	const lines = [`Pemeriksaan koordinator produksi ${new Date().toISOString()} (baca-saja):`];
	for (const { branch, verified, httpStatus } of results) {
		lines.push(
			`- ${branch}: ${verified ? 'shift tertutup dan antrean koordinator nol terverifikasi' : 'belum terverifikasi; periksa status pemilik'}${httpStatus ? ` (HTTP ${httpStatus})` : ' (probe gagal)'}`
		);
	}
	lines.push(
		'Ini snapshot status koordinator, bukan bukti antrean HP kosong atau bahwa backup D1 tertentu sudah lengkap.'
	);
	console.log(lines.join('\n'));
	await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
	if (results.some((result) => !result.verified)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().catch(() => {
		console.error(
			'Pemeriksaan kesiapan backup tidak dapat dijalankan; jangan anggap antrean kosong.'
		);
		process.exitCode = 1;
	});
}
