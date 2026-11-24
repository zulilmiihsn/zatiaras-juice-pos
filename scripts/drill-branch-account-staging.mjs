import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import {
	assertDrillParity,
	assertSafeDrillSql,
	captureDrillParity
} from './restore-drill-local.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';

const { GITHUB_ACTIONS, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, RUNNER_TEMP } = process.env;
assert.equal(GITHUB_ACTIONS, 'true');
assert.equal(GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.match(GITHUB_RUN_ID ?? '', /^\d+$/);
assert.match(GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
assert.ok(RUNNER_TEMP);
const { backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	publicAssets: 'unused'
});
const production = await readFile('wrangler.pages.jsonc', 'utf8');
for (const [branch, config] of Object.entries(backends)) {
	const [db] = config.d1_databases;
	assert.equal(db.database_name, `zpos-${branch}-staging`);
	assert.ok(!production.includes(db.database_id), 'Target staging menunjuk D1 produksi');
}

function accountClient(branch) {
	const { account_id: account } = backends[branch];
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token staging ${branch} tidak tersedia`);
	const api = async (method, path = '', body) => {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database${path}`,
			{
				method,
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: body && JSON.stringify(body),
				signal: AbortSignal.timeout(15_000)
			}
		);
		const result = await response.json();
		if (!response.ok || !result.success)
			throw new Error(
				`${branch}: D1 ${method} HTTP ${response.status}; kode ${result.errors?.map((error) => error.code).join(',') ?? '-'}`
			);
		return result.result;
	};
	const run = (operation, args) => {
		const invocation = wranglerInvocation(args);
		const safeEnv = Object.fromEntries(
			Object.entries(process.env).filter(([key]) =>
				/^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA)$/i.test(
					key
				)
			)
		);
		const result = spawnSync(invocation.command, invocation.args, {
			...invocation.options,
			timeout: 90_000,
			env: {
				...safeEnv,
				CLOUDFLARE_API_TOKEN: token,
				WRANGLER_SEND_METRICS: 'false',
				WRANGLER_WRITE_LOGS: 'false'
			}
		});
		if (result.error || result.status !== 0) {
			const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
			// Allowlist diagnostic markers; never publish raw SQL or signed download URLs.
			const indicators = new Set(
				output.match(
					/\b(?:SQLITE_[A-Z_]+|D1_ERROR|FOREIGN KEY constraint failed|UNIQUE constraint failed|no such table|table already exists|not authorized|Authentication error|database is full|daily limit)\b/gi
				) ?? []
			);
			for (const [, code] of output.matchAll(/\[code:\s*(\d+)\]/gi)) indicators.add(`code:${code}`);
			throw new Error(
				`${branch}: Wrangler ${operation} gagal (${result.error?.code ?? result.status}); ${[...indicators].join(', ') || 'tidak ada indikator yang dikenali'}`
			);
		}
	};
	return { account, api, run };
}

async function inspectDump(file) {
	const sql = await readFile(file, 'utf8');
	assertSafeDrillSql(sql);
	const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
	try {
		db.exec(sql);
		assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
		assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
		const parity = await captureDrillParity({ all: (query) => db.prepare(query).all() });
		for (const table of ['produk', 'buku_kas', 'sesi_toko', 'profil']) assert.ok(parity[table]);
		const schema = JSON.stringify(
			db
				.prepare(
					"SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
				)
				.all()
		);
		return { parity, schema, sha256: createHash('sha256').update(sql).digest('hex') };
	} finally {
		db.close();
	}
}

async function drill(branch, dir) {
	const { account, api, run } = accountClient(branch);
	const [source] = backends[branch].d1_databases;
	const identity = await api('GET', `/${source.database_id}`);
	assert.equal(identity.name, source.database_name);
	assert.equal(identity.uuid, source.database_id);
	const scratchName = `zpos-restore-${branch}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`;
	const configure = async (name, id) => {
		const file = join(dir, `${name}.json`);
		await writeFile(
			file,
			JSON.stringify({
				name,
				account_id: account,
				d1_databases: [{ binding: 'DRILL_DB', database_name: name, database_id: id }]
			}),
			{ mode: 0o600, flag: 'wx' }
		);
		return file;
	};
	const sourceConfig = await configure(source.database_name, source.database_id);
	const backup = join(dir, `${branch}-source.sql`);
	run('export sumber', [
		'd1',
		'export',
		'DRILL_DB',
		'--remote',
		'--config',
		sourceConfig,
		'--output',
		backup
	]);
	const expected = await inspectDump(backup);
	const scratch = await api('POST', '', { name: scratchName });
	assert.match(scratch.uuid ?? '', /^[a-f0-9-]{36}$/);
	assert.ok(
		scratch.uuid !== source.database_id && !production.includes(scratch.uuid),
		'ID scratch tidak aman'
	);
	try {
		const safe = await api('GET', `/${scratch.uuid}`);
		assert.equal(safe.name, scratchName);
		assert.equal(safe.uuid, scratch.uuid);
		const scratchConfig = await configure(scratchName, scratch.uuid);
		run('import scratch', [
			'd1',
			'execute',
			'DRILL_DB',
			'--remote',
			'--yes',
			'--config',
			scratchConfig,
			'--file',
			backup
		]);
		const restoredFile = join(dir, `${branch}-restored.sql`);
		run('export scratch', [
			'd1',
			'export',
			'DRILL_DB',
			'--remote',
			'--config',
			scratchConfig,
			'--output',
			restoredFile
		]);
		const actual = await inspectDump(restoredFile);
		assertDrillParity(expected.parity, actual.parity);
		assert.ok(actual.schema === expected.schema, 'Schema hasil restore berbeda');
		console.log(`${branch}: restore D1 setara; SHA-256 backup ${expected.sha256}`);
	} finally {
		const safe = await api('GET', `/${scratch.uuid}`);
		assert.equal(safe.name, scratchName, 'Scratch tidak dihapus: identitas berubah');
		await api('DELETE', `/${scratch.uuid}`);
		console.log(`${branch}: D1 sementara dihapus`);
	}
}

const dir = await mkdtemp(join(RUNNER_TEMP, 'zpos-d1-restore-'));
try {
	for (const branch of ['samarinda', 'balikpapan', 'berau']) await drill(branch, dir);
} finally {
	await rm(dir, { recursive: true, force: true });
}
