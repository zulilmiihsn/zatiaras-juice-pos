import { dispatchOrderNotifications } from './orderNotifications/delivery';
import { BRANCH_GROUPS, branchContext } from './branchResolver';

export { RealtimeDurableObject } from './realtimeDurableObject.js';

// Retensi log sistem (bukan data jualan). Dibersihkan otomatis via cron.
// Kebijakan terdokumentasi (AUD-051): 90 hari untuk log/metrik/error/
// karantina/teknis notifikasi terminal; pending/leased TAK PERNAH dihapus
// otomatis; ledger/struk/arsip bukan log teknis dan tak tersentuh.
const LOG_RETENTION_DAYS = 90;
const CLEANUP_TABLES = ['audit_logs', 'request_metrics', 'error_events'];
const DB_BINDINGS = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];
// Drain outbox per run: halaman 100 x maks 10 (1000 baris) agar backlog
// besar pulih dalam budget terukur, bukan selamanya 100/hari.
const OUTBOX_DRAIN_PAGE = 100;
const OUTBOX_DRAIN_MAX_PAGES = 10;
const AUDIT_METADATA_BYTES = 8192;

/** Metadata berbatas yang tetap JSON valid (jangan potong string mentah).
 * @param {unknown} value
 */
function boundedMetadata(value) {
	if (value === null || value === undefined) return null;
	let direct = null;
	try {
		direct = JSON.stringify(value);
	} catch {
		return '{"truncated":true}';
	}
	if (new TextEncoder().encode(direct).length <= AUDIT_METADATA_BYTES) return direct;
	/** @type {Record<string, unknown>} */
	const summary = {};
	try {
		for (const [k, v] of Object.entries(value)) {
			if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
				summary[k] = `${k}:${String(v)}`.slice(0, 120);
			}
		}
	} catch {
		return '{"truncated":true}';
	}
	return JSON.stringify({ truncated: true, summary });
}

/**
 * Pindahkan row outbox rusak/gagal Tayang ke tabel karantina (bukan hapus).
 * @param {any} db
 * @param {{id: string, cabang_id?: string, payload: string, attempt_count?: number}} row
 * @param {any} reason
 */
async function quarantineRow(db, row, reason) {
	const reasonText = reason instanceof Error ? reason.message : String(reason);
	try {
		const now = new Date().toISOString();
		await db.batch([
			db
				.prepare(
					`INSERT OR IGNORE INTO audit_log_quarantine (id, cabang_id, payload, reason, attempt_count, created_at, quarantined_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					row.id,
					row.cabang_id || null,
					row.payload,
					reasonText.slice(0, 1000),
					Number(row.attempt_count || 0),
					now,
					now
				),
			db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id)
		]);
	} catch {
		// Jangan gagalkan cron karena karantina.
	}
}

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
	 * @param {{cron?:string}} _event
	 * @param {Record<string, any>} env
	 */
	async scheduled(_event, env) {
		for (const branch of Object.values(BRANCH_GROUPS).flat()) {
			try {
				await dispatchOrderNotifications(env, branchContext(branch));
			} catch {
				// Durable relay state survives outages; the next minute resumes leased/retry work.
			}
		}
		if (_event.cron !== '0 3 * * *') return;
		for (const binding of DB_BINDINGS) {
			const db = env[binding];
			if (!db) continue;
			let drained = 0;
			for (let page = 0; page < OUTBOX_DRAIN_MAX_PAGES; page++) {
				let rows;
				try {
					rows = await db
						.prepare(
							`SELECT id, cabang_id, payload, attempt_count FROM audit_log_outbox
							 WHERE cabang_id IS NOT NULL ORDER BY created_at ASC LIMIT ${OUTBOX_DRAIN_PAGE}`
						)
						.all();
				} catch {
					// Schema may be awaiting migration; retry on the next schedule.
					break;
				}
				const batch = rows.results || [];
				if (!batch.length) break;
				for (const row of batch) {
					let input = null;
					try {
						input = JSON.parse(row.payload);
						if (!input || typeof input !== 'object' || typeof input.action !== 'string') {
							throw new Error('payload outbox invalid');
						}
					} catch (parseError) {
						await quarantineRow(db, row, parseError);
						continue;
					}
					try {
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
								boundedMetadata(input.metadata),
								input.ipHash || null,
								new Date().toISOString(),
								row.id
							)
							.run();
						await db.prepare('DELETE FROM audit_log_outbox WHERE id = ?').bind(row.id).run();
					} catch (insertError) {
						const insertMessage =
							insertError instanceof Error ? insertError.message : String(insertError);
						if (Number(row.attempt_count || 0) >= 5) {
							await quarantineRow(db, row, insertMessage);
						} else {
							try {
								await db
									.prepare(
										'UPDATE audit_log_outbox SET attempt_count = attempt_count + 1, last_error = ?, updated_at = ? WHERE id = ?'
									)
									.bind(insertMessage.slice(0, 1000), new Date().toISOString(), row.id)
									.run();
							} catch {
								// Jangan gagalkan cron karena satu row.
							}
						}
					}
				}
				drained += batch.length;
				if (batch.length < OUTBOX_DRAIN_PAGE) break;
			}
			if (drained > 0) console.log(`[cleanup] ${binding}: outbox terdrain ${drained} baris`);
		}

		const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
		// Cutoff ms-epoch untuk tabel notifikasi (kolom INTEGER, bukan ISO).
		const cutoffMs = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
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
			// Karantina outbox mati: bukti 90 hari cukup; bukan ledger.
			try {
				await db
					.prepare(`DELETE FROM audit_log_quarantine WHERE quarantined_at < ?`)
					.bind(cutoff)
					.run();
			} catch {
				// Tabel mungkin belum ada — jangan gagalkan cron.
			}
			// Retensi teknis notifikasi (AUD-051): hanya state terminal +
			// perangkat nonaktif kedaluwarsa. pending/leased TAK PERNAH
			// dihapus otomatis (ADR 0004); event dirujuk pending/leased aman.
			try {
				await db
					.prepare(
						`DELETE FROM antrean_notification_deliveries
						 WHERE state IN ('sent','cancelled','failed') AND next_attempt_at < ?`
					)
					.bind(cutoffMs)
					.run();
			} catch {
				// Migrasi 0037 mungkin belum ada — jangan gagalkan cron.
			}
			try {
				await db
					.prepare(
						`DELETE FROM antrean_notification_events WHERE created_at < ?
						 AND NOT EXISTS (
							SELECT 1 FROM antrean_notification_deliveries d
							WHERE d.event_id = antrean_notification_events.event_id
							  AND d.state IN ('pending','leased')
						)`
					)
					.bind(cutoff)
					.run();
			} catch {
				// Migrasi 0037 mungkin belum ada — jangan gagalkan cron.
			}
			try {
				await db
					.prepare(`DELETE FROM antrean_notification_devices WHERE active = 0 AND expires_at < ?`)
					.bind(cutoffMs)
					.run();
			} catch {
				// Migrasi 0037 mungkin belum ada — jangan gagalkan cron.
			}
		}
	}
};
