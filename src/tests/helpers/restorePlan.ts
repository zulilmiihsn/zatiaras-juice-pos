import type { D1Database } from '@cloudflare/workers-types';
import type { buildRestoreChunks } from '../../../scripts/restore-archive-lib.mjs';

export type RestorePlan = ReturnType<typeof buildRestoreChunks>;

/** Tahap staging produksi: tiap chunk satu batch; tak menyentuh tabel live. */
export async function applyRestoreStages(db: D1Database, plan: RestorePlan) {
	for (const chunk of plan.chunks) await db.batch(chunk.statements.map((q) => db.prepare(q)));
}

/** Tahap final produksi: satu batch atomik; satu-satunya yang mengubah tabel live. */
export function applyRestoreFinal(db: D1Database, plan: RestorePlan, extra: string[] = []) {
	return db.batch([...plan.final.statements, ...extra].map((q) => db.prepare(q)));
}

/**
 * AUD-054: terapkan rencana restore persis seperti CLI produksi
 * (`scripts/restore-archive.mjs`): staging per chunk, lalu satu batch final atomik.
 */
export async function applyRestorePlan(db: D1Database, plan: RestorePlan) {
	await applyRestoreStages(db, plan);
	return applyRestoreFinal(db, plan);
}
