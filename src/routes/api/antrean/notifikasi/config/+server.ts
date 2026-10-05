import { notificationResponse } from '$lib/server/orderNotifications/http';
import { notificationConfig } from '$lib/server/orderNotifications/webPush';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	notificationResponse(event, (env) => notificationConfig(env));
