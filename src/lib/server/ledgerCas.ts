import type { D1Database } from '@cloudflare/workers-types';

export function newMutationToken(): string {
	return crypto.randomUUID();
}

export function stripLedgerControlFields<T extends Record<string, unknown>>(
	payload: T
): Partial<T> {
	const clean: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
	for (const k of ['revision', 'mutation_token', 'cabang_id', 'id']) delete clean[k];
	return clean as Partial<T>;
}

export function claimLedgerStatement(
	rawDb: D1Database,
	branch: string,
	headerId: string,
	expectedRevision: number,
	mutationToken: string
) {
	return rawDb
		.prepare(
			`UPDATE buku_kas SET revision = revision + 1, mutation_token = ?, updated_at = ?
			 WHERE cabang_id = ? AND id = ? AND sumber = 'pos' AND revision = ?`
		)
		.bind(mutationToken, new Date().toISOString(), branch, headerId, expectedRevision);
}

export function guardExistsSql(): string {
	return `EXISTS (SELECT 1 FROM buku_kas WHERE cabang_id = ? AND id = ? AND mutation_token = ?)`;
}

export function batchClaimChanges(results: unknown): number {
	if (!Array.isArray(results) || results.length === 0) return 0;
	const first = results[0] as {
		changes?: number;
		meta?: { changes?: number };
	} | null;
	if (!first || typeof first !== 'object') return 0;
	if (typeof first.changes === 'number') return first.changes;
	const metaChanges = (first as { meta?: { changes?: number } }).meta?.changes;
	return typeof metaChanges === 'number' ? metaChanges : 0;
}
