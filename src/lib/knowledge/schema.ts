/**
 * Knowledge System — Drizzle Schema
 *
 * Separate database from task DB. Uses customType for F32_BLOB vectors.
 * Vector index (objects_embedding_idx) MUST be created via raw SQL —
 * see setupVectorIndex() in migration.ts.
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/sqlite-core';

// =============================================================================
// CUSTOM TYPE: F32_BLOB for Turso native vector support
// =============================================================================

const float32Vector = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
  driverData: Buffer;
}>({
  dataType(config) {
    return `F32_BLOB(${config.dimensions})`;
  },
  fromDriver(value: Buffer) {
    return Array.from(new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4));
  },
  toDriver(value: number[]) {
    return sql`vector32(${JSON.stringify(value)})`;
  },
});

// =============================================================================
// OBJECTS — Unified knowledge store
// =============================================================================

export const objects = sqliteTable('objects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(),
  subtype: text('subtype'),
  name: text('name').notNull(),
  canonicalName: text('canonical_name').notNull(),
  dedupKey: text('dedup_key').notNull(),
  properties: text('properties').notNull().default('{}'),
  status: text('status').notNull().default('active'),
  pinned: integer('pinned').notNull().default(0),
  pinnedAt: text('pinned_at'),
  confidence: real('confidence').notNull().default(0.7),
  source: text('source').notNull().default('extracted'),
  sourceContext: text('source_context'),
  sensitivity: text('sensitivity').notNull().default('normal'),
  supersededBy: text('superseded_by'),
  embedding: float32Vector('embedding', { dimensions: 4096 }),
  embeddingModel: text('embedding_model'),
  embeddingText: text('embedding_text'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  typeStatusIdx: index('objects_type_status_idx').on(table.type, table.status),
  subtypeStatusIdx: index('objects_subtype_status_idx').on(table.subtype, table.status),
  lookupIdx: index('objects_lookup_idx').on(table.type, table.canonicalName),
  supersededIdx: index('objects_superseded_idx').on(table.supersededBy),
  typeDedupIdx: uniqueIndex('objects_type_dedup_idx').on(table.type, table.dedupKey),
}));

// =============================================================================
// LINKS — Typed directional relationships between objects
// =============================================================================

export const links = sqliteTable('links', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sourceId: text('source_id').notNull().references(() => objects.id, { onDelete: 'restrict' }),
  targetId: text('target_id').notNull().references(() => objects.id, { onDelete: 'restrict' }),
  linkType: text('link_type').notNull(),
  properties: text('properties').default('{}'),
  confidence: real('confidence').notNull().default(0.7),
  source: text('source').notNull().default('extracted'),
  sourceContext: text('source_context'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  sourceIdx: index('links_source_idx').on(table.sourceId),
  targetIdx: index('links_target_idx').on(table.targetId),
  typeIdx: index('links_type_idx').on(table.linkType),
  uniqueLink: uniqueIndex('links_unique_idx').on(table.sourceId, table.targetId, table.linkType),
}));

// =============================================================================
// OBJECT_REFERENCES — Audit trail of knowledge usage
// =============================================================================

export const objectReferences = sqliteTable('object_references', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  objectId: text('object_id').notNull().references(() => objects.id, { onDelete: 'restrict' }),
  interactionId: text('interaction_id'),
  context: text('context').notNull(),
  outcome: text('outcome').notNull().default('pending'),
  referencedAt: text('referenced_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  objectIdx: index('object_references_object_idx').on(table.objectId),
  timeIdx: index('object_references_time_idx').on(table.referencedAt),
  interactionIdx: index('object_references_interaction_idx').on(table.interactionId),
}));

// =============================================================================
// OBJECT_ALIASES — Entity resolution lookup
// =============================================================================

export const objectAliases = sqliteTable('object_aliases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  objectId: text('object_id').notNull().references(() => objects.id, { onDelete: 'restrict' }),
  alias: text('alias').notNull(),
  canonicalAlias: text('canonical_alias').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  lookupIdx: index('object_aliases_lookup_idx').on(table.canonicalAlias),
  uniqueAlias: uniqueIndex('object_aliases_unique_idx').on(table.objectId, table.canonicalAlias),
}));

// =============================================================================
// OBJECT_EVIDENCE — Provenance records
// =============================================================================

export const objectEvidence = sqliteTable('object_evidence', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  objectId: text('object_id').notNull().references(() => objects.id, { onDelete: 'restrict' }),
  interactionId: text('interaction_id'),
  taskId: text('task_id'),
  sourceContext: text('source_context').notNull(),
  evidenceType: text('evidence_type').notNull(),
  snippet: text('snippet'),
  confidence: real('confidence'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  objectIdx: index('object_evidence_object_idx').on(table.objectId),
}));

// =============================================================================
// EXTRACTION_BUFFER — Queue for batch extraction from non-LLM events
// =============================================================================

export const extractionBuffer = sqliteTable('extraction_buffer', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  eventType: text('event_type').notNull(),
  taskId: text('task_id'),
  taskTitle: text('task_title'),
  taskContext: text('task_context'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  processed: integer('processed').notNull().default(0),
  processedAt: text('processed_at'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  lockedAt: text('locked_at'),
}, (table) => ({
  processedIdx: index('extraction_buffer_processed_idx').on(table.processed),
  createdIdx: index('extraction_buffer_created_idx').on(table.createdAt),
}));

// =============================================================================
// REVIEW_QUEUE — User review for protected updates, conflicts, consolidation
// =============================================================================

export const reviewQueue = sqliteTable('review_queue', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  objectId: text('object_id'),
  reviewType: text('review_type').notNull(),
  proposedData: text('proposed_data').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
}, (table) => ({
  statusIdx: index('review_queue_status_idx').on(table.status),
}));

// =============================================================================
// CONSOLIDATION_RUNS — Audit trail for consolidation
// =============================================================================

export const consolidationRuns = sqliteTable('consolidation_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scope: text('scope').notNull(),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
  dormancyTransitions: integer('dormancy_transitions').default(0),
  reactivations: integer('reactivations').default(0),
  mergesPerformed: integer('merges_performed').default(0),
  synthesesCreated: integer('syntheses_created').default(0),
  objectsAbsorbed: integer('objects_absorbed').default(0),
  referencesPurged: integer('references_purged').default(0),
  status: text('status').notNull().default('running'),
  errorLog: text('error_log'),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ObjectRow = typeof objects.$inferSelect;
export type NewObject = typeof objects.$inferInsert;
export type LinkRow = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
