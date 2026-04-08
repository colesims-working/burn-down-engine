ALTER TABLE `tasks` ADD `project_order` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `urgency_class` text;--> statement-breakpoint
ALTER TABLE `app_settings` ALTER COLUMN "dupe_similarity_threshold" TO "dupe_similarity_threshold" real DEFAULT 0.85;
