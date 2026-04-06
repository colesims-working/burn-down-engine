import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// PROJECTS
// ============================================================

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  todoistId: text('todoist_id').unique(),
  parentTodoistId: text('parent_todoist_id'),

  name: text('name').notNull(),
  category: text('category', {
    enum: ['work-primary', 'work-secondary', 'side-project', 'personal', 'homelab', 'travel', 'other'],
  }),
  goal: text('goal'),
  status: text('status', {
    enum: ['active', 'paused', 'archived', 'candidate-deprecation'],
  }).default('active'),

  openActionCount: integer('open_action_count').default(0),
  lastActivityAt: text('last_activity_at'),
  lastAuditAt: text('last_audit_at'),

  keyLinks: text('key_links').default('[]'),
  openDecisions: text('open_decisions').default('[]'),
  notes: text('notes'),
  relatedPeople: text('related_people').default('[]'),

  llmObservations: text('llm_observations'),
  suggestedActions: text('suggested_actions'),

  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  todoistSyncedAt: text('todoist_synced_at'),
}, (table) => ({
  statusIdx: index('idx_projects_status').on(table.status),
  categoryIdx: index('idx_projects_category').on(table.category),
}));

// ============================================================
// TASKS
// ============================================================

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  todoistId: text('todoist_id').unique(),

  // Content
  originalText: text('original_text').notNull(),
  title: text('title').notNull(),
  nextAction: text('next_action'),
  description: text('description'),

  // Organization
  projectId: text('project_id').references(() => projects.id),
  priority: integer('priority').default(4),
  rankWithinTier: integer('rank_within_tier'),
  labels: text('labels').default('[]'),

  // Timing
  dueDate: text('due_date'),
  timeEstimateMin: integer('time_estimate_min'),
  energyLevel: text('energy_level', { enum: ['high', 'medium', 'low'] }),
  isRecurring: integer('is_recurring', { mode: 'boolean' }).default(false),
  recurrenceRule: text('recurrence_rule'),

  // Status
  status: text('status', {
    enum: ['inbox', 'clarified', 'organized', 'active', 'waiting', 'blocked', 'deferred', 'completed', 'killed'],
  }).default('inbox'),
  blockerNote: text('blocker_note'),
  bumpCount: integer('bump_count').default(0),

  // Context
  contextNotes: text('context_notes'),
  relatedPeople: text('related_people').default('[]'),
  relatedLinks: text('related_links').default('[]'),

  // Decomposition
  parentTaskId: text('parent_task_id'),
  isDecomposed: integer('is_decomposed', { mode: 'boolean' }).default(false),

  // LLM Processing
  clarifyConfidence: real('clarify_confidence'),
  clarifyQuestions: text('clarify_questions'),
  llmNotes: text('llm_notes'),

  // Duplicate detection
  duplicateSuspectOf: text('duplicate_suspect_of'),
  dupeSimilarity: real('dupe_similarity'),
  dupeDismissedIds: text('dupe_dismissed_ids'), // Legacy — kept for migration compat
  dupeDismissedAt: text('dupe_dismissed_at'), // Timestamp of last "Keep All" — blocks re-flagging until embedding changes

  // Vector embedding
  embedding: blob('embedding'),
  embeddingText: text('embedding_text'),

  // Timestamps
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  todoistSyncedAt: text('todoist_synced_at'),
}, (table) => ({
  statusIdx: index('idx_tasks_status').on(table.status),
  projectIdx: index('idx_tasks_project').on(table.projectId),
  priorityIdx: index('idx_tasks_priority').on(table.priority, table.rankWithinTier),
  dueIdx: index('idx_tasks_due').on(table.dueDate),
  todoistIdx: uniqueIndex('idx_tasks_todoist').on(table.todoistId),
}));

// ============================================================
// KNOWLEDGE BASE
// ============================================================

export const people = sqliteTable('people', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  relationship: text('relationship'),
  organization: text('organization'),
  role: text('role'),
  contextNotes: text('context_notes'),
  relatedProjects: text('related_projects').default('[]'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const knowledgeEntries = sqliteTable('knowledge_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  category: text('category', {
    enum: ['identity', 'preference', 'pattern', 'priority', 'schedule', 'decision', 'fact', 'workflow', 'other'],
  }).notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  confidence: real('confidence').default(1.0),
  source: text('source'),
  timesReferenced: integer('times_referenced').default(0),

  embedding: blob('embedding'),
  embeddingText: text('embedding_text'),

  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => ({
  categoryIdx: index('idx_knowledge_category').on(table.category),
  keyIdx: index('idx_knowledge_key').on(table.key),
}));

