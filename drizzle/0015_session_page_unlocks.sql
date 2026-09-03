ALTER TABLE `auth_sessions` ADD COLUMN `unlocked_pages` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD COLUMN `unlock_expires_at` integer NOT NULL DEFAULT 0;
