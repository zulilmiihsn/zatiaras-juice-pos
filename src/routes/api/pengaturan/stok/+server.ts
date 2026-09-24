import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	loadBranchStockPolicy,
	stockPolicyRolloutAllows,
	StockPolicyConflictError,
	updateBranchStockPolicy,
	type StockPolicyMode
} from '$lib/server/stockPolicy';
import type { RequestHandler } from './$types';

const BODY_FIELDS = new Set(['branch', 'expected_revision', 'mode']);

function requireExactRole(role: string, allowed: readonly string[]): void {
	if (!allowed.includes(role)) throw kitError(403, 'Role tidak memiliki akses');
}

function validateQuery(url: URL): void {
	for (const key of url.searchParams.keys()) {
		if (key !== 'branch') throw kitError(400, `Parameter ${key} tidak dikenal`);
	}
	if (url.searchParams.getAll('branch').length > 1) {
		throw kitError(400, 'Parameter branch hanya boleh dikirim satu kali');
	}
}

function parsePutBody(value: unknown): {
	branch: string;
	expected_revision: number;
	mode: StockPolicyMode;
} {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw kitError(400, 'Body pengaturan stok tidak valid');
	}
	const body = value as Record<string, unknown>;
	const keys = Object.keys(body);
	if (keys.some((key) => !BODY_FIELDS.has(key)) || keys.length !== BODY_FIELDS.size) {
		throw kitError(400, 'Body hanya boleh memuat branch, expected_revision, dan mode');
	}
	if (typeof body.branch !== 'string' || body.branch.trim() === '') {
		throw kitError(400, 'Branch wajib diisi');
	}
	if (
		typeof body.expected_revision !== 'number' ||
		!Number.isInteger(body.expected_revision) ||
		body.expected_revision < 0
	) {
		throw kitError(400, 'expected_revision harus bilangan bulat nonnegatif');
	}
	if (body.mode !== 'tracked' && body.mode !== 'ignored') {
		throw kitError(400, 'Mode stok harus tracked atau ignored');
	}
	return {
		branch: body.branch,
		expected_revision: body.expected_revision,
		mode: body.mode
	};
}

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireExactRole(session.role, ['kasir', 'pemilik']);
	validateQuery(url);
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const policy = await loadBranchStockPolicy(platform, branch);
	return json({
		ok: true,
		data: {
			can_manage_policy: session.role === 'pemilik' && stockPolicyRolloutAllows(platform, branch),
			...policy
		}
	});
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireExactRole(session.role, ['pemilik']);
	const parsed = parsePutBody(await request.json().catch(() => null));
	const branch = requireSessionBranch(locals, parsed.branch);
	if (!stockPolicyRolloutAllows(platform, branch)) {
		throw kitError(403, 'Perubahan monitoring stok belum tersedia untuk cabang ini');
	}

	let result;
	try {
		result = await updateBranchStockPolicy(platform, branch, session, {
			expectedRevision: parsed.expected_revision,
			mode: parsed.mode,
			actor: { userId: session.userId, role: session.role },
			now: new Date().toISOString()
		});
	} catch (error) {
		if (error instanceof StockPolicyConflictError) throw kitError(error.status, error.message);
		throw error;
	}

	return json({ ok: true, data: result.policy });
};
