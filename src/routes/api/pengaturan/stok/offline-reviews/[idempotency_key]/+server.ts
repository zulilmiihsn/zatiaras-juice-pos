import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { branchStockRolloutAllows } from '$lib/server/stockPolicy';
import { resolveBranchOfflineReview } from '$lib/server/stockOfflineReview';
import type { RequestHandler } from './$types';

const FIELDS = new Set(['branch', 'expected_revision', 'action']);

export const PUT: RequestHandler = async ({ request, platform, locals, params }) => {
	const session = requireAuthSession(locals);
	if (session.role !== 'pemilik') throw kitError(403, 'Role tidak memiliki akses');
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw kitError(400, 'Body review replay tidak valid');
	}
	const keys = Object.keys(body);
	if (keys.length !== FIELDS.size || keys.some((key) => !FIELDS.has(key))) {
		throw kitError(400, 'Body hanya boleh memuat branch, expected_revision, dan action');
	}
	if (typeof body.branch !== 'string' || !body.branch.trim())
		throw kitError(400, 'Branch wajib diisi');
	if (
		typeof body.expected_revision !== 'number' ||
		!Number.isInteger(body.expected_revision) ||
		(body.expected_revision as number) < 0
	) {
		throw kitError(400, 'expected_revision harus bilangan bulat nonnegatif');
	}
	if (body.action !== 'approve_current' && body.action !== 'withdraw') {
		throw kitError(400, 'Action harus approve_current atau withdraw');
	}
	const branch = requireSessionBranch(locals, body.branch as string);
	if (!(await branchStockRolloutAllows(platform, branch))) {
		throw kitError(403, 'Review replay offline belum tersedia untuk cabang ini');
	}
	const idempotencyKey = String(params.idempotency_key || '');
	if (!idempotencyKey) throw kitError(400, 'Idempotency key wajib diisi');
	try {
		const row = await resolveBranchOfflineReview(platform, branch, session, {
			idempotencyKey,
			expectedRevision: body.expected_revision as number,
			action: body.action,
			now: new Date().toISOString()
		});
		return json({ ok: true, data: row });
	} catch (error) {
		if (
			error instanceof Error &&
			'status' in error &&
			typeof (error as { status?: number }).status === 'number'
		) {
			throw kitError((error as { status: number }).status, error.message);
		}
		throw error;
	}
};
