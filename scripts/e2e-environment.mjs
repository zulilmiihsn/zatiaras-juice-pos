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
				const passwordHash = await bcrypt.hash(password, 10);
				await db
					.prepare(
						"UPDATE profil SET password = ? WHERE cabang_id = 'samarinda' AND id IN ('uat-pemilik-samarinda','uat-kasir-samarinda')"
					)
					.bind(passwordHash)
					.run();
				await db.batch(
					[1, 2, 3].map((slot) =>
						db
							.prepare(
								'INSERT INTO profil (id, cabang_id, role, username, password, nama_lengkap) VALUES (?, ?, ?, ?, ?, ?)'
							)
							.bind(
								`uat-pemilik-samarinda-e2e-${slot}`,
								'samarinda',
								'pemilik',
								`pemilik-e2e-${slot}`,
								passwordHash,
								`Pemilik UAT E2E ${slot}`
							)
					)
				);
				// AUD-029: satu pemilik tiap cabang non-samarinda untuk label E2E.
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
				// AUD-019: satu admin + satu role tak dikenal untuk kontrak role E2E.
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
