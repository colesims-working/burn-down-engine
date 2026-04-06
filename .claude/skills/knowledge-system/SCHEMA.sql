-- Knowledge System Schema
-- Turso/libSQL with native vector support
-- Database: knowledge-graph (separate from task DB)
-- Spec: KNOWLEDGE_SYSTEM_SPEC_v1.2.md

-- =============================================================================
-- OBJECTS — Unified knowledge store (replaces knowledge_entries + people)
-- =============================================================================

CREATE TABLE objects (
  id              TEXT PRIMARY KEY,                                          -- CUID
  type            TEXT NOT NULL,                                              -- 'person' | 'project' | 'organization' | 'concept' | 'event'
  subtype         TEXT,                                                       -- concept subcategory, event type, person relationship, etc.
  name            TEXT NOT NULL,                                              -- Human-readable display name
  canonical_name  TEXT NOT NULL,                                              -- Lowercased, whitespace-normalized for lookup
  dedup_key       TEXT NOT NULL,                                              -- Stable canonical identity key
  properties      TEXT NOT NULL DEFAULT '{}',                                 -- JSON blob, type-specific fields
  status          TEXT NOT NULL DEFAULT 'active',                             -- 'active' | 'dormant' | 'absorbed' | 'deleted'
  pinned          INTEGER NOT NULL DEFAULT 0,                                 -- 1 = always in context, never dormant
  pinned_at       TEXT,                                                       -- Timestamp of pinning
  confidence      REAL NOT NULL DEFAULT 0.7,                                  -- 0.0–1.0
  source          TEXT NOT NULL DEFAULT 'extracted',                          -- 'seed' | 'manual' | 'extracted' | 'consolidated' | 'migrated'
  source_context  TEXT,                                                       -- 'clarify' | 'organize' | 'reflect' | 'engage' | 'capture' | 'complete' | 'review' | 'buffer_flush' | 'consolidation:{run_id}'
  sensitivity     TEXT NOT NULL DEFAULT 'normal',                             -- 'normal' | 'sensitive'
  superseded_by   TEXT REFERENCES objects(id),                                -- Fast filter for version chains
  embedding       F32_BLOB(4096),                                            -- Qwen3-Embedding-8B, 4096 dims
  embedding_model TEXT,                                                       -- e.g. 'qwen/qwen3-embedding-8b'
  embedding_text  TEXT,                                                       -- Text that was embedded (for recomputation)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type, dedup_key)
);

CREATE INDEX objects_type_status_idx ON objects(type, status);
CREATE INDEX objects_subtype_status_idx ON objects(subtype, status);
CREATE INDEX objects_lookup_idx ON objects(type, canonical_name);
CREATE INDEX objects_pinned_idx ON objects(pinned) WHERE pinned = 1;
CREATE INDEX objects_superseded_idx ON objects(superseded_by);

-- Vector index — MUST be created via raw SQL, not Drizzle migrations
-- Run after table is populated with initial data
CREATE INDEX objects_embedding_idx ON objects(libsql_vector_idx(embedding, 'metric=cosine'));


-- =============================================================================
-- LINKS — Typed directional relationships between objects
-- =============================================================================

CREATE TABLE links (
  id            TEXT PRIMARY KEY,                                              -- CUID
  source_id     TEXT NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  target_id     TEXT NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  link_type     TEXT NOT NULL,                                                 -- See link type vocabulary in SKILL.md
  properties    TEXT DEFAULT '{}',                                             -- JSON for edge metadata
  confidence    REAL NOT NULL DEFAULT 0.7,
  source        TEXT NOT NULL DEFAULT 'extracted',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, target_id, link_type)
);

CREATE INDEX links_source_idx ON links(source_id);
CREATE INDEX links_target_idx ON links(target_id);
CREATE INDEX links_type_idx ON links(link_type);


-- =============================================================================
-- OBJECT_REFERENCES — Audit trail of knowledge usage
-- =============================================================================

