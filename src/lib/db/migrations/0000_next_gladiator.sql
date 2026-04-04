CREATE TABLE `app_log` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`timestamp` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_app_log_category` ON `app_log` (`category`);--> statement-breakpoint
CREATE INDEX `idx_app_log_timestamp` ON `app_log` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_app_log_level` ON `app_log` (`level`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`primary_model` text DEFAULT 'gemini-3.1-flash-lite-preview',
	`heavy_model` text DEFAULT 'claude-opus-4-20250514',
	`model_config` text,
	`disabled_models` text,
	`auto_approve_threshold` real DEFAULT 0.8,
	`monthly_budget` real,
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `daily_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`review_date` text NOT NULL,
	`planned_count` integer,
	`completed_count` integer,
	`bumped_count` integer,
	`fire_count` integer,
	`completion_rate` real,
	`completed_tasks` text,
	`bumped_tasks` text,
	`blocked_tasks` text,
	`killed_tasks` text,
	`free_capture` text,
	`tomorrow_seed` text,
	`llm_observations` text,
	`llm_suggestions` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_reviews_review_date_unique` ON `daily_reviews` (`review_date`);--> statement-breakpoint
CREATE TABLE `decomposition_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_pattern` text NOT NULL,
	`template` text NOT NULL,
	`times_used` integer DEFAULT 0,
	`last_used_at` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`confidence` real DEFAULT 1,
	`source` text,
	`times_referenced` integer DEFAULT 0,
	`embedding` blob,
	`embedding_text` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_category` ON `knowledge_entries` (`category`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_key` ON `knowledge_entries` (`key`);--> statement-breakpoint
CREATE TABLE `llm_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`page` text NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`input_summary` text,
	`output_summary` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`latency_ms` integer,
	`cost_estimate` real,
	`timestamp` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `idx_llm_page` ON `llm_interactions` (`page`);--> statement-breakpoint
CREATE INDEX `idx_llm_timestamp` ON `llm_interactions` (`timestamp`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`relationship` text,
	`organization` text,
	`role` text,
	`context_notes` text,
	`related_projects` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`todoist_id` text,
	`parent_todoist_id` text,
	`name` text NOT NULL,
	`category` text,
	`goal` text,
	`status` text DEFAULT 'active',
	`open_action_count` integer DEFAULT 0,
	`last_activity_at` text,
	`last_audit_at` text,
	`key_links` text DEFAULT '[]',
	`open_decisions` text DEFAULT '[]',
	`notes` text,
	`related_people` text DEFAULT '[]',
	`llm_observations` text,
	`suggested_actions` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`todoist_synced_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_todoist_id_unique` ON `projects` (`todoist_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_category` ON `projects` (`category`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`last_full_sync` text,
	`last_inbox_sync` text,
	`sync_token` text,
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `task_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text,
	`timestamp` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_history_task` ON `task_history` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_history_action` ON `task_history` (`action`);--> statement-breakpoint
CREATE INDEX `idx_history_timestamp` ON `task_history` (`timestamp`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`todoist_id` text,
	`original_text` text NOT NULL,
	`title` text NOT NULL,
	`next_action` text,
	`description` text,
	`project_id` text,
	`priority` integer DEFAULT 4,
	`rank_within_tier` integer,
	`labels` text DEFAULT '[]',
	`due_date` text,
	`time_estimate_min` integer,
	`energy_level` text,
	`is_recurring` integer DEFAULT false,
	`recurrence_rule` text,
	`status` text DEFAULT 'inbox',
	`blocker_note` text,
	`bump_count` integer DEFAULT 0,
	`context_notes` text,
	`related_people` text DEFAULT '[]',
	`related_links` text DEFAULT '[]',
	`parent_task_id` text,
	`is_decomposed` integer DEFAULT false,
	`clarify_confidence` real,
	`clarify_questions` text,
	`llm_notes` text,
	`embedding` blob,
	`embedding_text` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`completed_at` text,
	`todoist_synced_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_todoist_id_unique` ON `tasks` (`todoist_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_priority` ON `tasks` (`priority`,`rank_within_tier`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tasks_todoist` ON `tasks` (`todoist_id`);--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`avg_completion_rate` real,
	`total_fires` integer,
	`total_completed` integer,
	`total_bumped` integer,
	`most_productive_day` text,
	`priority_recalibration` text,
	`project_audit_notes` text,
	`pattern_observations` text,
	`anti_pileup_triggers` text,
	`user_notes` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_reviews_week_start_unique` ON `weekly_reviews` (`week_start`);