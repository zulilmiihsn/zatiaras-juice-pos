import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { stripJsonc, validateD1Config } from './d1-backup.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';

const config = JSON.parse(stripJsonc(await readFile('wrangler.jsonc', 'utf8')));
const realtime = JSON.parse(stripJsonc(await readFile('wrangler.realtime.jsonc', 'utf8')));
const pagesState = config.vars?.LEGACY_CUTOVER_STATE;
const realtimeState = realtime.vars?.LEGACY_CUTOVER_STATE;
assert.equal(
	pagesState,
	realtimeState,
	'Pages dan Worker realtime harus memiliki mode cutover yang sama'
);
if (pagesState === undefined || pagesState === 'open') process.exit(0);
assert.equal(pagesState, 'paused');
assert.equal(config.name, 'zatiaraspos');
assert.equal(realtime.name, 'zatiaraspos-realtime');
assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Token pemeriksaan produksi tidak tersedia');
const pagesShards = validateD1Config(config);
assert.deepEqual(validateD1Config(realtime), pagesShards, 'Shard Pages dan realtime tidak sama');
for (const branch of ['samarinda', 'balikpapan', 'berau']) {
	const shard = pagesShards.find((item) => item.binding === `DB_${branch.toUpperCase()}_GROUP`);
	assert.equal(shard?.name, `zatiaras-${branch}-group`);
	const sql = `SELECT (SELECT count(*) FROM sesi_toko WHERE cabang_id='${branch}' AND is_active=1) AS shifts,
	 (SELECT count(*) FROM kiosk_shift_cutover WHERE cabang_id='${branch}') AS managed`;
	const invocation = wranglerInvocation([
		'd1',
		'execute',
		shard.binding,
		'--config',
		'wrangler.jsonc',
		'--remote',
		'--json',
		'--command',
		sql
	]);
	const result = spawnSync(invocation.command, invocation.args, {
		...invocation.options,
		timeout: 45_000,
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' }
	});
	if (result.error || result.status !== 0)
		throw Error(
			`${branch}: pemeriksaan shift tidak tersedia (${result.error?.code ?? result.status})`
		);
	const [response] = JSON.parse(result.stdout);
	const counts = response?.results?.[0];
	assert.ok(
		response?.success && response.meta?.changed_db === false && response.meta?.rows_written === 0,
		`${branch}: pengecekan baca-saja belum terverifikasi`
	);
	assert.equal(counts?.shifts, 0, `${branch}: shift masih aktif`);
	assert.equal(
		counts?.managed,
		0,
		`${branch}: koordinator kios aktif, pagar HTTP/Cron tidak cukup`
	);
	console.log(`${branch}: tidak ada shift aktif atau koordinator kios mengelola sumber`);
}
