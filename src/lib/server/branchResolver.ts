import { error } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

export const BRANCH_GROUPS = {
	DB_SAMARINDA_GROUP: ['samarinda', 'samarinda2'],
	DB_BALIKPAPAN_GROUP: ['balikpapan', 'balikpapan2'],
	DB_BERAU_GROUP: ['berau']
} as const;

export type BranchId = (typeof BRANCH_GROUPS)[keyof typeof BRANCH_GROUPS][number];
export type BranchDbBinding = keyof typeof BRANCH_GROUPS;

const BRANCH_ALIASES: Record<string, BranchId> = {
	samarinda: 'samarinda',
	samarinda2: 'samarinda2',
	balikpapan: 'balikpapan',
	balikpapan2: 'balikpapan2',
	berau: 'berau'
};

export function normalizeBranch(input: unknown): BranchId {
	const value = String(input || '')
		.trim()
		.toLowerCase();
	const branch = BRANCH_ALIASES[value];
	if (!branch) {
		throw error(400, 'Branch tidak valid');
	}
	return branch;
}

export function isValidBranch(input: unknown): input is BranchId {
	try {
		normalizeBranch(input);
		return true;
	} catch {
		return false;
	}
}

export function getBranchDbBinding(branch: BranchId): BranchDbBinding {
	for (const [binding, branches] of Object.entries(BRANCH_GROUPS)) {
		if ((branches as readonly string[]).includes(branch)) {
			return binding as BranchDbBinding;
		}
	}
	throw error(400, 'Branch tidak valid');
}

export function getD1Database(
	env: Record<string, unknown> | undefined,
	branch: BranchId
): D1Database {
	const binding = getBranchDbBinding(branch);
	const db = env?.[binding] || env?.DB;
	if (!db) {
		throw error(503, `Database binding ${binding} tidak tersedia`);
	}
	return db as D1Database;
}

export function getDrizzleDb(platform: App.Platform | undefined, branch: BranchId) {
	return drizzle(getD1Database(platform?.env as Record<string, unknown> | undefined, branch));
}

/** Tipe instance Drizzle D1 yang dipakai handler /api/data. */
export type DrizzleDb = ReturnType<typeof getDrizzleDb>;

export function requireBranch(input: unknown): BranchId {
	return normalizeBranch(input);
}
