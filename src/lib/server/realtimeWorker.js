export { RealtimeDurableObject } from './realtimeDurableObject.js';

// Retensi log sistem (bukan data jualan). Dibersihkan otomatis via cron.
const LOG_RETENTION_DAYS = 90;
const CLEANUP_TABLES = ['audit_logs', 'request_metrics'];
const DB_BINDINGS = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];

export default {
	/**
	 * @param {Request} request
	 */
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/health') {
			return new Response(JSON.stringify({ ok: true, service: 'zatiaraspos-realtime' }), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		return new Response('Not found', { status: 404 });
	},

	/**
	 * Cron terjadwal: hapus log sistem lama (audit_logs, request_metrics) dari
	 * SEMUA database cabang. Hanya log/metrik — TIDAK menyentuh transaksi/menu.
	 * @param {unknown} _event
	 * @param {Record<string, any>} env
	 */
	async scheduled(_event, env) {
		for (const binding of DB_BINDINGS) {
			const db = env[binding];
			if (!db) continue;
			try {
				const rows = await db
					.prepare(
						`SELECT id, payload FROM audit_log_outbox
						 WHERE cabang_id IS NOT NULL ORDER BY created_at ASC LIMIT 100`
					)
					.all();
				for (const row of rows.results || []) {
					try {
						const input = JSON.parse(row.payload);
						await db
							.prepare(
								`INSERT OR IGNORE INTO audit_logs (
									id, cabang_id, actor_user_id, actor_username, actor_role, action,
									entity_type, entity_id, transaction_id, amount, metadata, ip_hash, created_at
								) SELECT ?, cabang_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
								 FROM audit_log_outbox WHERE id = ?`
							)
							.bind(
								row.id,
								input.session?.userId || null,
								input.session?.username || null,
								input.session?.role || null,
								input.action,
								input.entityType,
								input.entityId == null ? null : String(input.entityId),
								input.transactionId || null,
								input.amount || null,
								input.metadata ? JSON.stringify(input.metadata).slice(0, 8192) : null,
								input.ipHash || null,
								new Date().toISOString(),
								row.id
							)
							.run();
						await db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id).run();
					} catch {
						// Keep failed rows for the next scheduled retry.
					}
				}
			} catch {
				// Schema may be awaiting migration; retry on the next schedule.
			}
		}

		const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
		for (const binding of DB_BINDINGS) {
			const db = env[binding];
			if (!db) continue;
			for (const table of CLEANUP_TABLES) {
				try {
					await db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).bind(cutoff).run();
				} catch {
					// Tabel mungkin belum ada / error sebagian — jangan gagalkan cron seluruhnya.
				}
			}
		}
	}
};
