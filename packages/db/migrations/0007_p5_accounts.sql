CREATE TABLE `access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes_json` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_token_token_hash_unique` ON `access_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_access_token_user` ON `access_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `account_deletion` (
	`user_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`execute_after` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_account_deletion_due` ON `account_deletion` (`state`,`execute_after`);--> statement-breakpoint
CREATE TABLE `auth_session_meta` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_kind` text NOT NULL,
	`device_name` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_export` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`include_audio` integer NOT NULL,
	`state` text NOT NULL,
	`blob_key` text,
	`bytes` integer,
	`requested_at` integer NOT NULL,
	`ready_at` integer,
	`expires_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_data_export_user` ON `data_export` (`user_id`);--> statement-breakpoint
CREATE TABLE `native_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`family_id` text NOT NULL,
	`device_name` text,
	`platform` text,
	`access_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_hash` text NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`refresh_used_at` integer,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_session_access_hash_unique` ON `native_session` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `native_session_refresh_hash_unique` ON `native_session` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `idx_native_session_user` ON `native_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_native_session_family` ON `native_session` (`family_id`);--> statement-breakpoint
CREATE TABLE `oauth_identity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_identity_subject` ON `oauth_identity` (`provider`,`subject`);--> statement-breakpoint
CREATE INDEX `idx_oauth_identity_user` ON `oauth_identity` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspace_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invite_token_hash_unique` ON `workspace_invite` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_workspace_invite_workspace` ON `workspace_invite` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_quota` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`audio_ms_month` integer,
	`ai_microusd_month` integer,
	`storage_bytes` integer,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
