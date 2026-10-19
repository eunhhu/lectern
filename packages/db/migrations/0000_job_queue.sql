CREATE TABLE `ai_call` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`job_id` text,
	`stage_run_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`audio_seconds` integer DEFAULT 0 NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`request_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_call_job` ON `ai_call` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_call_created` ON `ai_call` (`created_at`);--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`job_id` text,
	`stage_run_id` text,
	`kind` text NOT NULL,
	`blob_key` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_job` ON `artifact` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_sha` ON `artifact` (`sha256`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`payload` text DEFAULT '{}' NOT NULL,
	`sealed_secret` text,
	`result` text,
	`error` text,
	`error_code` text,
	`idempotency_key` text,
	`budget_microusd` integer,
	`spent_microusd` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_job_lease` ON `job` (`state`,`run_after`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_job_subject` ON `job` (`subject_id`,`kind`,`state`);--> statement-breakpoint
CREATE INDEX `idx_job_finished` ON `job` (`finished_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_idempotency` ON `job` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `job_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text,
	`owner_id` text NOT NULL,
	`subject_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_job_event_created` ON `job_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `stage_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`workspace_id` text,
	`stage` text NOT NULL,
	`chunk_index` integer,
	`state` text NOT NULL,
	`stage_key` text NOT NULL,
	`cache_hit` integer DEFAULT false NOT NULL,
	`output_json` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_stage_run_job` ON `stage_run` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_stage_run_key` ON `stage_run` (`stage_key`,`state`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
