CREATE TABLE `calendar_event_link` (
	`event_candidate_id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`external_etag` text,
	`state` text NOT NULL,
	`last_synced_at` integer NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_link_integration` ON `calendar_event_link` (`integration_id`);--> statement-breakpoint
CREATE TABLE `calendar_feed` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_token_hash_unique` ON `calendar_feed` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_calendar_feed_user` ON `calendar_feed` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `oauth_state` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`workspace_id` text,
	`purpose` text NOT NULL,
	`code_verifier` text,
	`redirect_after` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`send_at` integer NOT NULL,
	`state` text NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reminder_unique` ON `reminder` (`user_id`,`target_type`,`target_id`,`send_at`);--> statement-breakpoint
CREATE INDEX `idx_reminder_due` ON `reminder` (`state`,`send_at`);