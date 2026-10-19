CREATE TABLE `ask_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_json` text NOT NULL,
	`recording_id` text,
	`folder_id` text,
	`title` text NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ask_thread_user` ON `ask_thread` (`workspace_id`,`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_ask_thread_recording` ON `ask_thread` (`recording_id`);--> statement-breakpoint
CREATE TABLE `ask_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`idx` integer NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`mode` text,
	`evidence_json` text,
	`evidence_hash` text,
	`cache_key` text,
	`cached` integer DEFAULT false NOT NULL,
	`provider` text,
	`model` text,
	`llm_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_microusd` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ask_turn_thread` ON `ask_turn` (`thread_id`,`idx`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ask_turn_idempotency` ON `ask_turn` (`thread_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_ask_turn_usage` ON `ask_turn` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ask_turn_cache` ON `ask_turn` (`workspace_id`,`cache_key`);--> statement-breakpoint
CREATE TABLE `search_chunk` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`locator` text NOT NULL,
	`ordinal` integer NOT NULL,
	`heading` text,
	`text` text NOT NULL,
	`content_sha256` text NOT NULL,
	`tokens` integer NOT NULL,
	`chunker_version` integer NOT NULL,
	`start_idx` integer,
	`end_idx` integer,
	`start_ms` integer,
	`end_ms` integer,
	`spans_json` text,
	`document_id` text,
	`document_version` integer,
	`block_id` text,
	`sources_json` text,
	`asset_id` text,
	`page` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_chunk_id` ON `search_chunk` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_chunk_locator` ON `search_chunk` (`recording_id`,`kind`,`locator`);--> statement-breakpoint
CREATE INDEX `idx_search_chunk_workspace` ON `search_chunk` (`workspace_id`,`recording_id`);--> statement-breakpoint
CREATE INDEX `idx_search_chunk_content` ON `search_chunk` (`workspace_id`,`content_sha256`);--> statement-breakpoint
CREATE TABLE `search_embedding` (
	`workspace_id` text NOT NULL,
	`content_sha256` text NOT NULL,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` blob NOT NULL,
	`scale` real NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `model`, `dim`, `content_sha256`)
);
--> statement-breakpoint
CREATE TABLE `search_index_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
