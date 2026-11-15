CREATE TABLE `pdf_page` (
	`asset_id` text NOT NULL,
	`page_no` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`has_text_layer` integer NOT NULL,
	`ocr_source` text,
	PRIMARY KEY(`asset_id`, `page_no`)
);
--> statement-breakpoint
CREATE INDEX `idx_pdf_page_recording` ON `pdf_page` (`recording_id`);