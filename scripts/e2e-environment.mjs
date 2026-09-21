import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
				await db
					.prepare(
						"UPDATE profil SET password = ? WHERE cabang_id = 'samarinda' AND id IN ('uat-pemilik-samarinda','uat-kasir-samarinda')"
					)
					.bind(await bcrypt.hash(password, 10))
					.run();
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
