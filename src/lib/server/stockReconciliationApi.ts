import { error as kitError } from '@sveltejs/kit';
import { stockPolicyRolloutAllows } from '$lib/server/stockPolicy';
import {
	StockReconciliationError,
	type StockReconciliationCountInput
} from '$lib/server/stockReconciliation';

function exactObject(
	value: unknown,
	fields: readonly string[],
	message: string
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw kitError(400, message);
	const body = value as Record<string, unknown>;
	const keys = Object.keys(body);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
		throw kitError(400, message);
	}
	return body;
}

function branchField(body: Record<string, unknown>): string {
	if (typeof body.branch !== 'string' || body.branch.trim() === '') {
		throw kitError(400, 'Branch wajib diisi');
	}
	return body.branch;
}

export function parseCreateReconciliationBody(value: unknown): { branch: string } {
	return { branch: branchField(exactObject(value, ['branch'], 'Body hanya boleh memuat branch')) };
}

export function parseCountReconciliationBody(value: unknown): {
	branch: string;
	items: StockReconciliationCountInput[];
} {
	const body = exactObject(value, ['branch', 'items'], 'Body hanya boleh memuat branch dan items');
	if (!Array.isArray(body.items)) throw kitError(400, 'Items rekonsiliasi harus berupa array');
	const items = body.items.map((value): StockReconciliationCountInput => {
		const item = exactObject(
			value,
			['entity_type', 'entity_id', 'counted_quantity'],
			'Item hanya boleh memuat entity_type, entity_id, dan counted_quantity'
		);
		if (item.entity_type !== 'produk' && item.entity_type !== 'bahan') {
			throw kitError(400, 'entity_type harus produk atau bahan');
		}
		if (typeof item.entity_id !== 'string' || item.entity_id.trim() === '') {
			throw kitError(400, 'entity_id wajib diisi');
		}
		if (
			typeof item.counted_quantity !== 'number' ||
			!Number.isFinite(item.counted_quantity) ||
			item.counted_quantity < 0
		) {
			throw kitError(400, 'counted_quantity harus angka finite nonnegatif');
		}
		return {
			entityType: item.entity_type,
			entityId: item.entity_id,
			countedQuantity: item.counted_quantity
		};
	});
	return { branch: branchField(body), items };
}

export function parseFinalizeReconciliationBody(value: unknown): {
	branch: string;
	expectedPolicyRevision: number;
} {
	const body = exactObject(
		value,
		['branch', 'expected_policy_revision'],
		'Body hanya boleh memuat branch dan expected_policy_revision'
	);
	if (
		typeof body.expected_policy_revision !== 'number' ||
		!Number.isInteger(body.expected_policy_revision) ||
		body.expected_policy_revision < 1
	) {
		throw kitError(400, 'expected_policy_revision harus bilangan bulat positif');
	}
	return {
		branch: branchField(body),
		expectedPolicyRevision: body.expected_policy_revision
	};
}

export function requireReconciliationOwner(role: string): void {
	if (role !== 'pemilik') throw kitError(403, 'Role tidak memiliki akses');
}

export function requireReconciliationRollout(
	platform: App.Platform | undefined,
	branch: string
): void {
	if (!stockPolicyRolloutAllows(platform, branch)) {
		throw kitError(403, 'Rekonsiliasi stok belum tersedia untuk cabang ini');
	}
}

export function mapReconciliationError(error: unknown): never {
	if (error instanceof StockReconciliationError) throw kitError(error.status, error.message);
	throw error;
}
