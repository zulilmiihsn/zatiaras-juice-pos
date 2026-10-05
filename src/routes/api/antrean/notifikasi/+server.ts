import { listNotifications } from '$lib/server/orderNotifications/useCase';
import { notificationResponse } from '$lib/server/orderNotifications/http';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	notificationResponse(event, (env, branch, session) =>
		listNotifications(
			env,
			branch,
			session,
			{
				device_id: event.url.searchParams.get('device_id'),
				device_token: event.request.headers.get('X-Antrean-Device-Token')
			},
			event.url.searchParams.get('after'),
			event.url.searchParams.get('limit')
		)
	);
