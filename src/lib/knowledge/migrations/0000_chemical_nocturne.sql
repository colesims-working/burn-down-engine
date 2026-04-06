CREATE TABLE `consolidation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`dormancy_transitions` integer DEFAULT 0,
	`reactivations` integer DEFAULT 0,
	`merges_performed` integer DEFAULT 0,
	`syntheses_created` integer DEFAULT 0,
	`objects_absorbed` integer DEFAULT 0,
	`references_purged` integer DEFAULT 0,
	`status` text DEFAULT 'running' NOT NULL,
	`error_log` text
);
--> statement-breakpoint
CREATE TABLE `extraction_buffer` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`task_id` text,
	`task_title` text,
	`task_context` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`processed_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`locked_at` text
);
--> statement-breakpoint
CREATE INDEX `extraction_buffer_processed_idx` ON `extraction_buffer` (`processed`);--> statement-breakpoint
CREATE INDEX `extraction_buffer_created_idx` ON `extraction_buffer` (`created_at`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`link_type` text NOT NULL,
	`properties` text DEFAULT '{}',
	`confidence` real DEFAULT 0.7 NOT NULL,
	`source` text DEFAULT 'extracted' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `links_source_idx` ON `links` (`source_id`);--> statement-breakpoint
CREATE INDEX `links_target_idx` ON `links` (`target_id`);--> statement-breakpoint
CREATE INDEX `links_type_idx` ON `links` (`link_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `links_unique_idx` ON `links` (`source_id`,`target_id`,`link_type`);--> statement-breakpoint
CREATE TABLE `object_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`object_id` text NOT NULL,
	`alias` text NOT NULL,
	`canonical_alias` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`object_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `object_aliases_lookup_idx` ON `object_aliases` (`canonical_alias`);--> statement-breakpoint
CREATE UNIQUE INDEX `object_aliases_unique_idx` ON `object_aliases` (`object_id`,`canonical_alias`);--> statement-breakpoint
CREATE TABLE `object_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`object_id` text NOT NULL,
	`interaction_id` text,
	`task_id` text,
	`source_context` text NOT NULL,
	`evidence_type` text NOT NULL,
	`snippet` text,
	`confidence` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`object_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `object_evidence_object_idx` ON `object_evidence` (`object_id`);--> statement-breakpoint
CREATE TABLE `object_references` (
	`id` text PRIMARY KEY NOT NULL,
	`object_id` text NOT NULL,
	`interaction_id` text,
	`context` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`referenced_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`object_id`) REFERENCES `objects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `object_references_object_idx` ON `object_references` (`object_id`);--> statement-breakpoint
CREATE INDEX `object_references_time_idx` ON `object_references` (`referenced_at`);--> statement-breakpoint
CREATE INDEX `object_references_interaction_idx` ON `object_references` (`interaction_id`);--> statement-breakpoint
CREATE TABLE `objects` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`name` text NOT NULL,
	`canonical_name` text NOT NULL,
	`dedup_key` text NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`pinned_at` text,
	`confidence` real DEFAULT 0.7 NOT NULL,
	`source` text DEFAULT 'extracted' NOT NULL,
	`source_context` text,
	`sensitivity` text DEFAULT 'normal' NOT NULL,
	`superseded_by` text,
	`embedding` F32_BLOB(4096),
	`embedding_model` text,
	`embedding_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `objects_type_status_idx` ON `objects` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `objects_subtype_status_idx` ON `objects` (`subtype`,`status`);--> statement-breakpoint
CREATE INDEX `objects_lookup_idx` ON `objects` (`type`,`canonical_name`);--> statement-breakpoint
CREATE INDEX `objects_superseded_idx` ON `objects` (`superseded_by`);--> statement-breakpoint
CREATE UNIQUE INDEX `objects_type_dedup_idx` ON `objects` (`type`,`dedup_key`);--> statement-breakpoint
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`object_id` text,
	`review_type` text NOT NULL,
	`proposed_data` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `review_queue_status_idx` ON `review_queue` (`status`);