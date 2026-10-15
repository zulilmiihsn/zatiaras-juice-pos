import { error, json } from '@sveltejs/kit';
import { requireAuthSession, requireExactRole, requireSessionBranch } from '../apiAuth';
import type { BranchContext } from '../branchResolver';
import type { AuthSession } from '../sessionStore';
import type { NotificationEnv } from './repository';
import { NotificationError } from './useCase';
import { readJsonBody, RequestBodyError } from '../requestBody';

export async function notificationResponse<T>(
	event: {
		locals: App.Locals;
		platform: App.Platform | undefined;
		url: URL;
		setHeaders?: (headers: Record<string, string>) => void;
	},
	execute: (env: NotificationEnv, branch: BranchContext, session: AuthSession) => Promise<T>
): Promise<Response> {
	try {
		const session = requireAuthSession(event.locals);
		requireExactRole(session.role, ['kasir', 'pemilik']);
		if (session.expiresAt <= Date.now()) throw error(401, 'Session telah berakhir');
		const branch = requireSessionBranch(event.locals, event.url.searchParams.get('branch'));
		const data = await execute(event.platform?.env, branch, session);
		return json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (cause) {
		event.setHeaders?.({ 'Cache-Control': 'no-store' });
		if (cause instanceof NotificationError) throw error(cause.status, cause.message);
		throw cause;
	}
}
/** Body registry/ACK perangkat dibatasi 16 KiB; parse sebelum mutasi DB apa pun. */
export async function readNotificationBody(request: Request): Promise<unknown> {
	try {
		return await readJsonBody(request, 16384);
	} catch (cause) {
		if (cause instanceof RequestBodyError)
			throw error(
				cause.status,
				cause.status === 413 ? 'Data perangkat terlalu besar' : 'Data perangkat tidak valid'
			);
		throw cause;
	}
}
