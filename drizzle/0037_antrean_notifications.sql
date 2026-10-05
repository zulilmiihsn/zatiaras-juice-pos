-- Control-plane registry is used only in DB_SAMARINDA_GROUP (DB in tests).
CREATE TABLE antrean_notification_devices (
 device_id TEXT PRIMARY KEY NOT NULL,
 token_hash TEXT NOT NULL,
 cabang_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 context_id TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 sound_enabled INTEGER NOT NULL CHECK(sound_enabled IN (0,1)),
 subscription TEXT,
 expires_at INTEGER NOT NULL,
 baseline_cursor INTEGER NOT NULL,
 seen_cursor INTEGER NOT NULL,
 delivered_cursor INTEGER NOT NULL,
 dispatch_cursor INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_notification_devices_branch ON antrean_notification_devices(cabang_id, active, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_notification_device_endpoint
ON antrean_notification_devices(json_extract(subscription, '$.endpoint'))
WHERE active=1 AND subscription IS NOT NULL AND json_valid(subscription);
--> statement-breakpoint
CREATE TABLE antrean_notification_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 cabang_id TEXT NOT NULL,
 buku_kas_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 origin_device_id TEXT,
 claimed_origin_device_id TEXT,
 origin_device_token_hash TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(cabang_id,idempotency_key)
);
--> statement-breakpoint
CREATE INDEX idx_notification_events_branch ON antrean_notification_events(cabang_id, sequence);
--> statement-breakpoint
CREATE TABLE antrean_notification_deliveries (
 event_id TEXT NOT NULL,
 cabang_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 context_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','sent','cancelled','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 lease_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 last_status INTEGER,
 PRIMARY KEY(event_id,device_id,context_id)
);
--> statement-breakpoint
CREATE INDEX idx_notification_delivery_due ON antrean_notification_deliveries(cabang_id,state,next_attempt_at,lease_until);
