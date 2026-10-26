import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The same identities seed the disposable database and distribute UI logins without relaxing limits.
export const E2E_OWNER_USERNAMES = Object.freeze([
	'pemilik',
	...Array.from({ length: 7 }, (_, index) => `pemilik-e2e-${index + 1}`)
]);

export function ownerUsernameForTest(title) {
	if (title === 'legacy status intent without a token is staged and replayed') return 'pemilik';
	let hash = 2166136261;
	for (const character of title) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return E2E_OWNER_USERNAMES[(hash >>> 0) % E2E_OWNER_USERNAMES.length];
}

/** Full gate shares the CI inventory, but never shares its auth limiter state across cohorts. */
export function resolveE2eSelections(argv, options = {}) {
	if (argv.length) return [{ name: 'selected', args: [...argv] }];
	const scripts = options.scripts || JSON.parse(readFileSync('package.json', 'utf8')).scripts;
	const specFiles =
		options.specFiles ||
		readdirSync('e2e', { recursive: true })
			.filter((file) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
			.map((file) => `e2e/${file.replaceAll('\\', '/')}`);
	const prefix = 'node scripts/run-playwright-local.mjs ';
	const selections = ['a', 'b', 'c'].map((cohort) => {
		const command = scripts[`test:e2e:ci-${cohort}`];
		if (typeof command !== 'string' || !command.startsWith(prefix)) {
			throw new Error(`E2E coverage: canonical CI cohort ${cohort} missing/invalid`);
		}
		const args = command.slice(prefix.length).trim().split(/\s+/);
		if (args.some((file) => !specFiles.includes(file))) {
			throw new Error(`E2E coverage: unknown/nonliteral spec in cohort ${cohort}`);
		}
		return { name: `ci-${cohort}`, args };
	});
	const selected = selections.flatMap(({ args }) => args);
	if (
		new Set(selected).size !== selected.length ||
		selected.length !== specFiles.length ||
		specFiles.some((file) => !selected.includes(file))
	) {
		throw new Error('E2E coverage: missing/duplicate spec; full gate refused before startup');
	}
	return selections;
}

/** Each run owns its directory. No rename, backup, or deletion of dev state. */
export function createE2eEnvironment(baseDirectory = process.env.ZATIARAS_TEST_TMPDIR || tmpdir()) {
	const directory = mkdtempSync(join(baseDirectory, 'zatiaras-e2e-'));
	const configPath = join(directory, 'wrangler.json');
	const persistPath = join(directory, 'state');
	const password = `Uat9!${randomBytes(18).toString('hex')}`;
	const bindings = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];
	try {
		writeFileSync(
			configPath,
			JSON.stringify(
				{
					name: 'zatiaras-e2e',
					compatibility_date: '2026-06-29',
					compatibility_flags: ['nodejs_compat'],
					d1_databases: bindings.map((binding) => ({
						binding,
						database_name: `e2e-${binding.toLowerCase()}`,
						database_id: randomUUID()
					})),
					r2_buckets: [{ binding: 'STORAGE', bucket_name: 'e2e-only' }],
					vars: {
						POS_PRICE_SIGNING_KEY: randomBytes(48).toString('base64url'),
						POS_PRICE_SIGNING_KEY_ID: `e2e-${randomUUID()}`
					}
				},
				null,
				2
			),
			{ mode: 0o600 }
		);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return {
		directory,
		configPath,
		persistPath,
		password,
		/** Real D1/workerd, fresh schema, fail immediately on any migration error. */
		async initialize() {
			const { getPlatformProxy } = await import('wrangler');
			const { default: bcrypt } = await import('bcryptjs');
			const proxy = await getPlatformProxy({ configPath, persist: { path: persistPath } });
			try {
				const migrations = readdirSync('drizzle')
					.filter((f) => f.endsWith('.sql'))
					.sort();
				for (const binding of bindings) {
					const db = /** @type {import('@cloudflare/workers-types').D1Database} */ (
						proxy.env[binding]
					);
					for (const file of migrations) {
						const queries = readFileSync(resolve('drizzle', file), 'utf8')
							.split('--> statement-breakpoint')
							.map((q) => q.trim())
							.filter(Boolean);
						await db.batch(queries.map((q) => db.prepare(q)));
					}
				}
				const db = /** @type {import('@cloudflare/workers-types').D1Database} */ (
					proxy.env.DB_SAMARINDA_GROUP
				);
				// Repository UAT seed consists of INSERT statements separated by ; + newline.
				const seed = readFileSync('scripts/seed-uat-samarinda.sql', 'utf8')
					.split(/;\s*(?:\r?\n|$)/)
					.map((q) => q.trim())
					.filter(Boolean);
				await db.batch(seed.map((q) => db.prepare(q)));
				const passwordHash = await bcrypt.hash(password, 10);
				await db
					.prepare(
						"UPDATE profil SET password = ? WHERE cabang_id = 'samarinda' AND id IN ('uat-pemilik-samarinda','uat-kasir-samarinda')"
					)
					.bind(passwordHash)
					.run();
				await db.batch(
					E2E_OWNER_USERNAMES.slice(1).map((username, index) =>
						db
							.prepare(
								'INSERT INTO profil (id, cabang_id, role, username, password, nama_lengkap) VALUES (?, ?, ?, ?, ?, ?)'
							)
							.bind(
								`uat-pemilik-samarinda-e2e-${index + 1}`,
								'samarinda',
								'pemilik',
								username,
								passwordHash,
								`Pemilik UAT E2E ${index + 1}`
							)
					)
				);
				// Satu pemilik tiap cabang non-samarinda untuk label E2E.
				// Tiap baris masuk shard cabangnya sendiri (login query shard itu).
				// Aditif per-run, unik per (cabang, username), tak menyentuh seed lain.
				for (const [binding, id, cabang] of [
					['DB_BERAU_GROUP', 'uat-owner-berau-e2e', 'berau'],
					['DB_BALIKPAPAN_GROUP', 'uat-owner-balikpapan-e2e', 'balikpapan'],
					['DB_SAMARINDA_GROUP', 'uat-owner-samarinda2-e2e', 'samarinda2'],
					['DB_BALIKPAPAN_GROUP', 'uat-owner-balikpapan2-e2e', 'balikpapan2']
				]) {
					const shardDb = /** @type {import('@cloudflare/workers-types').D1Database} */ (
						proxy.env[binding]
					);
					await shardDb
						.prepare(
							'INSERT INTO profil (id, cabang_id, role, username, password, nama_lengkap) VALUES (?, ?, ?, ?, ?, ?)'
						)
						.bind(id, cabang, 'pemilik', 'owner-e2e', passwordHash, `UAT E2E owner-e2e ${cabang}`)
						.run();
				}
				// Satu admin + satu role tak dikenal untuk kontrak role E2E.
				// Aditif per-run, username unik, tak menyentuh seed lain.
				await db.batch(
					[
						['uat-admin-samarinda-e2e', 'admin', 'admin-e2e'],
						['uat-weird-samarinda-e2e', 'supervisor', 'weird-e2e']
					].map(([id, role, username]) =>
						db
							.prepare(
								'INSERT INTO profil (id, cabang_id, role, username, password, nama_lengkap) VALUES (?, ?, ?, ?, ?, ?)'
							)
							.bind(id, 'samarinda', role, username, passwordHash, `UAT E2E ${username}`)
					)
				);
				return { migrations: migrations.length, databases: bindings.length };
			} finally {
				await proxy.dispose();
			}
		},
		cleanup() {
			rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	};
}
