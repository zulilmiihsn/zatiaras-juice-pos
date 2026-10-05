import {
	registerNotificationDevice,
	revokeNotificationDevice
} from '$lib/server/orderNotifications/useCase';
import { notificationResponse, readNotificationBody } from '$lib/server/orderNotifications/http';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	notificationResponse(event, async (env, branch, session) =>
		registerNotificationDevice(env, branch, session, await readNotificationBody(event.request))
	);
export const DELETE: RequestHandler = (event) =>
	notificationResponse(event, async (env, branch, session) => {
		await revokeNotificationDevice(env, branch, session, await readNotificationBody(event.request));
		return null;
	});
