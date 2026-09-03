import { error as kitError } from '@sveltejs/kit';
import { normalizeBranch, type BranchId } from '$lib/server/branchResolver';

type AppLocals = App.Locals;

export function requireAuthSession(locals: AppLocals) {
	const session = locals.authSession;
	if (!session) {
		throw kitError(401, 'Login diperlukan');
	}
	return session;
}

export function requireSessionBranch(locals: AppLocals, requestedBranch?: unknown): BranchId {
	const session = requireAuthSession(locals);
	const sessionBranch = normalizeBranch(session.branch);
	const requested = requestedBranch ? normalizeBranch(requestedBranch) : sessionBranch;

	if (requested !== sessionBranch && session.role !== 'admin') {
		throw kitError(403, 'Branch tidak sesuai session');
	}

	return requested;
}

export function requireAnyRole(role: string, allowed: string[]) {
	if (role === 'admin' || allowed.includes(role)) return;
	throw kitError(403, 'Role tidak memiliki akses');
}