export const decompositionTemplates = sqliteTable('decomposition_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  triggerPattern: text('trigger_pattern').notNull(),
  template: text('template').notNull(),
  timesUsed: integer('times_used').default(0),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================================
// HISTORY & REFLECTION
// ============================================================

export const taskHistory = sqliteTable('task_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text('task_id').notNull().references(() => tasks.id),
  action: text('action', {
    enum: ['created', 'clarified', 'organized', 'prioritized', 'bumped', 'blocked',
      'unblocked', 'completed', 'killed', 'decomposed', 'fire_promoted', 'deferred', 'reranked', 'waiting'],
  }).notNull(),
  details: text('details'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
}, (table) => ({
  taskIdx: index('idx_history_task').on(table.taskId),
  actionIdx: index('idx_history_action').on(table.action),
  timestampIdx: index('idx_history_timestamp').on(table.timestamp),
}));

export const dailyReviews = sqliteTable('daily_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  reviewDate: text('review_date').notNull().unique(),

  plannedCount: integer('planned_count'),
  completedCount: integer('completed_count'),
  bumpedCount: integer('bumped_count'),
  fireCount: integer('fire_count'),
  completionRate: real('completion_rate'),

  completedTasks: text('completed_tasks'),
  bumpedTasks: text('bumped_tasks'),
  blockedTasks: text('blocked_tasks'),
  killedTasks: text('killed_tasks'),
  freeCapture: text('free_capture'),
  tomorrowSeed: text('tomorrow_seed'),

  llmObservations: text('llm_observations'),
  llmSuggestions: text('llm_suggestions'),

  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const weeklyReviews = sqliteTable('weekly_reviews', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  weekStart: text('week_start').notNull().unique(),

  avgCompletionRate: real('avg_completion_rate'),
  totalFires: integer('total_fires'),
  totalCompleted: integer('total_completed'),
  totalBumped: integer('total_bumped'),
  mostProductiveDay: text('most_productive_day'),

  priorityRecalibration: text('priority_recalibration'),
  projectAuditNotes: text('project_audit_notes'),
  patternObservations: text('pattern_observations'),
  antiPileupTriggers: text('anti_pileup_triggers'),
  userNotes: text('user_notes'),

  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// ============================================================
// LLM TRACKING
// ============================================================

export const llmInteractions = sqliteTable('llm_interactions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  page: text('page').notNull(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(),
  inputSummary: text('input_summary'),
  outputSummary: text('output_summary'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  latencyMs: integer('latency_ms'),
  costEstimate: real('cost_estimate'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
}, (table) => ({
  pageIdx: index('idx_llm_page').on(table.page),
  timestampIdx: index('idx_llm_timestamp').on(table.timestamp),
}));

// ============================================================
// APP LOG (Diagnostics)
// ============================================================

export const appLog = sqliteTable('app_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull().default('info'),
  category: text('category', {
    enum: ['sync', 'task', 'llm', 'auth', 'system'],
  }).notNull(),
  message: text('message').notNull(),
  details: text('details'), // JSON string for structured context
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
}, (table) => ({
  categoryIdx: index('idx_app_log_category').on(table.category),
  timestampIdx: index('idx_app_log_timestamp').on(table.timestamp),
  levelIdx: index('idx_app_log_level').on(table.level),
}));

// ============================================================
// SYNC STATE
// ============================================================

export const syncState = sqliteTable('sync_state', {
  id: text('id').primaryKey().default('singleton'),
  lastFullSync: text('last_full_sync'),
  lastInboxSync: text('last_inbox_sync'),
  syncToken: text('sync_token'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================================
// APP SETTINGS
// ============================================================

export const appSettings = sqliteTable('app_settings', {
  id: text('id').primaryKey().default('singleton'),
  primaryModel: text('primary_model').default('gemini-3.1-flash-lite-preview'),
  heavyModel: text('heavy_model').default('claude-opus-4-20250514'),
  // JSON map: { [LLMOperation]: { provider: 'gemini'|'anthropic'|'openai', model: string } }
  modelConfig: text('model_config'),
  // JSON array of "provider:modelId" strings that the admin has disabled
  disabledModels: text('disabled_models'),
  autoApproveThreshold: real('auto_approve_threshold').default(0.8),
  dupeSimilarityThreshold: real('dupe_similarity_threshold').default(0.92),
  monthlyBudget: real('monthly_budget'), // USD budget limit, null = no limit
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Person = typeof people.$inferSelect;
export type KnowledgeEntry = typeof knowledgeEntries.$inferSelect;
export type TaskHistoryEntry = typeof taskHistory.$inferSelect;
export type DailyReview = typeof dailyReviews.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type AppLogEntry = typeof appLog.$inferSelect;
