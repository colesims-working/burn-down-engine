# The Burn-Down Engine
## Technical & Design Specification v1.0
### A Daily-Driven GTD Intelligence Layer for Todoist

**Author:** Cole
**AI Pair:** Claude (Product/Design Partnership)
**Date:** February 23, 2026
**Status:** Locked for v1 Development

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Architecture Overview](#2-architecture-overview)
3. [Tech Stack](#3-tech-stack)
4. [Data Model & Schema](#4-data-model--schema)
5. [Page Specifications](#5-page-specifications)
   - 5.1 Inbox
   - 5.2 Clarify
   - 5.3 Organize
   - 5.4 Engage
   - 5.5 Reflect
   - 5.6 Knowledge Base
   - 5.7 Settings
6. [The Knowledge System](#6-the-knowledge-system)
7. [LLM Integration Architecture](#7-llm-integration-architecture)
8. [Todoist Sync Layer](#8-todoist-sync-layer)
9. [Prioritization Engine](#9-prioritization-engine)
10. [Voice Capture System](#10-voice-capture-system)
11. [Vector Embedding Pipeline](#11-vector-embedding-pipeline)
12. [Auth & Security](#12-auth--security)
13. [Deployment](#13-deployment)
14. [Build Plan & Milestones](#14-build-plan--milestones)
15. [v2 Roadmap](#15-v2-roadmap)

---

## 1. Product Vision

### One-Liner

The Burn-Down Engine is a daily-driven GTD intelligence layer on top of Todoist that turns messy captures into a perfectly prioritized, "just execute" action list â€” with a persistent AI brain that learns how you work.

### Problem Statement

Todoist is excellent at capture, storage, and sync. It is terrible at thinking. It doesn't know what your tasks mean, which ones matter, whether your projects make sense, or how to help you recover when a fire blows up your day. The Burn-Down Engine fills that gap: it's the intelligence Todoist lacks.

### Core Value Proposition

- **Capture** â†’ Voice dump or quick-add, synced to Todoist inbox
- **Clarify** â†’ LLM transforms messy captures into perfect GTD next actions (auto-enriched, decomposed, formatted)
- **Organize** â†’ LLM manages project health, task filing, tag taxonomy â€” learns organizational patterns over time
- **Engage** â†’ Single ranked list, zero decisions required, fire protocol built in
- **Reflect** â†’ Daily close-out and weekly review that feeds the learning system

### Design Principles

1. **The system thinks so you don't have to.** Every page should reduce cognitive load, not add it.
2. **Infer aggressively, ask sparingly.** The LLM should handle 80%+ of decisions autonomously using the knowledge base.
3. **Fires are normal, not catastrophic.** The system handles interrupts gracefully â€” bumps are logged, not lost.
4. **The knowledge base is the moat.** Day 30 should be dramatically better than day 1.
5. **Simple, modular, fun.** If a feature doesn't feel good to use daily, cut it.

---

## 2. Architecture Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    THE BURN-DOWN ENGINE                       â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚                   Next.js App (App Router)             â”‚  â”‚
â”‚  â”‚                                                        â”‚  â”‚
â”‚  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚  â”‚
â”‚  â”‚  â”‚   React Frontend â”‚    â”‚   Server Actions &        â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   shadcn/ui      â”‚    â”‚   API Routes              â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   Tailwind CSS   â”‚    â”‚                           â”‚ â”‚  â”‚
â”‚  â”‚  â”‚                  â”‚    â”‚   â€¢ Todoist sync layer     â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   Pages:         â”‚    â”‚   â€¢ LLM orchestration     â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Inbox        â”‚    â”‚   â€¢ Knowledge base CRUD   â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Clarify      â”‚    â”‚   â€¢ Voice processing      â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Organize     â”‚    â”‚   â€¢ Embedding pipeline    â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Engage       â”‚    â”‚   â€¢ Auth middleware        â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Reflect      â”‚    â”‚                           â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Knowledge    â”‚    â”‚                           â”‚ â”‚  â”‚
â”‚  â”‚  â”‚   â€¢ Settings     â”‚    â”‚                           â”‚ â”‚  â”‚
â”‚  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚  â”‚
â”‚  â”‚           â”‚                        â”‚                   â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚              â”‚                        â”‚                      â”‚
â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       â”‚
â”‚   â”‚          â”‚                        â”‚              â”‚       â”‚
â”‚   â–¼          â–¼                        â–¼              â–¼       â”‚
â”‚ â”Œâ”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚ â”‚Turso â”‚  â”‚ Todoist  â”‚  â”‚ Gemini 2.5   â”‚  â”‚  Whisper     â”‚  â”‚
â”‚ â”‚libSQLâ”‚  â”‚ REST API â”‚  â”‚ Flash (fast) â”‚  â”‚  API         â”‚  â”‚
â”‚ â”‚      â”‚  â”‚          â”‚  â”‚              â”‚  â”‚  (voice)     â”‚  â”‚
â”‚ â”‚Tablesâ”‚  â”‚ Tasks    â”‚  â”‚ Claude Opus  â”‚  â”‚              â”‚  â”‚
â”‚ â”‚Vectorsâ”‚ â”‚ Projects â”‚  â”‚ (heavy)      â”‚  â”‚              â”‚  â”‚
â”‚ â”‚Historyâ”‚ â”‚ Labels   â”‚  â”‚              â”‚  â”‚              â”‚  â”‚
â”‚ â””â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Data Flow Summary

```
Todoist Inbox â”€â”€pullâ”€â”€â†’ Inbox Page â”€â”€processâ”€â”€â†’ Clarify â”€â”€assignâ”€â”€â†’ Organize
                                                   â”‚                    â”‚
                                                   â–¼                    â–¼
                                            Knowledge Base â†â”€â”€ learns from both
                                                   â”‚
                                                   â–¼
                                                Engage â”€â”€completeâ”€â”€â†’ Reflect
                                                   â”‚                    â”‚
                                                   â–¼                    â–¼
                                              Todoist API         Knowledge Base
                                            (write back)          (patterns)
```

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Framework** | Next.js 14+ (App Router) | Server Actions for secure API calls, streaming for LLM responses, full-stack single codebase. Correct for team of one. |
| **UI** | Tailwind CSS + shadcn/ui | Clean, fast, minimal. Linear/Things 3 aesthetic. No fighting component libraries. |
| **Database** | Turso (libSQL) + Drizzle ORM | Distributed SQLite-compatible. Free tier covers usage. Zero ops. Drizzle for type-safe queries with excellent SQLite support. |
| **Primary LLM** | Gemini 2.5 Flash | 90% of operations: task clarification, formatting, quick Q&A, knowledge extraction. Fast and cheap. |
| **Heavy LLM** | Claude Opus | 10% of operations: project audits, pattern analysis, complex decomposition, weekly review synthesis. Superior reasoning. |
| **Voice** | OpenAI Whisper API | Voice capture + dictation. $0.006/min. Server-side processing via API. |
| **Embeddings** | Gemini `text-embedding-004` | Task and knowledge base embeddings. 768 dimensions. Free tier generous. Stored in Turso. |
| **Auth** | bcrypt + HTTP-only session cookie | Single-user app. Password in env var. No OAuth complexity. |
| **Deployment** | Vercel | Zero-ops, global edge, native Next.js support. Free tier likely sufficient. |
| **Todoist** | Todoist REST API v2 | On-demand sync (pull on page load, write on action). Webhooks deferred to v2. |

### Dependency Summary

```json
{
  "core": {
    "next": "^14.x",
    "react": "^18.x",
    "drizzle-orm": "latest",
    "@libsql/client": "latest",
    "tailwindcss": "^3.x",
    "@shadcn/ui": "latest"
  },
  "llm": {
    "@google/generative-ai": "latest",
    "@anthropic-ai/sdk": "latest"
  },
  "voice": {
    "openai": "latest"
  },
  "auth": {
    "bcryptjs": "latest",
    "iron-session": "latest"
  },
  "utilities": {
    "zod": "latest",
    "date-fns": "latest",
    "nanoid": "latest"
  }
}
```

---

## 4. Data Model & Schema

### 4.1 Tasks Table

The local cache of Todoist tasks, enriched with system metadata.

```sql
CREATE TABLE tasks (
  -- Identity
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  todoist_id        TEXT UNIQUE,                          -- Todoist's task ID

  -- Core content
  original_text     TEXT NOT NULL,                        -- Raw capture text (preserved)
  title             TEXT NOT NULL,                        -- Clarified title
  next_action       TEXT,                                 -- Specific next action (1 verb + object)
  description       TEXT,                                 -- Enriched description/context

  -- Organization
  project_id        TEXT REFERENCES projects(id),
  priority          INTEGER DEFAULT 4 CHECK (priority BETWEEN 0 AND 4),  -- 0=fire, 1-4=P1-P4
  rank_within_tier  INTEGER,                              -- LLM-assigned intra-tier rank
  labels            TEXT DEFAULT '[]',                    -- JSON array of label strings

  -- Timing
  due_date          TEXT,                                 -- ISO date
  time_estimate_min INTEGER,                              -- Estimated minutes
  energy_level      TEXT CHECK (energy_level IN ('high', 'medium', 'low')),
  is_recurring       INTEGER DEFAULT 0,                   -- Boolean
  recurrence_rule   TEXT,                                 -- Todoist recurrence string

  -- Status
  status            TEXT DEFAULT 'inbox'
                    CHECK (status IN ('inbox', 'clarified', 'organized', 'active',
                                       'waiting', 'blocked', 'deferred', 'completed',
                                       'killed')),
  blocker_note      TEXT,                                 -- What's blocking this
  bump_count        INTEGER DEFAULT 0,                    -- Times deferred/bumped

  -- Context (the enrichment that makes this system valuable)
  context_notes     TEXT,                                 -- Links, decisions, dependencies, "why"
  related_people    TEXT DEFAULT '[]',                    -- JSON array of person references
  related_links     TEXT DEFAULT '[]',                    -- JSON array of URLs

  -- Decomposition
  parent_task_id    TEXT REFERENCES tasks(id),            -- For subtask relationships
  is_decomposed     INTEGER DEFAULT 0,                    -- Was this broken down from a larger task

  -- LLM Processing
  clarify_confidence REAL,                               -- 0.0-1.0, how confident the LLM was
  clarify_questions  TEXT,                                -- JSON: questions the LLM wants to ask
  llm_notes         TEXT,                                 -- LLM's reasoning/notes during processing

  -- Vector embedding
  embedding         BLOB,                                -- 768-dim float32 vector
  embedding_text    TEXT,                                 -- The text that was embedded

  -- Timestamps
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  completed_at      TEXT,
  todoist_synced_at TEXT                                  -- Last sync with Todoist
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_priority ON tasks(priority, rank_within_tier);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_todoist ON tasks(todoist_id);
```

### 4.2 Projects Table

```sql
CREATE TABLE projects (
  -- Identity
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  todoist_id        TEXT UNIQUE,

  -- Core
  name              TEXT NOT NULL,
  category          TEXT CHECK (category IN ('work-primary', 'work-secondary',
                                              'side-project', 'personal',
                                              'homelab', 'travel', 'other')),
  goal              TEXT,                                 -- "Done looks like..."
  status            TEXT DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'archived',
                                       'candidate-deprecation')),

  -- Health metrics
  open_action_count INTEGER DEFAULT 0,
  last_activity_at  TEXT,
  last_audit_at     TEXT,

  -- Context
  key_links         TEXT DEFAULT '[]',                    -- JSON array of URLs
  open_decisions    TEXT DEFAULT '[]',                    -- JSON array of decision strings
  notes             TEXT,                                 -- Running context log
  related_people    TEXT DEFAULT '[]',                    -- JSON array of person references

  -- LLM Management
  llm_observations  TEXT,                                 -- LLM's notes about this project
  suggested_actions TEXT,                                 -- Pending LLM recommendations

  -- Timestamps
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  todoist_synced_at TEXT
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_category ON projects(category);
```

### 4.3 Knowledge Base Tables

```sql
-- People the user works/interacts with
CREATE TABLE people (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  name              TEXT NOT NULL,
  relationship      TEXT,                                 -- "manager", "collaborator", "wife", etc.
  organization      TEXT,                                 -- "Microsoft", "SNMMI", etc.
  role              TEXT,                                 -- Their role/title
  context_notes     TEXT,                                 -- How the user interacts with them, preferences
  related_projects  TEXT DEFAULT '[]',                    -- JSON array of project IDs
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- Facts and preferences the system has learned
CREATE TABLE knowledge_entries (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  category          TEXT NOT NULL
                    CHECK (category IN ('identity', 'preference', 'pattern',
                                         'priority', 'schedule', 'decision',
                                         'fact', 'workflow', 'other')),
  key               TEXT NOT NULL,                        -- Lookup key (e.g., "preferred_task_format")
  value             TEXT NOT NULL,                        -- The knowledge content
  confidence        REAL DEFAULT 1.0,                     -- 0.0-1.0, how confident the system is
  source            TEXT,                                 -- Where this was learned ("clarify_session", "user_edit", etc.)
  times_referenced  INTEGER DEFAULT 0,                    -- How often this is used

  -- Vector embedding for semantic lookup
  embedding         BLOB,
  embedding_text    TEXT,

  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_knowledge_category ON knowledge_entries(category);
CREATE INDEX idx_knowledge_key ON knowledge_entries(key);

-- Task decomposition templates the system has learned
CREATE TABLE decomposition_templates (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  trigger_pattern   TEXT NOT NULL,                        -- What kind of task triggers this
  template          TEXT NOT NULL,                        -- JSON: array of subtask templates
  times_used        INTEGER DEFAULT 0,
  last_used_at      TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
```

### 4.4 History & Reflection Tables

```sql
-- Every task action is logged (for biannual reviews, pattern detection)
CREATE TABLE task_history (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  task_id           TEXT NOT NULL REFERENCES tasks(id),
  action            TEXT NOT NULL
                    CHECK (action IN ('created', 'clarified', 'organized',
                                       'prioritized', 'bumped', 'blocked',
                                       'unblocked', 'completed', 'killed',
                                       'decomposed', 'fire_promoted',
                                       'deferred', 'reranked')),
  details           TEXT,                                 -- JSON: action-specific details
  timestamp         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_history_task ON task_history(task_id);
CREATE INDEX idx_history_action ON task_history(action);
CREATE INDEX idx_history_timestamp ON task_history(timestamp);

-- Daily review records
CREATE TABLE daily_reviews (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  review_date       TEXT NOT NULL UNIQUE,                 -- ISO date

  -- Stats
  planned_count     INTEGER,
  completed_count   INTEGER,
  bumped_count      INTEGER,
  fire_count        INTEGER,
  completion_rate   REAL,

  -- Content
  completed_tasks   TEXT,                                 -- JSON array of task IDs
  bumped_tasks      TEXT,                                 -- JSON array of {task_id, reason}
  blocked_tasks     TEXT,                                 -- JSON array of {task_id, blocker}
  killed_tasks      TEXT,                                 -- JSON array of task IDs
  free_capture      TEXT,                                 -- User's end-of-day notes
  tomorrow_seed     TEXT,                                 -- JSON array of pre-flagged task IDs

  -- LLM Analysis
  llm_observations  TEXT,                                 -- Patterns noticed
  llm_suggestions   TEXT,                                 -- Recommendations

  created_at        TEXT DEFAULT (datetime('now'))
);

-- Weekly review records
CREATE TABLE weekly_reviews (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  week_start        TEXT NOT NULL UNIQUE,                 -- ISO date (Monday)

  -- Aggregated stats
  avg_completion_rate REAL,
  total_fires       INTEGER,
  total_completed   INTEGER,
  total_bumped      INTEGER,
  most_productive_day TEXT,

  -- Content
  priority_recalibration TEXT,                            -- Updated priority rankings
  project_audit_notes    TEXT,                            -- Project health observations
  pattern_observations   TEXT,                            -- LLM-detected patterns
  anti_pileup_triggers   TEXT,                            -- Tasks bumped 3+ times
  user_notes             TEXT,                            -- User's weekly reflection

  created_at        TEXT DEFAULT (datetime('now'))
);
```

### 4.5 LLM Conversation Log

```sql
-- Track LLM interactions for transparency and debugging
CREATE TABLE llm_interactions (
  id                TEXT PRIMARY KEY DEFAULT (nanoid()),
  page              TEXT NOT NULL,                        -- Which page triggered this
  model             TEXT NOT NULL,                        -- "gemini-flash" or "claude-opus"
  purpose           TEXT NOT NULL,                        -- "clarify_task", "audit_project", etc.
  input_summary     TEXT,                                 -- Brief description of what was sent
  output_summary    TEXT,                                 -- Brief description of what came back
  tokens_in         INTEGER,
  tokens_out        INTEGER,
  latency_ms        INTEGER,
  cost_estimate     REAL,                                 -- Estimated cost in USD
  timestamp         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_llm_page ON llm_interactions(page);
CREATE INDEX idx_llm_timestamp ON llm_interactions(timestamp);
```

### 4.6 Sync State

```sql
-- Track Todoist sync state
CREATE TABLE sync_state (
  id                TEXT PRIMARY KEY DEFAULT 'singleton',
  last_full_sync    TEXT,                                 -- Last time we pulled everything
  last_inbox_sync   TEXT,                                 -- Last time we pulled inbox
  sync_token        TEXT,                                 -- Todoist sync token for incremental
  updated_at        TEXT DEFAULT (datetime('now'))
);
```

---

## 5. Page Specifications

### 5.1 Inbox

**Purpose:** See what's unprocessed. Fast capture (text + voice). Gateway to Clarify.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  INBOX                                    [Sync Now] â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ ðŸŽ¤ [Voice Dump]  â”Š  Quick add...       [Add]  â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  Unprocessed (8)                                     â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ â–¡ RankEngine bayesian thing â€” look at wilson...  â”‚  â”‚
â”‚  â”‚ â–¡ sara pmp celebration dinner                  â”‚  â”‚
â”‚  â”‚ â–¡ Alice wants to meet about Analysis Agent...  â”‚  â”‚
â”‚  â”‚ â–¡ Hawaii - do we need travel insurance?         â”‚  â”‚
â”‚  â”‚ â–¡ clean eatz inventory system is acting up...  â”‚  â”‚
â”‚  â”‚ â–¡ update homelab dns records                   â”‚  â”‚
â”‚  â”‚ â–¡ read that paper Carol sent about LLM evals   â”‚  â”‚
â”‚  â”‚ â–¡ todoist cleanup lol                          â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  [Process All â†’ Clarify]          [Process Selected] â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Behaviors:**
- On page load: sync inbox from Todoist API
- Quick-add bar: creates task in Todoist inbox + local cache
- Voice Dump button: starts Whisper recording â†’ transcription â†’ LLM task extraction â†’ creates individual inbox items
- Badge count in nav shows unprocessed item count
- "Process All" sends entire inbox to Clarify page
- Individual items can be selected for partial processing
- Items display original text as-captured (messy is fine here)

**Voice Dump Flow:**
```
[Mic Button] â†’ Recording indicator + waveform
    â†’ [Stop] â†’ "Processing..." spinner
    â†’ Whisper API transcription
    â†’ Gemini Flash task extraction:
        System: "Extract discrete actionable tasks from this stream-of-consciousness
                 capture. Return each as a separate task. Preserve intent, add
                 nothing extra."
    â†’ Display extracted tasks with checkboxes
    â†’ [Approve & Add to Inbox] / [Edit] / [Discard]
    â†’ Approved items â†’ Todoist inbox + local cache
```

### 5.2 Clarify

**Purpose:** Transform messy inbox items into perfect GTD next actions. The workhorse page.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  CLARIFY                          Processing: 8 / 8  â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ LLM Questions (2 items need input) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  ðŸ”¶ "sara pmp celebration dinner"               â”‚  â”‚
â”‚  â”‚     â†’ I think: Make dinner reservation.         â”‚  â”‚
â”‚  â”‚     â†’ Need: Date preference + restaurant type?  â”‚  â”‚
â”‚  â”‚     [Answer...                        ] [Send]  â”‚  â”‚
â”‚  â”‚     [ðŸŽ¤ Dictate]                                â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  ðŸ”¶ "clean eatz inventory system acting up"     â”‚  â”‚
â”‚  â”‚     â†’ Is this the same sync bug from December?  â”‚  â”‚
â”‚  â”‚     â†’ Need: Same issue or new problem?          â”‚  â”‚
â”‚  â”‚     â—‹ Same bug, escalate to vendor              â”‚  â”‚
â”‚  â”‚     â—‹ New issue, need to diagnose               â”‚  â”‚
â”‚  â”‚     â—‹ Not sure yet                              â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Auto-Processed (6 items, high confidence) â”€â”€â”€â”  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  âœ… "RankEngine bayesian thing..."                â”‚  â”‚
â”‚  â”‚     â†’ Research Wilson Score Interval as         â”‚  â”‚
â”‚  â”‚       alternative to current Bayesian average   â”‚  â”‚
â”‚  â”‚     ðŸ“ RankEngine  |  P2  |  @deep-work  | 45min â”‚  â”‚
â”‚  â”‚     [âœ“ Approve] [âœŽ Edit] [â–¾ Expand]            â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  âœ… "Alice wants to meet about analysis..."     â”‚  â”‚
â”‚  â”‚     â†’ Reply to Alice to schedule analysis       â”‚  â”‚
â”‚  â”‚       Agent metrics review. Prep: pull latest   â”‚  â”‚
â”‚  â”‚       accuracy numbers from Kusto beforehand.   â”‚  â”‚
â”‚  â”‚     ðŸ“ Analysis Agent | P1 | @work | 40min      â”‚  â”‚
â”‚  â”‚     [âœ“ Approve] [âœŽ Edit] [â–¾ Expand]            â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  ... (4 more)                                   â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  [Approve All High-Confidence]                  â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Expanded Task Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚  Original: "RankEngine bayesian thing â€” look at   â”‚ â”‚
â”‚  â”‚            wilson score interval instead?"       â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Title: Research Wilson Score Interval for       â”‚ â”‚
â”‚  â”‚         RankEngine Ranking Algorithm               â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Next Action: Compare Wilson Score Interval      â”‚ â”‚
â”‚  â”‚  against current Bayesian average â€” focus on     â”‚ â”‚
â”‚  â”‚  accuracy for restaurants with <10 reviews.      â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Project: [RankEngine â–¾]                           â”‚ â”‚
â”‚  â”‚  Priority: [P2 â–¾]   Labels: [@deep-work â–¾]      â”‚ â”‚
â”‚  â”‚  Time: [45 min]     Energy: [ðŸ”´ High â–¾]         â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Context Notes:                                  â”‚ â”‚
â”‚  â”‚  Current RankEngine implementation uses standard   â”‚ â”‚
â”‚  â”‚  Bayesian average. Wilson Score may handle       â”‚ â”‚
â”‚  â”‚  low-sample restaurants better. Testing planned  â”‚ â”‚
â”‚  â”‚  against Hawaii restaurant data during April      â”‚ â”‚
â”‚  â”‚  trip.                                           â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Related: [Hawaii Trip] [RankEngine GitHub]         â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Decompose into subtasks? [Yes] [No]             â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  [Save & Approve]  [Cancel]                      â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**LLM Processing Pipeline (per task):**

```
INPUT: raw inbox text + knowledge base context

STEP 1: Context Injection
  - Fetch relevant knowledge entries (people, projects, patterns)
  - Match known people names, project keywords, prior similar tasks
  - Inject as system context for the LLM

STEP 2: Clarification
  Gemini Flash prompt:
  """
  You are a GTD task clarification assistant. You know the following
  about the user:
  {relevant_knowledge_entries}

  Active projects:
  {project_registry}

  Task to clarify: "{original_text}"

  Produce:
  1. title: Clear, capitalized, professional task title
  2. next_action: Specific next physical/digital action. Start with a verb.
     Must be concrete enough to execute without further thinking.
  3. project: Best matching project (or "NEW: [suggested name]")
  4. priority: P1-P4 with reasoning
  5. labels: From [deep-work, quick-win, waiting, errand, home, work, personal]
  6. time_estimate_min: Integer
  7. energy_level: high/medium/low
  8. context_notes: Any enrichment â€” links, dependencies, related decisions
  9. related_people: Names of people involved
  10. decomposition_needed: true/false (true if task is too big for single action)
  11. confidence: 0.0-1.0 (how confident you are in this clarification)
  12. questions: [] (if confidence < 0.7, what do you need to ask?)

  If the task is vague, DO NOT GUESS. Set confidence low and ask
  specific questions.

  If the task should be decomposed, provide 2-5 concrete subtasks.
  """

STEP 3: Confidence Routing
  - confidence >= 0.8 â†’ auto-processed batch (user can approve/edit)
  - confidence 0.5-0.79 â†’ auto-processed but flagged for review
  - confidence < 0.5 â†’ question queue (must answer before proceeding)

STEP 4: Knowledge Extraction
  - After clarification, extract any new facts learned
  - "Alice wants to meet about Analysis Agent" â†’ update people.Alice
    with "involved in Analysis Agent metrics review"
  - Store decomposition patterns for future use

STEP 5: Embedding
  - Generate vector embedding of clarified title + next_action + context
  - Store in tasks.embedding for future semantic search

STEP 6: Write Back
  - On approval: update Todoist task (title, project, priority, labels, description)
  - Add enriched context as Todoist task comment
  - Update local task status â†’ 'clarified'
  - Log to task_history
```

**Dictate Button:** Uses Whisper for conversational answers to LLM questions. Especially useful for context-heavy responses like "Yeah, it's the same bug from December, the one where the POS system stops syncing after inventory counts. Tell them it's ticket #4521."

**Batch Operations:**
- "Approve All High-Confidence" â€” approves all items with confidence >= 0.8
- Individual approve/edit/skip per item
- Skip moves item back to inbox (won't be re-processed until next session)

### 5.3 Organize

**Purpose:** Manage project health and task filing. Two tabs, two cognitive modes.

#### Tab 1: Projects

**Purpose:** "Are my projects right?" LLM-powered project audit and management.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  ORGANIZE  [Projects] [Filing]                       â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Project Health Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Active (12)  â”‚  Paused (3)  â”‚  Archived (8)    â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  ðŸŸ¢ Analysis Agent       14 tasks   2 days ago   â”‚ â”‚
â”‚  â”‚  ðŸŸ¢ Phishing Triage      8 tasks   1 day ago    â”‚ â”‚
â”‚  â”‚  ðŸŸ¢ RankEngine              6 tasks   3 days ago   â”‚ â”‚
â”‚  â”‚  ðŸŸ¡ Clean Eatz Ops        4 tasks   8 days ago   â”‚ â”‚
â”‚  â”‚  ðŸŸ¡ Homelab               9 tasks  12 days ago   â”‚ â”‚
â”‚  â”‚  ðŸ”´ Italy Trip            2 tasks  28 days ago   â”‚ â”‚
â”‚  â”‚  ðŸ”´ SecureAssist          1 task   35 days ago   â”‚ â”‚
â”‚  â”‚  ...                                             â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  ðŸŸ¢ = active (activity <7 days)                  â”‚ â”‚
â”‚  â”‚  ðŸŸ¡ = cooling (7-14 days)                        â”‚ â”‚
â”‚  â”‚  ðŸ”´ = stale (14+ days) â€” needs decision          â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ LLM Project Audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  [Run Full Audit]                               â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  ðŸ’¬ Recommendations:                            â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  1. "SecureAssist has 1 task and no activity    â”‚  â”‚
â”‚  â”‚     in 35 days. Is this project still active,   â”‚  â”‚
â”‚  â”‚     or should we archive it?"                   â”‚  â”‚
â”‚  â”‚     [Archive] [Keep â€” it's paused] [Merge intoâ€¦]â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  2. "Triage Agent and Analysis Agent    â”‚  â”‚
â”‚  â”‚     seem to be converging. You're Tech Lead on  â”‚  â”‚
â”‚  â”‚     Analysis Agent which is meant to unify the   â”‚  â”‚
â”‚  â”‚     analysis system. Should PTA become a         â”‚  â”‚
â”‚  â”‚     sub-project of Analysis Agent?"              â”‚  â”‚
â”‚  â”‚     [Merge PTA â†’ Analysis Agent] [Keep separate] â”‚  â”‚
â”‚  â”‚     [Tell me more about the difference]         â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  3. "You have 4 tasks mentioning 'golf          â”‚  â”‚
â”‚  â”‚     simulator' but no project for it. Create    â”‚  â”‚
â”‚  â”‚     'Golf Simulator Build' project?"            â”‚  â”‚
â”‚  â”‚     [Create Project] [File under Homelab]       â”‚  â”‚
â”‚  â”‚     [File under Personal]                       â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  ðŸ’¬ Conversation:                               â”‚  â”‚
â”‚  â”‚  [Ask about a project...               ] [ðŸŽ¤]  â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Project Detail (expanded) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚  Analysis Agent                        [Edit]    â”‚ â”‚
â”‚  â”‚  Category: work-primary                            â”‚ â”‚
â”‚  â”‚  Goal: Unified engine for Microsoft's email     â”‚ â”‚
â”‚  â”‚        analysis system                           â”‚ â”‚
â”‚  â”‚  Status: Active      Open tasks: 14             â”‚ â”‚
â”‚  â”‚  Key people: Bob, Alice, Carol, Dan       â”‚ â”‚
â”‚  â”‚  Links: [GitHub] [ADO Board] [Design Doc]       â”‚ â”‚
â”‚  â”‚  Open decisions:                                â”‚ â”‚
â”‚  â”‚    â€¢ Model retraining cadence TBD               â”‚ â”‚
â”‚  â”‚    â€¢ Metrics dashboard scope with Alice        â”‚ â”‚
â”‚  â”‚  LLM Notes: "Highest-priority work project.     â”‚ â”‚
â”‚  â”‚    the user is Tech Lead. Weekly syncs with Bob."  â”‚ â”‚
â”‚  â”‚                                                 â”‚ â”‚
â”‚  â”‚  [Rename] [Archive] [Change Category] [Delete]  â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**LLM Project Audit (Claude Opus â€” uses heavy model):**

```
System prompt:
"""
You are the user's project management advisor. You have deep context on his work
and life. Analyze the full project landscape and identify:

1. STALE PROJECTS: No activity in 14+ days. Recommend: archive, pause, or revive.
2. PROJECT DRIFT: Projects whose tasks don't match their stated goal.
3. MERGE CANDIDATES: Projects with overlapping scope.
4. MISSING PROJECTS: Clusters of tasks that imply a project that doesn't exist.
5. NAMING: Projects with vague or inconsistent names.
6. HEALTH: Projects with 0 next actions (stalled) or 20+ tasks (bloated).

For each recommendation, explain your reasoning and offer 2-3 action options.

Be conversational. Ask clarifying questions when the right action isn't clear.
You're a thoughtful advisor, not a robotic auditor.
"""

Input: Full project registry + all tasks + recent knowledge base entries
Output: Structured recommendations with action buttons + conversation capability
```

**Conversational Dialogue:**
- User can ask questions like "What's the difference between PTA and Analysis Agent?"
- LLM responds using knowledge base context
- Decisions are logged and knowledge base is updated
- "Tell me more" buttons allow drilling into recommendations

#### Tab 2: Filing

**Purpose:** "Are my tasks in the right homes?" Batch task organization.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  ORGANIZE  [Projects] [Filing]                       â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Needs Filing (5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  Tasks missing project, tags, or next actions:  â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  â–¡ "Review Q3 metrics" â€” no project assigned    â”‚  â”‚
â”‚  â”‚    Suggested: [Analysis Agent â–¾] @work           â”‚  â”‚
â”‚  â”‚    [Accept] [Change]                            â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  â–¡ "Buy anniversary gift" â€” no tags             â”‚  â”‚
â”‚  â”‚    Suggested: [Personal â–¾] @errand ðŸŸ¢ low       â”‚  â”‚
â”‚  â”‚    [Accept] [Change]                            â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  â–¡ "Fix Docker networking" â€” wrong project?     â”‚  â”‚
â”‚  â”‚    Currently: Personal  Suggested: [Homelab â–¾]  â”‚  â”‚
â”‚  â”‚    [Move to Homelab] [Keep in Personal]         â”‚  â”‚
â”‚  â”‚                                                 â”‚  â”‚
â”‚  â”‚  [Accept All Suggestions]                       â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Tag Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  Active tags: deep-work(23) work(18) quick-win  â”‚ â”‚
â”‚  â”‚  (12) errand(8) waiting(6) home(4) blocked(3)   â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  âš ï¸ 14 tasks have no tags                       â”‚ â”‚
â”‚  â”‚  âš ï¸ Tag "misc" used 3 times â€” too vague?        â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  [Auto-tag untagged tasks]                       â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Filing LLM (Gemini Flash):**
- Scans all tasks for organizational issues: no project, no tags, wrong project, missing next action
- Suggests corrections based on knowledge base and project context
- "Accept All" batch operation for high-confidence suggestions
- Learns from corrections: if user rejects a suggestion, log the pattern

### 5.4 Engage

**Purpose:** The execution view. Single ranked list. Zero decisions. Just go.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  ENGAGE                        Progress: â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘ 4/7  â”‚
â”‚                                                      â”‚
â”‚  Today â€” Tuesday, Feb 24                             â”‚
â”‚  Committed: 3h 10min  â”‚  Completed: 1h 45min        â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ NEXT UP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  â–º Reply to Alice re: Analysis Agent Metrics    â”‚ â”‚
â”‚  â”‚    Schedule meeting + confirm agenda items       â”‚ â”‚
â”‚  â”‚    ðŸ“ Analysis Agent  â”‚  P1 ðŸŽ¯  â”‚  â±ï¸ 10min  ðŸŸ¢  â”‚ â”‚
â”‚  â”‚    [Complete âœ“]  [Defer â†’]  [Blocked ðŸš«]        â”‚ â”‚
â”‚  â”‚    [ðŸ”¥ Fire Incoming]                            â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â”‚  â”Œâ”€â”€ Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  2. Prep Analysis Agent metrics (Kusto)          â”‚ â”‚
â”‚  â”‚     ðŸ“ Analysis Agent  â”‚  P1 ðŸŽ¯  â”‚  â±ï¸ 30min ðŸ”´  â”‚ â”‚
â”‚  â”‚     [â–¾ context]                                  â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  3. Diagnose Clean Eatz inventory issue          â”‚ â”‚
â”‚  â”‚     ðŸ“ Clean Eatz Ops â”‚  P1 ðŸŽ¯  â”‚  â±ï¸ 30min ðŸŸ¡  â”‚ â”‚
â”‚  â”‚     [â–¾ context]                                  â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  â”€â”€ should do â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  4. Research Wilson Score for RankEngine            â”‚ â”‚
â”‚  â”‚     ðŸ“ RankEngine       â”‚  P2 ðŸ“‹  â”‚  â±ï¸ 45min ðŸ”´  â”‚ â”‚
â”‚  â”‚     [â–¾ context]                                  â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  5. Read Carol's LLM evals paper                 â”‚ â”‚
â”‚  â”‚     ðŸ“ Security Res.  â”‚  P2 ðŸ“‹  â”‚  â±ï¸ 40min ðŸ”´  â”‚ â”‚
â”‚  â”‚     [â–¾ context]                                  â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  6. Book Sara's PMP celebration dinner           â”‚ â”‚
â”‚  â”‚     ðŸ“ Personal       â”‚  P2 ðŸ“‹  â”‚  â±ï¸ 15min ðŸŸ¢  â”‚ â”‚
â”‚  â”‚     [â–¾ context]                                  â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  â”€â”€ this week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  7. Hawaii travel insurance research              â”‚ â”‚
â”‚  â”‚  8. Homelab DNS record update                    â”‚ â”‚
â”‚  â”‚  9. Continue Todoist cleanup                     â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  â”€â”€ waiting / blocked â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â”‚  â³ Phishing model fix â€” waiting on data         â”‚ â”‚
â”‚  â”‚     pipeline team                                â”‚ â”‚
â”‚  â”‚                                                  â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                      â”‚
â”‚  âœ… Completed today                                  â”‚
â”‚  â”œâ”€â”€ âœ“ Morning standup notes                        â”‚
â”‚  â”œâ”€â”€ âœ“ Review PR from Dan                        â”‚
â”‚  â”œâ”€â”€ âœ“ Email vendor re: Clean Eatz freezer          â”‚
â”‚  â””â”€â”€ âœ“ Update Home Assistant config                 â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Task Actions:**
- **Complete âœ“** â†’ marks done in Todoist + local DB, logs to history, moves to "completed today"
- **Defer â†’** â†’ bumps to tomorrow, increments bump_count, logs reason. If bump_count >= 3, triggers anti-pile-up decision.
- **Blocked ðŸš«** â†’ prompts for blocker note, sets status to 'blocked', moves to waiting section
- **ðŸ”¥ Fire Incoming** â†’ opens fire triage modal (see below)

**Fire Triage Modal:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  ðŸ”¥ FIRE TRIAGE                             â”‚
â”‚                                             â”‚
â”‚  What's the fire?                           â”‚
â”‚  [                                   ] [ðŸŽ¤] â”‚
â”‚                                             â”‚
â”‚  Is this truly urgent AND important?        â”‚
â”‚  â—‹ Yes â€” drop everything (P0)               â”‚
â”‚  â—‹ Urgent but not critical â€” slot it in     â”‚
â”‚  â—‹ Important but not urgent â€” plan for it   â”‚
â”‚  â—‹ Neither â€” inbox for tomorrow             â”‚
â”‚                                             â”‚
â”‚  If P0: What gets bumped?                   â”‚
â”‚  System suggests bumping lowest P2.         â”‚
â”‚  Current lowest P2: "Book Sara's dinner"    â”‚
â”‚                                             â”‚
â”‚  [Insert Fire + Bump]  [Cancel]             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Anti-Pile-Up Modal (triggered at bump_count >= 3):**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  âš ï¸ ANTI-PILE-UP CHECK                     â”‚
â”‚                                             â”‚
â”‚  "Hawaii travel insurance research" has been â”‚
â”‚  bumped 3 times. Decision time:             â”‚
â”‚                                             â”‚
â”‚  â—‹ Do it now â€” promote to P1 today          â”‚
â”‚  â—‹ Delegate it â€” who should handle this?    â”‚
â”‚  â—‹ Kill it â€” it's not actually important    â”‚
â”‚  â—‹ Hard schedule â€” pick a specific date     â”‚
â”‚    [Date picker: ________]                  â”‚
â”‚                                             â”‚
â”‚  [Decide]                                   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Ranking Algorithm:**

```
STEP 1: Tier Assignment
  P0: status == 'fire' (manually flagged via triage)
  P1: due_date == today OR user_flagged_p1 OR highest_leverage_for_top_priority
  P2: active_project_task AND meaningful_progress AND no_hard_deadline_today
  P3: important_but_flexible OR will_become_p2_later_this_week
  P4: someday_maybe OR low_urgency OR waiting_on_external

STEP 2: Intra-Tier Ranking (LLM call, Gemini Flash)
  For each tier with 2+ tasks, call LLM with:
  - Task list for this tier
  - Current time of day
  - Energy pattern knowledge ("the user does deep work in mornings")
  - Dependencies between tasks
  - Momentum signals ("the user just finished a RankEngine task")
  - Meeting schedule for today (if available)

  LLM returns ordered list with brief reasoning.

STEP 3: Display
  Single flat list: P0 â†’ P1 â†’ P2 â†’ P3 dividers
  P4 and waiting/blocked in collapsed sections
  "NEXT UP" card highlights item #1
```

### 5.5 Reflect

**Purpose:** Close the loop. Learn from the day/week. Feed the knowledge base.

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  REFLECT                    [Daily] [Weekly]         â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Daily Close-Out: Tuesday, Feb 24 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚                                                      â”‚
â”‚  ðŸ“Š Stats                                            â”‚
â”‚  Planned: 7  â”‚  Completed: 5  â”‚  Rate: 71%          â”‚
â”‚  Fires: 0    â”‚  Bumped: 2     â”‚  Blocked: 0         â”‚
â”‚                                                      â”‚
â”‚  âœ… Completed                                        â”‚
â”‚  â”œâ”€â”€ Reply to Alice re: Analysis Agent metrics       â”‚
â”‚  â”œâ”€â”€ Prep Analysis Agent metrics (Kusto)              â”‚
â”‚  â”œâ”€â”€ Diagnose Clean Eatz inventory issue             â”‚
â”‚  â”œâ”€â”€ Book Sara's PMP celebration dinner              â”‚
â”‚  â””â”€â”€ Morning standup notes                           â”‚
â”‚                                                      â”‚
â”‚  â­ï¸ Didn't Complete                                  â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”‚
â”‚  â”‚  "Research Wilson Score for RankEngine"         â”‚    â”‚
â”‚  â”‚  â—‹ Bump to tomorrow (was: P2)                â”‚    â”‚
â”‚  â”‚  â—‹ Blocked â€” what's blocking?                â”‚    â”‚
â”‚  â”‚  â—‹ Kill â€” not worth doing                    â”‚    â”‚
â”‚  â”‚  â—‹ Reschedule to: [______]                   â”‚    â”‚
â”‚  â”‚  Note: [                              ] [ðŸŽ¤] â”‚    â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”‚
â”‚  â”‚  "Read Carol's LLM evals paper"              â”‚    â”‚
â”‚  â”‚  â—‹ Bump to tomorrow  â—‹ Block  â—‹ Kill  â—‹ Schedâ”‚    â”‚
â”‚  â”‚  Note: [                              ]      â”‚    â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚
â”‚                                                      â”‚
â”‚  ðŸ’­ Anything else on your mind?                      â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”‚
â”‚  â”‚ [                                      ] [ðŸŽ¤]â”‚    â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚
â”‚                                                      â”‚
â”‚  ðŸŒ… Tomorrow Seed                                    â”‚
â”‚  LLM suggests pre-flagging:                          â”‚
â”‚  â˜‘ Wilson Score research (bumped, should prioritize) â”‚
â”‚  â˜‘ Carol's paper (bumped, pair with deep-work AM)    â”‚
â”‚  â˜ Follow up on Clean Eatz vendor response           â”‚
â”‚                                                      â”‚
â”‚  ðŸ¤– LLM Observations                                â”‚
â”‚  "You completed all P1s today â€” strong execution.    â”‚
â”‚   Both bumped items were ðŸ”´ high-energy deep-work.   â”‚
â”‚   Consider scheduling these for your morning block   â”‚
â”‚   tomorrow when energy is highest."                  â”‚
â”‚                                                      â”‚
â”‚  [Save & Close Day]                                  â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Weekly Review: Week of Feb 17 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚  (collapsed â€” expand to run weekly review)           â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Daily Close-Out Flow:**
1. Auto-populated from Todoist completions + local state
2. User handles each incomplete task (bump/block/kill/reschedule)
3. Optional free capture (text or voice)
4. LLM generates tomorrow seed + observations
5. All data saved to daily_reviews table
6. Knowledge base updated with patterns

**Weekly Review (Claude Opus â€” uses heavy model):**
```
Inputs:
  - All daily_reviews for the week
  - Full project registry
  - task_history for the week
  - Knowledge base

LLM generates:
  1. Completion trend analysis
  2. Fire frequency and patterns
  3. Anti-pile-up triggers (tasks bumped 3+ across the week)
  4. Project velocity (which projects moved, which stalled)
  5. Pattern observations ("You defer homelab tasks on Mondays")
  6. Priority recalibration prompt
  7. Recommendations for next week

User reviews, adds notes, confirms priority changes.
Saves to weekly_reviews table.
```

### 5.6 Knowledge Base

**Purpose:** Transparent, editable view of everything the system "knows."

**Layout:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  KNOWLEDGE BASE                       [+ Add Entry]  â”‚
â”‚                                                      â”‚
â”‚  [Identity] [People] [Priorities] [Patterns]         â”‚
â”‚  [Preferences] [Decisions] [All]                     â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ People (8 entries) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚                                                      â”‚
â”‚  Bob                                    [Edit] [Ã—] â”‚
â”‚  Manager at Microsoft Security Research              â”‚
â”‚  Works with the user on: Analysis Agent, PTA              â”‚
â”‚  Notes: Weekly 1:1s. Escalation point for fires.     â”‚
â”‚  Last referenced: 2 days ago                         â”‚
â”‚                                                      â”‚
â”‚  Alice Friedrich                         [Edit] [Ã—] â”‚
â”‚  Collaborator at Microsoft                           â”‚
â”‚  Works with the user on: Analysis Agent metrics           â”‚
â”‚  Notes: Wants metrics review meeting. Detail-        â”‚
â”‚  oriented, prefers data-backed proposals.            â”‚
â”‚  Last referenced: today                              â”‚
â”‚                                                      â”‚
â”‚  Sara                                     [Edit] [Ã—] â”‚
â”‚  Wife. Project manager at SNMMI. Recently earned     â”‚
â”‚  PMP certification.                                  â”‚
â”‚  Last referenced: today                              â”‚
â”‚                                                      â”‚
â”‚  ...                                                 â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Patterns (12 entries) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚                                                      â”‚
â”‚  "the user defers deep-work tasks on meeting-heavy days" â”‚
â”‚  Confidence: 0.85  â”‚  Source: reflect_analysis       â”‚
â”‚  Referenced: 8 times                     [Edit] [Ã—]  â”‚
â”‚                                                      â”‚
â”‚  "When the user says 'that thing' about RankEngine, he     â”‚
â”‚  usually means the ranking algorithm, not the UI"    â”‚
â”‚  Confidence: 0.92  â”‚  Source: clarify_session        â”‚
â”‚  Referenced: 3 times                     [Edit] [Ã—]  â”‚
â”‚                                                      â”‚
â”‚  ...                                                 â”‚
â”‚                                                      â”‚
â”‚  ðŸ“Š Knowledge Stats                                  â”‚
â”‚  Total entries: 47  â”‚  Avg confidence: 0.84          â”‚
â”‚  Most referenced: "the user prefers morning deep work"   â”‚
â”‚  Last updated: 2 hours ago                           â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Behaviors:**
- Full CRUD on all entries
- Confidence scores visible (user can correct low-confidence entries)
- Source tracking (where each fact was learned)
- Usage tracking (how often each entry is referenced by the LLM)
- Search across all entries
- Category filtering

### 5.7 Settings

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  SETTINGS                                            â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ API Keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  Todoist API Token: [â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢] [Test]        â”‚
â”‚  Gemini API Key:    [â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢] [Test]        â”‚
â”‚  Anthropic API Key: [â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢] [Test]        â”‚
â”‚  OpenAI API Key:    [â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢] [Test]        â”‚
â”‚  (Whisper only)                                      â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  Mode: On-demand (sync on page load)                 â”‚
â”‚  Last sync: 2 minutes ago                            â”‚
â”‚  [Force Full Sync]                                   â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  [Change Password]                                   â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ LLM Preferences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€     â”‚
â”‚  Primary model: Gemini 2.5 Flash                     â”‚
â”‚  Heavy model: Claude Opus (for audits/reviews)       â”‚
â”‚  Auto-approve threshold: 0.8 confidence              â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Task Formatting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  Default labels: [deep-work, quick-win, waiting,     â”‚
â”‚                   errand, home, work, personal]       â”‚
â”‚  Priority levels: P0-P4 (P0 = fire)                 â”‚
â”‚  Time estimate rounding: 5-minute increments         â”‚
â”‚                                                      â”‚
â”‚  â”€â”€ Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  [Export Knowledge Base]                             â”‚
â”‚  [Export Task History]                                â”‚
â”‚  [Reset Knowledge Base] âš ï¸                           â”‚
â”‚                                                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 6. The Knowledge System

The knowledge system is the core differentiator. It's what makes day 30 better than day 1.

### Design Principles

1. **Learn well:** Every LLM interaction is an opportunity to record information. Clarify learns task patterns. Organize learns project structure. Reflect learns productivity patterns. The system has many surfaces for knowledge capture.

2. **Use effectively:** Knowledge is injected into LLM prompts as relevant context, not dumped wholesale. A task mentioning "Alice" gets Alice's people entry. A RankEngine task gets the RankEngine project entry + related decisions. Relevance matching is keyword-based in v1, vector-based in v2+.

3. **Room to grow:** The schema is intentionally flexible. `knowledge_entries` is a key-value store with categories, not a rigid set of typed tables. New categories can be added without migrations. Vector embeddings are stored from day 1, ready for semantic search when we build on them.

### Knowledge Capture Surfaces

| Surface | What it Learns | How |
|---|---|---|
| **Clarify** | Task patterns, people references, project associations, decomposition templates | After each clarification, LLM extracts new facts. If the user corrects a clarification, the correction is recorded as a preference. |
| **Organize (Projects)** | Project relationships, naming conventions, merge/split decisions, project goals | Every project audit decision is logged. LLM observations about project health are stored. |
| **Organize (Filing)** | Tag usage patterns, project assignment tendencies, organizational preferences | When user overrides a suggestion, the override pattern is recorded. |
| **Engage** | Completion patterns, deferral patterns, fire frequency, time estimation accuracy | Every complete/defer/block action is logged with timestamp. |
| **Reflect** | Productivity patterns, energy patterns, blocker patterns, priority drift | Daily and weekly reviews generate LLM observations that become knowledge entries. |
| **Knowledge Base (direct)** | Anything user explicitly adds or corrects | User CRUD operations on knowledge entries. |

### Knowledge Injection (Context Building)

When the LLM processes a task or generates a recommendation, it receives a curated slice of the knowledge base:

```typescript
async function buildContext(input: string, page: PageType): Promise<string> {
  const context: string[] = [];

  // Always include: identity, current priorities, active project list
  context.push(await getIdentityContext());
  context.push(await getCurrentPriorities());
  context.push(await getActiveProjectSummary());

  // Keyword-based relevance matching
  const mentionedPeople = await matchPeople(input);
  if (mentionedPeople.length) {
    context.push(await getPeopleContext(mentionedPeople));
  }

  const mentionedProjects = await matchProjects(input);
  if (mentionedProjects.length) {
    context.push(await getProjectContext(mentionedProjects));
  }

  // Page-specific context
  if (page === 'clarify') {
    context.push(await getTaskPatterns());
    context.push(await getDecompositionTemplates());
    context.push(await getFormattingPreferences());
  }

  if (page === 'organize') {
    context.push(await getProjectRelationships());
    context.push(await getOrganizationalPreferences());
  }

  if (page === 'engage') {
    context.push(await getEnergyPatterns());
    context.push(await getDeferralPatterns());
    context.push(await getTodaySchedule());
  }

  if (page === 'reflect') {
    context.push(await getRecentDailyReviews(7)); // Last 7 days
    context.push(await getCompletionTrends());
    context.push(await getAntiPileupTriggers());
  }

  return context.join('\n\n');
}
```

### Knowledge Extraction (Post-LLM Processing)

After every LLM interaction, a lightweight extraction pass identifies new knowledge:

```typescript
async function extractKnowledge(
  input: string,
  output: LLMOutput,
  page: PageType
): Promise<void> {
  // Use Gemini Flash for cheap, fast extraction
  const extraction = await geminiFlash.generate({
    system: `You are a knowledge extraction agent. Given a task processing
             interaction, identify any NEW facts worth remembering.

             Categories: identity, preference, pattern, priority, schedule,
             decision, fact, workflow

             Only extract information that would be useful for future
             task processing. Be selective â€” quality over quantity.

             Return JSON array of {category, key, value, confidence}
             or empty array if nothing new.`,
    input: `Page: ${page}\nUser input: ${input}\nSystem output: ${JSON.stringify(output)}`
  });

  for (const entry of extraction) {
    // Check for duplicates or conflicts with existing knowledge
    const existing = await findSimilarKnowledge(entry.key);
    if (existing) {
      // Update existing entry if new info is higher confidence
      await mergeKnowledgeEntry(existing, entry);
    } else {
      await createKnowledgeEntry(entry);
    }
  }
}
```

---

## 7. LLM Integration Architecture

### Model Routing

```typescript
type LLMTask = {
  page: PageType;
  operation: string;
  complexity: 'low' | 'medium' | 'high';
};

function routeToModel(task: LLMTask): 'gemini-flash' | 'claude-opus' {
  // Claude Opus (heavy): complex reasoning, multi-factor analysis
  const opusTasks = [
    'project_audit',           // Full project landscape analysis
    'weekly_review_synthesis',  // Pattern analysis across 7 days
    'complex_decomposition',    // Ambiguous tasks needing deep understanding
    'priority_recalibration',   // Cross-project priority assessment
    'conflict_resolution',      // When projects/priorities conflict
  ];

  if (opusTasks.includes(task.operation)) return 'claude-opus';

  // Gemini Flash (fast): everything else
  return 'gemini-flash';
}
```

### Model Usage Map

| Operation | Model | Frequency | Est. Cost/Day |
|---|---|---|---|
| Task clarification (per task) | Gemini Flash | 8-15x/day | ~$0.01 |
| Task formatting/enrichment | Gemini Flash | 8-15x/day | ~$0.005 |
| Knowledge extraction | Gemini Flash | 8-15x/day | ~$0.005 |
| Filing suggestions | Gemini Flash | 1x/day | ~$0.002 |
| Intra-tier ranking | Gemini Flash | 1-3x/day | ~$0.003 |
| Voice task extraction | Gemini Flash | 1-2x/day | ~$0.002 |
| Fire triage | Gemini Flash | 0-2x/day | ~$0.001 |
| Daily reflect observations | Gemini Flash | 1x/day | ~$0.003 |
| Project audit | Claude Opus | 1x/week | ~$0.15 |
| Weekly review synthesis | Claude Opus | 1x/week | ~$0.10 |
| Complex decomposition | Claude Opus | 0-2x/week | ~$0.05 |
| **Total estimated daily** | | | **~$0.03-0.05** |
| **Total estimated monthly** | | | **~$1.50-2.00** |

### Streaming Architecture

Clarify and Organize use streaming responses for LLM output, so the user sees the AI "thinking" in real-time:

```typescript
// Server Action with streaming
async function* clarifyTask(taskId: string) {
  const task = await getTask(taskId);
  const context = await buildContext(task.original_text, 'clarify');

  const stream = geminiFlash.streamGenerate({
    system: CLARIFY_SYSTEM_PROMPT,
    context: context,
    input: task.original_text,
  });

  for await (const chunk of stream) {
    yield chunk; // Streamed to client via React Server Components
  }
}
```

---

## 8. Todoist Sync Layer

### Sync Strategy: On-Demand

- **Page load:** Pull relevant data from Todoist API
- **Action:** Write changes back immediately
- **No polling, no webhooks** (deferred to v2)

### API Operations Map

| App Action | Todoist API | Direction |
|---|---|---|
| Load inbox | `GET /tasks?project_id={inbox_id}` | Pull |
| Load all tasks | `GET /tasks` | Pull |
| Load all projects | `GET /projects` | Pull |
| Load all labels | `GET /labels` | Pull |
| Create task (quick add) | `POST /tasks` | Push |
| Update task (clarify/organize) | `POST /tasks/{id}` | Push |
| Complete task | `POST /tasks/{id}/close` | Push |
| Add task comment (context) | `POST /comments` | Push |
| Create project | `POST /projects` | Push |
| Update project | `POST /projects/{id}` | Push |
| Archive project | `POST /projects/{id}` (is_archived) | Push |
| Create label | `POST /labels` | Push |

### Sync Architecture

```typescript
class TodoistSync {
  private apiToken: string;

  // Pull: Todoist â†’ Local DB
  async syncInbox(): Promise<Task[]> {
    const inboxProject = await this.getInboxProject();
    const tasks = await this.api.getTasks({ project_id: inboxProject.id });

    for (const task of tasks) {
      await upsertLocalTask({
        todoist_id: task.id,
        original_text: task.content,
        title: task.content,
        status: 'inbox',
        due_date: task.due?.date,
        priority: mapTodoistPriority(task.priority),
        is_recurring: !!task.due?.recurring,
        recurrence_rule: task.due?.string,
        todoist_synced_at: new Date().toISOString(),
      });
    }

    return tasks;
  }

  // Push: Local DB â†’ Todoist
  async pushTaskUpdate(localTask: LocalTask): Promise<void> {
    if (!localTask.todoist_id) return;

    await this.api.updateTask(localTask.todoist_id, {
      content: localTask.title,
      description: localTask.next_action,
      project_id: localTask.project?.todoist_id,
      priority: mapToTodoistPriority(localTask.priority),
      labels: localTask.labels,
      due_date: localTask.due_date,
    });

    // Add enriched context as a comment
    if (localTask.context_notes) {
      await this.api.addComment({
        task_id: localTask.todoist_id,
        content: formatContextComment(localTask),
      });
    }

    await updateSyncTimestamp(localTask.id);
  }

  // Conflict resolution: Todoist wins for content, local wins for enrichment
  async resolveConflict(local: LocalTask, remote: TodoistTask): Promise<void> {
    if (remote.updated_at > local.todoist_synced_at) {
      // Todoist was modified externally â€” merge
      await mergeExternalChanges(local, remote);
    }
  }
}
```

### Todoist Priority Mapping

Todoist uses inverted priority (4 = highest). We normalize:

```typescript
function mapTodoistPriority(todoistPriority: number): number {
  // Todoist: 1=no priority, 2=low, 3=medium, 4=high
  // Ours: 0=fire, 1=must, 2=should, 3=this week, 4=backlog
  const map: Record<number, number> = {
    4: 1, // Todoist "high" â†’ our P1
    3: 2, // Todoist "medium" â†’ our P2
    2: 3, // Todoist "low" â†’ our P3
    1: 4, // Todoist "none" â†’ our P4
  };
  return map[todoistPriority] ?? 4;
}
```

---

## 9. Prioritization Engine

### Tier Assignment (Rule-Based + LLM)

```typescript
async function assignPriority(task: Task): Promise<number> {
  // Hard rules first
  if (task.status === 'fire') return 0;
  if (task.due_date === today() && !task.blocker_note) return 1;
  if (task.bump_count >= 3) return 1; // Anti-pile-up promotion

  // LLM-assisted assignment for remaining tasks
  const context = await buildContext(task.title + ' ' + task.next_action, 'engage');

  const result = await geminiFlash.generate({
    system: `Assign priority P1-P4 to this task.

             Current top priorities this week:
             {weekly_priorities}

             Rules:
             P1: Hard deadline today, or highest-leverage for current top goal
             P2: Moves active project forward, no hard deadline but real value
             P3: Important but flexible timing, will become P2 later this week
             P4: Someday/maybe, low urgency, or waiting on external

             Return: { priority: 1-4, reasoning: "..." }`,
    input: `Task: ${task.title}\nProject: ${task.project?.name}\nDue: ${task.due_date}`,
    context: context,
  });

  return result.priority;
}
```

### Intra-Tier Ranking (LLM)

```typescript
async function rankWithinTier(tasks: Task[], tier: number): Promise<Task[]> {
  if (tasks.length <= 1) return tasks;

  const context = await buildContext('', 'engage');
  const currentHour = new Date().getHours();

  const result = await geminiFlash.generate({
    system: `Rank these ${tasks.length} P${tier} tasks in optimal execution order.

             Consider:
             - Current time: ${currentHour}:00
             - Dependencies between tasks
             - Energy matching (morning = high energy, afternoon = declining)
             - Time estimates (mix of long and short)
             - Momentum (group related project tasks)
             - Quick wins as palate cleansers between deep work

             Return ordered array of task IDs with brief reasoning.`,
    input: JSON.stringify(tasks.map(t => ({
      id: t.id,
      title: t.title,
      project: t.project?.name,
      time_estimate: t.time_estimate_min,
      energy: t.energy_level,
      labels: t.labels,
    }))),
    context: context,
  });

  return reorderTasks(tasks, result.ordered_ids);
}
```

### Fire Protocol

```typescript
async function handleFire(fireDescription: string): Promise<FireResult> {
  // 1. Create the fire task
  const fireTask = await createTask({
    original_text: fireDescription,
    status: 'active',
    priority: 0,
  });

  // 2. Clarify it immediately (fast path)
  const clarified = await clarifyTask(fireTask.id, { express: true });

  // 3. Find what to bump
  const todayP2Tasks = await getTasksByPriorityAndDate(2, today());
  const lowestP2 = todayP2Tasks[todayP2Tasks.length - 1];

  // 4. Bump the lowest P2
  if (lowestP2) {
    await bumpTask(lowestP2.id, {
      reason: `Bumped due to fire: ${clarified.title}`,
      new_date: tomorrow(),
    });
  }

  // 5. Log the fire
  await logTaskHistory(fireTask.id, 'fire_promoted', {
    bumped_task_id: lowestP2?.id,
    bumped_task_title: lowestP2?.title,
  });

  return { fireTask: clarified, bumpedTask: lowestP2 };
}
```

---

## 10. Voice Capture System

### Architecture

```
[Browser Mic] â†’ [MediaRecorder API] â†’ [WebM/Opus blob]
    â†’ [Server Action] â†’ [Whisper API] â†’ [Transcript]
    â†’ [Gemini Flash: Task Extraction] â†’ [Task List]
    â†’ [User Review] â†’ [Todoist Inbox]
```

### Implementation

```typescript
// Client-side: recording
async function startVoiceCapture(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();

  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
  });
}

// Server Action: transcription + extraction
async function processVoiceDump(audioBlob: Blob): Promise<ExtractedTask[]> {
  // 1. Transcribe with Whisper
  const transcript = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file: audioBlob,
    language: 'en',
  });

  // 2. Extract tasks with Gemini Flash
  const extraction = await geminiFlash.generate({
    system: `You are a task extraction agent. The user has done a "brain dump"
             via voice. Extract every discrete actionable task from the transcript.

             Rules:
             - Each task should be a separate item
             - Preserve the user's intent and language
             - Don't add tasks the user didn't mention
             - If something is context/commentary (not a task), skip it
             - Return JSON array of { text: string, confidence: number }`,
    input: transcript.text,
  });

  return extraction;
}
```

### Dictate Button (for Clarify question answers)

Same recording mechanism, but the transcript is used as inline text input rather than task extraction. Whisper output goes directly into the answer field.

---

## 11. Vector Embedding Pipeline

### Strategy

Capture embeddings from day 1. Store them alongside tasks and knowledge entries. Don't build features on top yet â€” let the data accumulate so v2 features have a rich corpus to work with.

### Implementation

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateEmbedding(text: string): Promise<Float32Array> {
  const model = genai.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return new Float32Array(result.embedding.values);
}

// Called after task clarification
async function embedTask(task: Task): Promise<void> {
  const embeddingText = [
    task.title,
    task.next_action,
    task.context_notes,
    task.project?.name,
  ].filter(Boolean).join(' | ');

  const embedding = await generateEmbedding(embeddingText);

  await db.update(tasks)
    .set({
      embedding: Buffer.from(embedding.buffer),
      embedding_text: embeddingText,
    })
    .where(eq(tasks.id, task.id));
}

// Called after knowledge entry creation/update
async function embedKnowledgeEntry(entry: KnowledgeEntry): Promise<void> {
  const embeddingText = `${entry.category}: ${entry.key} â€” ${entry.value}`;
  const embedding = await generateEmbedding(embeddingText);

  await db.update(knowledgeEntries)
    .set({
      embedding: Buffer.from(embedding.buffer),
      embedding_text: embeddingText,
    })
    .where(eq(knowledgeEntries.id, entry.id));
}
```

### What Embeddings Enable (v2)

- **Semantic task search:** "Find everything related to API security" â€” not keyword matching, meaning matching
- **Project cluster detection:** Tasks naturally cluster in vector space â†’ suggest new projects
- **Duplicate detection:** New captures that are semantically similar to existing tasks
- **Biannual review search:** "Show me everything I shipped related to phishing detection in H1"
- **Similar task lookup:** "Have I done something like this before? What happened?"

### Storage

Embeddings stored as BLOB in Turso (768-dim float32 = 3,072 bytes per embedding). At 500 tasks + 200 knowledge entries, total embedding storage is ~2MB. Trivial.

For v2 similarity search, options include:
- Turso's vector similarity extension (if available)
- Application-level cosine similarity (fine for <5,000 vectors)
- External vector DB (Pinecone/Chroma) if scale demands it

---

## 12. Auth & Security

### Single-User Password Auth

```typescript
// Environment variables
// APP_PASSWORD_HASH = bcrypt hash of chosen password
// SESSION_SECRET = random 32-byte hex string

// Login: POST /api/auth/login
async function login(password: string): Promise<Session> {
  const valid = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH);
  if (!valid) throw new AuthError('Invalid password');

  const session = await ironSession.getSession();
  session.authenticated = true;
  session.loginAt = new Date().toISOString();
  await session.save();

  return session;
}

// Middleware: protect all routes
export async function middleware(request: NextRequest) {
  const session = await getSession();
  if (!session.authenticated && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}
```

### API Key Security

- All API keys stored as environment variables (Vercel encrypted)
- Never exposed to client-side code
- All external API calls happen in Server Actions / API routes
- Todoist token, Gemini key, Anthropic key, OpenAI key â€” all server-only

---

## 13. Deployment

### Vercel Configuration

```
vercel.json:
{
  "framework": "nextjs",
  "regions": ["iad1"],         // US East (closest to Mechanicsville, VA)
  "env": {
    "APP_PASSWORD_HASH": "@app-password-hash",
    "SESSION_SECRET": "@session-secret",
    "TODOIST_API_TOKEN": "@todoist-api-token",
    "GEMINI_API_KEY": "@gemini-api-key",
    "ANTHROPIC_API_KEY": "@anthropic-api-key",
    "OPENAI_API_KEY": "@openai-api-key",
    "TURSO_DATABASE_URL": "@turso-database-url",
    "TURSO_AUTH_TOKEN": "@turso-auth-token"
  }
}
```

### Turso Setup

```bash
# Create database
turso db create burn-down-engine --location iad

# Get credentials
turso db show burn-down-engine --url
turso db tokens create burn-down-engine
```

### Estimated Monthly Costs

| Service | Tier | Cost |
|---|---|---|
| Vercel | Hobby (free) or Pro ($20) | $0â€“$20 |
| Turso | Free tier (500 DBs, 9GB) | $0 |
| Gemini Flash | ~1,500 requests/month | ~$0.50 |
| Claude Opus | ~10 requests/month | ~$1.00 |
| Whisper | ~30 minutes/month | ~$0.18 |
| Gemini Embeddings | ~2,000 embeddings/month | Free tier |
| **Total** | | **~$1.68â€“$21.68** |

---

## 14. Build Plan & Milestones

### Phase 1: Foundation (Week 1)

**Goal:** App shell with auth, DB, Todoist sync, and Inbox page.

```
Day 1-2:
  â–¡ Next.js project setup (App Router, Tailwind, shadcn/ui)
  â–¡ Turso + Drizzle schema (all tables from spec)
  â–¡ Auth (password login, session middleware)
  â–¡ Layout shell (nav bar with page links, badges)

Day 3-4:
  â–¡ Todoist sync layer (read: inbox, tasks, projects, labels)
  â–¡ Todoist write layer (create, update, complete, comment)
  â–¡ Settings page (API key management, sync controls)

Day 5:
  â–¡ Inbox page (display unprocessed items, quick-add bar)
  â–¡ Badge count system
  â–¡ Manual "force sync" button
```

### Phase 2: Clarify â€” The Core Engine (Week 2)

**Goal:** LLM-powered task processing pipeline.

```
Day 6-7:
  â–¡ Gemini Flash integration (SDK, streaming, error handling)
  â–¡ Context builder (knowledge injection system)
  â–¡ Clarify processing pipeline (single task â†’ clarified output)

Day 8-9:
  â–¡ Clarify page UI (batch view, expand detail, approve/edit)
  â–¡ Question queue (LLM asks, user answers)
  â–¡ Batch approve for high-confidence items
  â–¡ Todoist write-back on approval

Day 10:
  â–¡ Knowledge extraction pipeline (post-clarification learning)
  â–¡ Embedding pipeline (generate + store on clarify)
  â–¡ Task history logging
```

### Phase 3: Organize + Engage (Week 3)

**Goal:** Project management and execution view.

```
Day 11-12:
  â–¡ Organize: Projects tab (health dashboard, project detail)
  â–¡ Claude Opus integration for project audit
  â–¡ Project CRUD (create, rename, archive, delete â†’ Todoist)

Day 13:
  â–¡ Organize: Filing tab (unorganized tasks, suggestions, batch assign)
  â–¡ Tag management

Day 14-15:
  â–¡ Engage page (ranked list, NEXT UP card)
  â–¡ Prioritization engine (tier assignment + intra-tier ranking)
  â–¡ Task actions (complete, defer, block, fire triage)
  â–¡ Fire protocol + anti-pile-up system
  â–¡ Progress bar
```

### Phase 4: Reflect + Voice + Polish (Week 4)

**Goal:** Close the loop. Voice capture. Production-ready.

```
Day 16-17:
  â–¡ Reflect: Daily close-out (auto-populated, bump/block/kill, seed)
  â–¡ Reflect: LLM observations (Gemini Flash)
  â–¡ Daily review storage + history

Day 18:
  â–¡ Whisper integration (voice dump on Inbox)
  â–¡ Dictate buttons (Clarify question answers)
  â–¡ Task extraction from voice transcript

Day 19:
  â–¡ Knowledge Base page (CRUD, filtering, search, stats)
  â–¡ Reflect: Weekly review (Claude Opus synthesis)

Day 20:
  â–¡ Polish: Loading states, error handling, edge cases
  â–¡ Polish: Mobile responsiveness (will use on phone)
  â–¡ Deploy to Vercel
  â–¡ End-to-end testing with real Todoist data
```

### Phase 5: Iterate (Week 5+)

```
  â–¡ Real-world usage for 1 week
  â–¡ Tune LLM prompts based on actual performance
  â–¡ Adjust confidence thresholds
  â–¡ Fix sync edge cases
  â–¡ Knowledge base quality review
  â–¡ Performance optimization
```

---

## 15. v2 Roadmap

Ordered by expected impact:

1. **Vector-powered semantic search** â€” "Find everything related to phishing detection" across all tasks, knowledge, and history. Powers the biannual review report generator.

2. **Todoist webhooks** â€” Real-time sync instead of on-demand. Tasks completed on mobile show up instantly in Engage.

3. **Project cluster emergence** â€” Analyze task embedding clusters to suggest new projects or project reorganization.

4. **Biannual review generator** â€” "Generate my H1 2026 accomplishments report" using task history, completion data, fire logs, and semantic search.

5. **Energy/schedule-aware ranking** â€” Integrate calendar data. Know when the user has meetings. Rank tasks around availability windows.

6. **Notification system** â€” Morning plan push notification. "3 items need clarifying" nudge. Fire alerts.

7. **Multi-device optimized views** â€” Dedicated mobile layout for Engage (card-swipe completion).

8. **Recurring task intelligence** â€” Learn which recurring tasks the user always skips vs. always does. Adjust frequency suggestions.

9. **Natural language task query** â€” "What did I work on last Tuesday?" "How many fires did I handle in January?"

10. **Collaborative features** â€” If relevant: share project status, delegate tasks (probably not needed for personal system).

---

## Appendix A: LLM System Prompts

### Clarify System Prompt (Gemini Flash)

```
You are the Burn-Down Engine's Clarify agent. Your job is to transform messy,
incomplete task captures into perfectly formatted GTD next actions.

## About the User
{identity_context}

## Active Projects
{project_registry}

## Known People
{people_context}

## Task Patterns
{task_patterns}

## Formatting Rules
- Title: Capitalized, clear, professional. No abbreviations unless universally understood.
- Next Action: Starts with a specific verb. Concrete enough to execute without further thinking.
  Good: "Pull Q3 phishing false positive rates from Kusto and draft summary slide"
  Bad: "Work on phishing metrics"
- Always include: project assignment, priority (P1-P4 with reasoning), labels,
  time estimate (minutes), energy level (high/medium/low)
- If a task references a person, include them in related_people
- If a task implies links or documents, note them in context_notes
- If a task is too big for a single action (>2 hours or multiple distinct steps),
  decompose into 2-5 subtasks

## Confidence Guidelines
- 0.9+: You're very sure about everything. Auto-approve candidate.
- 0.7-0.89: Mostly sure but one field is a guess. Flag for review.
- 0.5-0.69: Need clarification on something specific. Ask a question.
- <0.5: Too vague to process. Ask the user what they meant.

## Question Format
When you need to ask, be specific:
- Bad: "Can you clarify this task?"
- Good: "This mentions 'the bayesian thing' â€” are you referring to the RankEngine
  ranking algorithm or the anomaly detection model in PTA?"

Return structured JSON matching the task schema.
```

### Organize Audit System Prompt (Claude Opus)

```
You are the Burn-Down Engine's Organize advisor. You're the user's project
management consultant. Be thoughtful, conversational, and opinionated.

## About the user
{identity_context}

## Full Project Registry
{all_projects_with_tasks}

## Recent Task History
{recent_task_history}

## Known Organizational Preferences
{organizational_preferences}

## Your Job
Analyze the full project landscape and provide specific, actionable recommendations.

Look for:
1. STALE: Projects with no activity in 14+ days. Why? Should they be archived,
   paused, or revived?
2. BLOATED: Projects with 15+ tasks. Should they be split?
3. EMPTY: Projects with 0 next actions. Stalled or complete?
4. OVERLAPPING: Projects with similar scope. Merge candidates?
5. MISSING: Task clusters that imply a project doesn't exist yet.
6. NAMING: Vague or inconsistent project names.
7. ORPHANS: Tasks assigned to projects they don't belong in.

For each recommendation:
- Explain your reasoning conversationally
- Offer 2-3 action options
- Note what you're unsure about and would ask the user

Be direct. If a project should die, say so. If two projects should merge,
make the case. the user appreciates decisiveness.
```

---

## Appendix B: Directory Structure

```
burn-down-engine/
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ app/
â”‚   â”‚   â”œâ”€â”€ layout.tsx                 # Root layout with nav
â”‚   â”‚   â”œâ”€â”€ page.tsx                   # Redirect to /inbox or /engage
â”‚   â”‚   â”œâ”€â”€ login/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Password login
â”‚   â”‚   â”œâ”€â”€ inbox/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Inbox view + voice dump
â”‚   â”‚   â”œâ”€â”€ clarify/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Clarify processing pipeline
â”‚   â”‚   â”œâ”€â”€ organize/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Projects + Filing tabs
â”‚   â”‚   â”œâ”€â”€ engage/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Ranked action list
â”‚   â”‚   â”œâ”€â”€ reflect/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Daily + weekly review
â”‚   â”‚   â”œâ”€â”€ knowledge/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Knowledge base CRUD
â”‚   â”‚   â”œâ”€â”€ settings/
â”‚   â”‚   â”‚   â””â”€â”€ page.tsx               # Config + API keys
â”‚   â”‚   â””â”€â”€ api/
â”‚   â”‚       â”œâ”€â”€ auth/
â”‚   â”‚       â”‚   â””â”€â”€ route.ts           # Login/logout endpoints
â”‚   â”‚       â”œâ”€â”€ todoist/
â”‚   â”‚       â”‚   â””â”€â”€ route.ts           # Todoist sync endpoints
â”‚   â”‚       â””â”€â”€ voice/
â”‚   â”‚           â””â”€â”€ route.ts           # Whisper transcription
â”‚   â”œâ”€â”€ lib/
â”‚   â”‚   â”œâ”€â”€ db/
â”‚   â”‚   â”‚   â”œâ”€â”€ schema.ts             # Drizzle schema (all tables)
â”‚   â”‚   â”‚   â”œâ”€â”€ client.ts             # Turso connection
â”‚   â”‚   â”‚   â””â”€â”€ migrations/           # SQL migrations
â”‚   â”‚   â”œâ”€â”€ todoist/
â”‚   â”‚   â”‚   â”œâ”€â”€ client.ts             # Todoist API wrapper
â”‚   â”‚   â”‚   â”œâ”€â”€ sync.ts               # Sync logic
â”‚   â”‚   â”‚   â””â”€â”€ mapping.ts            # Priority/field mapping
â”‚   â”‚   â”œâ”€â”€ llm/
â”‚   â”‚   â”‚   â”œâ”€â”€ router.ts             # Model routing logic
â”‚   â”‚   â”‚   â”œâ”€â”€ gemini.ts             # Gemini Flash client
â”‚   â”‚   â”‚   â”œâ”€â”€ claude.ts             # Claude Opus client
â”‚   â”‚   â”‚   â”œâ”€â”€ context.ts            # Knowledge context builder
â”‚   â”‚   â”‚   â”œâ”€â”€ extraction.ts         # Knowledge extraction pipeline
â”‚   â”‚   â”‚   â””â”€â”€ prompts/
â”‚   â”‚   â”‚       â”œâ”€â”€ clarify.ts        # Clarify system prompt
â”‚   â”‚   â”‚       â”œâ”€â”€ organize.ts       # Organize system prompt
â”‚   â”‚   â”‚       â”œâ”€â”€ engage.ts         # Ranking system prompt
â”‚   â”‚   â”‚       â”œâ”€â”€ reflect.ts        # Review system prompt
â”‚   â”‚   â”‚       â””â”€â”€ extract.ts        # Knowledge extraction prompt
â”‚   â”‚   â”œâ”€â”€ embeddings/
â”‚   â”‚   â”‚   â”œâ”€â”€ generate.ts           # Embedding generation
â”‚   â”‚   â”‚   â””â”€â”€ search.ts             # Vector similarity (v2)
â”‚   â”‚   â”œâ”€â”€ voice/
â”‚   â”‚   â”‚   â”œâ”€â”€ whisper.ts            # Whisper API client
â”‚   â”‚   â”‚   â””â”€â”€ extract-tasks.ts      # Voice â†’ task extraction
â”‚   â”‚   â”œâ”€â”€ priority/
â”‚   â”‚   â”‚   â”œâ”€â”€ assign.ts             # Tier assignment
â”‚   â”‚   â”‚   â”œâ”€â”€ rank.ts               # Intra-tier ranking
â”‚   â”‚   â”‚   â””â”€â”€ fire.ts               # Fire protocol
â”‚   â”‚   â”œâ”€â”€ auth/
â”‚   â”‚   â”‚   â”œâ”€â”€ session.ts            # iron-session config
â”‚   â”‚   â”‚   â””â”€â”€ middleware.ts          # Auth middleware
â”‚   â”‚   â””â”€â”€ utils/
â”‚   â”‚       â”œâ”€â”€ dates.ts              # Date helpers
â”‚   â”‚       â””â”€â”€ formatting.ts         # Task formatting helpers
â”‚   â”œâ”€â”€ components/
â”‚   â”‚   â”œâ”€â”€ ui/                       # shadcn/ui components
â”‚   â”‚   â”œâ”€â”€ nav/
â”‚   â”‚   â”‚   â”œâ”€â”€ sidebar.tsx           # Main navigation
â”‚   â”‚   â”‚   â””â”€â”€ badge.tsx             # Unprocessed count badge
â”‚   â”‚   â”œâ”€â”€ inbox/
â”‚   â”‚   â”‚   â”œâ”€â”€ task-list.tsx         # Inbox task list
â”‚   â”‚   â”‚   â”œâ”€â”€ quick-add.tsx         # Quick add bar
â”‚   â”‚   â”‚   â””â”€â”€ voice-dump.tsx        # Voice recording UI
â”‚   â”‚   â”œâ”€â”€ clarify/
â”‚   â”‚   â”‚   â”œâ”€â”€ processing-queue.tsx  # Batch processing view
â”‚   â”‚   â”‚   â”œâ”€â”€ task-card.tsx         # Individual task card
â”‚   â”‚   â”‚   â”œâ”€â”€ question-panel.tsx    # LLM question interface
â”‚   â”‚   â”‚   â””â”€â”€ task-detail.tsx       # Expanded task editor
â”‚   â”‚   â”œâ”€â”€ organize/
â”‚   â”‚   â”‚   â”œâ”€â”€ project-dashboard.tsx # Project health grid
â”‚   â”‚   â”‚   â”œâ”€â”€ project-detail.tsx    # Single project view
â”‚   â”‚   â”‚   â”œâ”€â”€ audit-panel.tsx       # LLM audit conversation
â”‚   â”‚   â”‚   â”œâ”€â”€ filing-queue.tsx      # Task filing batch view
â”‚   â”‚   â”‚   â””â”€â”€ tag-manager.tsx       # Label management
â”‚   â”‚   â”œâ”€â”€ engage/
â”‚   â”‚   â”‚   â”œâ”€â”€ action-list.tsx       # Ranked task list
â”‚   â”‚   â”‚   â”œâ”€â”€ next-up-card.tsx      # Current task highlight
â”‚   â”‚   â”‚   â”œâ”€â”€ fire-modal.tsx        # Fire triage dialog
â”‚   â”‚   â”‚   â”œâ”€â”€ anti-pileup.tsx       # Bump decision dialog
â”‚   â”‚   â”‚   â””â”€â”€ progress-bar.tsx      # Daily progress
â”‚   â”‚   â”œâ”€â”€ reflect/
â”‚   â”‚   â”‚   â”œâ”€â”€ daily-review.tsx      # Daily close-out form
â”‚   â”‚   â”‚   â”œâ”€â”€ weekly-review.tsx     # Weekly review interface
â”‚   â”‚   â”‚   â””â”€â”€ stats-panel.tsx       # Completion statistics
â”‚   â”‚   â”œâ”€â”€ knowledge/
â”‚   â”‚   â”‚   â”œâ”€â”€ entry-list.tsx        # Knowledge entry browser
â”‚   â”‚   â”‚   â”œâ”€â”€ entry-editor.tsx      # Create/edit entry
â”‚   â”‚   â”‚   â””â”€â”€ stats.tsx             # Knowledge base stats
â”‚   â”‚   â””â”€â”€ shared/
â”‚   â”‚       â”œâ”€â”€ dictate-button.tsx    # Reusable mic button
â”‚   â”‚       â”œâ”€â”€ llm-stream.tsx        # Streaming LLM response display
â”‚   â”‚       â”œâ”€â”€ priority-badge.tsx    # P0-P4 badge component
â”‚   â”‚       â””â”€â”€ project-picker.tsx    # Project selector dropdown
â”‚   â””â”€â”€ actions/
â”‚       â”œâ”€â”€ inbox.ts                  # Inbox server actions
â”‚       â”œâ”€â”€ clarify.ts               # Clarify server actions
â”‚       â”œâ”€â”€ organize.ts              # Organize server actions
â”‚       â”œâ”€â”€ engage.ts                # Engage server actions
â”‚       â”œâ”€â”€ reflect.ts               # Reflect server actions
â”‚       â”œâ”€â”€ knowledge.ts             # Knowledge CRUD actions
â”‚       â””â”€â”€ sync.ts                  # Todoist sync actions
â”œâ”€â”€ drizzle.config.ts                 # Drizzle configuration
â”œâ”€â”€ middleware.ts                     # Next.js middleware (auth)
â”œâ”€â”€ tailwind.config.ts
â”œâ”€â”€ next.config.ts
â”œâ”€â”€ package.json
â”œâ”€â”€ .env.local                        # Local environment variables
â””â”€â”€ README.md
```

---

*Spec locked: February 23, 2026*
*Ready for development.*
