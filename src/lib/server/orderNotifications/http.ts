import { error, json } from '@sveltejs/kit';
import { requireAuthSession, requireExactRole, requireSessionBranch } from '../apiAuth';
import type { BranchContext } from '../branchResolver';
import type { AuthSession } from '../sessionStore';
import type { NotificationEnv } from './repository';
import { NotificationError } from './useCase';

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
export async function readNotificationBody(request: Request): Promise<unknown> {
	if (Number(request.headers.get('content-length')) > 16384)
		throw error(400, 'Data perangkat terlalu besar');
	const reader = request.body?.getReader();
	if (!reader) throw error(400, 'Data perangkat tidak valid');
	const decoder = new TextDecoder();
	let text = '',
		bytes = 0;
	try {
		for (;;) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch {
				throw error(400, 'Data perangkat tidak valid');
			}
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > 16384) {
				await reader.cancel();
				throw error(400, 'Data perangkat terlalu besar');
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw error(400, 'Data perangkat tidak valid');
	}
}
