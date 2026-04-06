ALTER TABLE `app_settings` ADD `dupe_similarity_threshold` real DEFAULT 0.92;--> statement-breakpoint
ALTER TABLE `tasks` ADD `duplicate_suspect_of` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `dupe_similarity` real;