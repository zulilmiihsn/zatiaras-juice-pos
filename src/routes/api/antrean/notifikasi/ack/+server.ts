import { acknowledgeNotifications } from '$lib/server/orderNotifications/useCase';
import { notificationResponse, readNotificationBody } from '$lib/server/orderNotifications/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	notificationResponse(event, async (env, branch, session) => {
		await acknowledgeNotifications(env, branch, session, await readNotificationBody(event.request));
		return null;
	});
