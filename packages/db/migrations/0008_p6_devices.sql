CREATE TABLE `live_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`device_id` text NOT NULL,
	`push_token` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_live_activity_recording_device` ON `live_activity` (`recording_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `idx_live_activity_recording` ON `live_activity` (`recording_id`);--> statement-breakpoint
CREATE TABLE `push_device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`name` text,
	`apns_token` text NOT NULL,
	`push_to_start_token` text,
	`app_version` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_device_apns_token_unique` ON `push_device` (`apns_token`);--> statement-breakpoint
CREATE INDEX `idx_push_device_user` ON `push_device` (`user_id`);--> statement-breakpoint
CREATE TABLE `recording_marker` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`at_ms` integer NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recording_marker_recording` ON `recording_marker` (`recording_id`,`at_ms`);--> statement-breakpoint
CREATE TABLE `v1_usage` (
	`day` text NOT NULL,
	`route` text NOT NULL,
	`client` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `route`, `client`)
);
