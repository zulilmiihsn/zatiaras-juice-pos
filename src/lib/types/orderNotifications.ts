export interface NotificationDeviceIdentity {
	device_id: string;
	device_token: string;
}

export interface OrderNotificationEvent {
	sequence: number;
	event_id: string;
	order_id: string;
	origin_device_id: string | null;
	created_at: string;
	is_pending: boolean;
}

export interface OrderNotificationPage {
	items: OrderNotificationEvent[];
	next_cursor: number;
	has_more: boolean;
}

export interface OrderNotificationRegistration {
	baseline_cursor: number;
	acknowledged_cursor: number;
	push_active: boolean;
	expires_at: number;
}

export interface OrderPushSubscription {
	endpoint: string;
	expirationTime?: number | null;
	keys: { p256dh: string; auth: string };
}

export interface OrderPushMessage {
	version: 1;
	type: 'order_created';
	branch: string;
	user_id: string;
	device_id: string;
	sequence: number;
	event_id: string;
	order_id: string;
	origin_device_id: string | null;
	sound_enabled: boolean;
}

export interface OrderNotificationConfig {
	vapid_public_key: string | null;
	push_configured: boolean;
}
