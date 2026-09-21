import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';

/** Actual migrated SQL; use --d1 to verify the same cases in local workerd. */
export async function createTestD1(workers = process.argv.includes('--d1')) {
	let db: D1Database;
	let close: () => void | Promise<void>;
	if (workers) {
		const { getPlatformProxy } = await import('wrangler');
		const proxy = await getPlatformProxy({ configPath: 'wrangler.pages.jsonc', persist: false });
		db = proxy.env.DB_SAMARINDA_GROUP as D1Database;
		close = () => proxy.dispose();
	} else {
		const sql = new DatabaseSync(':memory:');
		class Statement {
			constructor(
				private query: string,
				private args: (string | number | null)[] = []
			) {}
			bind(...args: (string | number | null)[]) {
				return new Statement(this.query, args);
			}
			async first(column?: string) {
				const row = sql.prepare(this.query).get(...this.args);
				return column ? (row?.[column] ?? null) : (row ?? null);
			}
			async all() {
				return this.execute();
			}
			async run() {
				return this.execute();
			}
			async raw() {
				const statement = sql.prepare(this.query);
				statement.setReturnArrays(true);
				return statement.all(...this.args);
			}
			execute() {
				const statement = sql.prepare(this.query);
				if (statement.columns().length) {
					return { success: true, results: statement.all(...this.args), meta: { changes: 0 } };
				}
				const result = statement.run(...this.args);
				return { success: true, results: [], meta: { changes: Number(result.changes) } };
			}
		}
		// Only the D1 methods exercised by application services are adapted here.
		db = {
			prepare: (query: string) => new Statement(query),
			async batch(statements: Statement[]) {
				sql.exec('BEGIN');
				try {
					const results = statements.map((statement) => statement.execute());
					sql.exec('COMMIT');
					return results;
				} catch (error) {
					sql.exec('ROLLBACK');
					throw error;
				}
			}
		} as unknown as D1Database;
		close = () => sql.close();
	}
	try {
		for (const file of readdirSync('drizzle')
			.filter((f) => f.endsWith('.sql'))
			.sort()) {
			const statements = readFileSync(resolve('drizzle', file), 'utf8')
				.split('--> statement-breakpoint')
				.map((s) => s.trim())
				.filter(Boolean);
			await db.batch(statements.map((query) => db.prepare(query)));
		}
		return { db, close };
	} catch (error) {
		await close();
		throw error;
	}
}
