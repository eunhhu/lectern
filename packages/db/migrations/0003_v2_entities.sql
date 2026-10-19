CREATE TABLE `action_item` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`text` text NOT NULL,
	`owner_name` text,
	`due_at` integer,
	`due_raw` text,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_json` text NOT NULL,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_action_item_workspace` ON `action_item` (`workspace_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_action_item_recording` ON `action_item` (`recording_id`);--> statement-breakpoint
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`part_index` integer DEFAULT 0 NOT NULL,
	`blob_key` text NOT NULL,
	`sha256` text,
	`bytes` integer NOT NULL,
	`mime` text NOT NULL,
	`duration_ms` integer,
	`page_count` integer,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_asset_recording` ON `asset` (`recording_id`,`kind`,`part_index`);--> statement-breakpoint
CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`current_version` integer NOT NULL,
	`user_edited` integer DEFAULT false NOT NULL,
	`md_source_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_document_recording` ON `document` (`recording_id`);--> statement-breakpoint
CREATE TABLE `document_version` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`version` integer NOT NULL,
	`base_version` integer,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`body_json` text,
	`rendered_md` text NOT NULL,
	`created_by` text NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_version` ON `document_version` (`document_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_document_version_recording` ON `document_version` (`recording_id`);--> statement-breakpoint
CREATE TABLE `event_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`all_day` integer DEFAULT false NOT NULL,
	`tz` text NOT NULL,
	`raw_expression` text NOT NULL,
	`resolution_json` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence_json` text NOT NULL,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_event_candidate_workspace` ON `event_candidate` (`workspace_id`,`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_event_candidate_recording` ON `event_candidate` (`recording_id`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_folder_parent` ON `folder` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `integration` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`token_enc` text NOT NULL,
	`calendar_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_integration_workspace` ON `integration` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `lecture_sync_pending` (
	`lecture_id` text PRIMARY KEY NOT NULL,
	`marked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `membership` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_membership_user` ON `membership` (`user_id`);--> statement-breakpoint
CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`answer` text,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`difficulty` text,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_question_recording` ON `question` (`recording_id`);--> statement-breakpoint
CREATE TABLE `recording` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`domain` text DEFAULT 'lecture' NOT NULL,
	`template_id` text,
	`language` text,
	`recorded_at` integer NOT NULL,
	`recorded_at_source` text NOT NULL,
	`duration_ms` integer,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`lecture_id` text,
	`source_client` text,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recording_workspace` ON `recording` (`workspace_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_recording_folder` ON `recording` (`workspace_id`,`folder_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recording_lecture` ON `recording` (`lecture_id`);--> statement-breakpoint
CREATE TABLE `recording_tag` (
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`recording_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_recording_tag_tag` ON `recording_tag` (`tag_id`);--> statement-breakpoint
CREATE TABLE `saved_view` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_saved_view_user` ON `saved_view` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `share_link` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope_json` text NOT NULL,
	`expires_at` integer,
	`password_hash` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_share_link_token` ON `share_link` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_share_link_target` ON `share_link` (`workspace_id`,`target_id`);--> statement-breakpoint
CREATE TABLE `speaker` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`label` text NOT NULL,
	`display_name` text,
	`confidence` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_speaker_recording` ON `speaker` (`recording_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tag_workspace` ON `tag` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `transcript_gap` (
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_transcript_gap_recording` ON `transcript_gap` (`recording_id`,`start_ms`);--> statement-breakpoint
CREATE TABLE `transcript_segment` (
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`speaker_id` text,
	`text` text NOT NULL,
	`confidence` real,
	`source_chunk` integer,
	`lang` text,
	PRIMARY KEY(`recording_id`, `idx`)
);
--> statement-breakpoint
CREATE TABLE `upload` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`recording_id` text,
	`status` text NOT NULL,
	`recorded_at` integer,
	`part_size` integer NOT NULL,
	`files_json` text NOT NULL,
	`recording_json` text,
	`source_client` text,
	`idempotency_key` text,
	`result_json` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_upload_idempotency` ON `upload` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_upload_expires` ON `upload` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `upload_part` (
	`upload_id` text NOT NULL,
	`part` integer NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`upload_id`, `part`)
);
--> statement-breakpoint
CREATE TABLE `usage_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`period` text NOT NULL,
	`audio_ms` integer DEFAULT 0 NOT NULL,
	`ai_cost_microusd` integer DEFAULT 0 NOT NULL,
	`storage_bytes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_usage_ledger_period` ON `usage_ledger` (`workspace_id`,`period`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`personal_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspace_personal` ON `workspace` (`personal_user_id`);