CREATE TABLE object_references (
  id              TEXT PRIMARY KEY,                                            -- CUID
  object_id       TEXT NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  interaction_id  TEXT,                                                         -- Groups refs from same LLM call
  context         TEXT NOT NULL,                                                -- 'clarify' | 'organize' | 'engage' | 'reflect' | 'capture'
  outcome         TEXT NOT NULL DEFAULT 'pending',                              -- 'pending' | 'positive' | 'negative' | 'neutral'
  referenced_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX object_references_object_idx ON object_references(object_id);
CREATE INDEX object_references_time_idx ON object_references(referenced_at);
CREATE INDEX object_references_interaction_idx ON object_references(interaction_id);


-- =============================================================================
-- OBJECT_ALIASES — Entity resolution lookup
-- =============================================================================

CREATE TABLE object_aliases (
  id              TEXT PRIMARY KEY,                                            -- CUID
  object_id       TEXT NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  alias           TEXT NOT NULL,                                                -- Display form
  canonical_alias TEXT NOT NULL,                                                -- Lowercased, normalized
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(object_id, canonical_alias)
);

CREATE INDEX object_aliases_lookup_idx ON object_aliases(canonical_alias);


-- =============================================================================
-- OBJECT_EVIDENCE — Provenance records
-- =============================================================================

CREATE TABLE object_evidence (
  id              TEXT PRIMARY KEY,                                            -- CUID
  object_id       TEXT NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  interaction_id  TEXT,
  task_id         TEXT,
  source_context  TEXT NOT NULL,                                                -- 'clarify' | 'organize' | etc.
  evidence_type   TEXT NOT NULL,                                                -- 'extraction' | 'manual_edit' | 'migration' | 'consolidation'
  snippet         TEXT,                                                         -- Short supporting text
  confidence      REAL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX object_evidence_object_idx ON object_evidence(object_id);


-- =============================================================================
-- EXTRACTION_BUFFER — Queue for batch extraction from non-LLM events
-- =============================================================================

CREATE TABLE extraction_buffer (
  id            TEXT PRIMARY KEY,                                              -- CUID
  event_type    TEXT NOT NULL,                                                  -- 'complete' | 'defer' | 'bump' | 'block' | 'wait' | 'fire' | 'kill'
  task_id       TEXT,
  task_title    TEXT,
  task_context  TEXT,                                                           -- JSON with task metadata
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  processed     INTEGER NOT NULL DEFAULT 0,
  processed_at  TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  locked_at     TEXT                                                            -- Concurrency safety
);

CREATE INDEX extraction_buffer_processed_idx ON extraction_buffer(processed);
CREATE INDEX extraction_buffer_created_idx ON extraction_buffer(created_at);


-- =============================================================================
-- REVIEW_QUEUE — User review for protected updates, conflicts, consolidation
-- =============================================================================

CREATE TABLE review_queue (
  id              TEXT PRIMARY KEY,                                            -- CUID
  object_id       TEXT,
  review_type     TEXT NOT NULL,                                                -- 'protected_update' | 'conflict' | 'merge_candidate' | 'synthesis_candidate'
  proposed_data   TEXT NOT NULL,                                                -- JSON with proposed changes
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',                              -- 'pending' | 'approved' | 'rejected'
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT
);

CREATE INDEX review_queue_status_idx ON review_queue(status);


-- =============================================================================
-- CONSOLIDATION_RUNS — Audit trail for consolidation with rollback support
-- =============================================================================

CREATE TABLE consolidation_runs (
  id                    TEXT PRIMARY KEY,                                      -- CUID
  scope                 TEXT NOT NULL,                                          -- 'full' | 'active_only'
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  dormancy_transitions  INTEGER DEFAULT 0,
  reactivations         INTEGER DEFAULT 0,
  merges_performed      INTEGER DEFAULT 0,
  syntheses_created     INTEGER DEFAULT 0,
  objects_absorbed      INTEGER DEFAULT 0,
  references_purged     INTEGER DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'running',                        -- 'running' | 'completed' | 'failed' | 'reverted'
  error_log             TEXT                                                    -- JSON array of error messages
);
