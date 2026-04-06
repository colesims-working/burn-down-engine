# CLAUDE.md

## What This File Is

This is the living project reference for Burn-Down Engine. Claude Code reads this at the start of every session. It must stay accurate — if you change architecture, add features, or shift patterns, update this file before ending the session.

**Rule: If you made meaningful changes to the codebase, update the relevant sections of this file before finishing.**

---

## Project Identity

Burn-Down Engine is a single-user, AI-assisted GTD system layered on top of Todoist. It uses LLMs to clarify and prioritize work, stores long-lived context in a personal knowledge graph, and emphasizes trust, undoability, and sync integrity.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 App Router, React 18, TypeScript |
| Styling | Tailwind CSS, Radix UI / shadcn patterns |
| Task DB | Turso/libSQL at `TURSO_DATABASE_URL` (Drizzle ORM) |
| Knowledge DB | Turso/libSQL at `TURSO_KG_DATABASE_URL` (Drizzle ORM, separate database) |
| Embeddings | Qwen3-Embedding-8B (4096 dims) via OpenRouter (`OPENROUTER_API_KEY`) |
| LLMs | Gemini, Anthropic, OpenAI (multi-provider, routed via `src/lib/llm/router.ts`) |
| Voice | OpenAI Whisper |
| Auth | iron-session + bcrypt |
| Tests | Vitest (328+ tests across 18 files) |
| Tracking | Langfuse (LLM calls + embeddings) |
| Deploy | Vercel |

---

## Two Databases

The task database and knowledge database are separate Turso instances with no shared foreign keys.

| Database | Env Vars | Contains |
|----------|----------|----------|
| Task DB | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Tasks, projects, Todoist sync, daily/weekly reviews |
| Knowledge DB | `TURSO_KG_DATABASE_URL`, `TURSO_KG_AUTH_TOKEN` | Objects (8 tables), links, aliases, evidence, references, extraction buffer, review queue, consolidation runs |

The knowledge DB client lives at `src/lib/knowledge/db.ts`. The only bridge between databases is string values (project names, task IDs) passed into `buildContext()`.

---

## Architecture Principles

- **Todoist is the task source of truth.** The local DB enriches, it does not replace.
- **Trust is a feature.** Undo, sync visibility, discrepancy detection, and protected action timing matter.
- **Single user today, database-per-user later.** No tenant IDs or RBAC. Multi-user = separate Turso databases.
- **Knowledge never auto-deletes.** Objects fade (dormant), absorb (consolidated), or tombstone (user-initiated). Never CASCADE.
- **Observations, not patterns.** Single-interaction inferences → `observation` subtype. Consolidation promotes to `pattern`.
- **Embeddings are instruction-aware.** Queries get instruction prefixes. Stored objects do not.
- **Drizzle for CRUD, raw SQL for vectors.** `vector_top_k()` cannot be expressed in Drizzle's query builder.
- **Todoist priority mapping is intentionally reversed.** Be careful with priority semantics.

---

## Key Subsystems

### Knowledge Graph (src/lib/knowledge/)

Ontology-driven GraphRAG system with typed objects, typed links, and brain-inspired memory lifecycle.

| File | Purpose |
|------|---------|
| `db.ts` | Knowledge DB client (lazy-init singleton) |
| `config.ts` | All tunable parameters |
| `types.ts` | Zod schemas + TypeScript interfaces |
| `schema.ts` | Drizzle schema, 8 tables, F32_BLOB(4096) customType |
| `embedding.ts` | OpenRouter embedding (Qwen3-Embedding-8B, instruction-aware, Langfuse-traced) |
| `aliases.ts` | Canonicalization, dedup key construction, alias resolution |
| `evidence.ts` | Provenance logging |
| `upsert.ts` | `upsertKnowledge()` unified write path |
| `retrieval.ts` | `buildContext()` 4-stage pipeline: global → vector → graph → rank & assemble |
| `scoring.ts` | Retrieval score + salience computation |
| `extraction.ts` | Inline micro-extraction, buffer management, flush triggers |
| `consolidation.ts` | Dormancy, dedup, synthesis, rollback |
| `migration.ts` | Legacy table migration (completed) |

**Read `.claude/skills/knowledge-system/SKILL.md` before modifying any of these files.**

### LLM Layer (src/lib/llm/)

| File | Purpose |
|------|---------|
| `router.ts` | Multi-provider model routing + inline extraction appending |
| `context.ts` | `buildContext()` delegates to knowledge graph, falls back to legacy |
| `tracking.ts` | Langfuse tracing (uses shared singleton from `src/lib/langfuse.ts`) |

### Priority / Engage Engine (src/lib/priority/)

| File | Purpose |
|------|---------|
| `engine.ts` | Priority assignment, ranking, tier building, bump/block/wait/fire behaviors |

### Trust Layer

| File | Purpose |
|------|---------|
| `src/components/providers/trust-provider.tsx` | Undo, sync state, integrity |
| `src/lib/undo/engine.ts` | Undo scaffolding |
| `src/components/shared/health-indicator.tsx` | Sync health visibility |

### Todoist Integration (src/lib/todoist/)

| File | Purpose |
|------|---------|
| `sync.ts` | Todoist ↔ local reconciliation |
| API route: `src/app/api/todoist/route.ts` | Central API surface (broad, intentionally) |

### Task Embeddings & Duplicate Detection (src/lib/embeddings/)

All task embeddings use **Qwen3-Embedding-8B (4096 dims)** via `generateEmbedding()` from the knowledge system. Never Gemini.

**Embedding lifecycle:**
1. **On sync** — `embedUnembeddedTasks()` embeds raw title. Also re-embeds tasks with stale wrong-dimension embeddings.
2. **After clarification** — `embedTask()` re-embeds with `title | nextAction | contextNotes` (richer content).
3. **After merge** — Merged task gets embedded with AI-generated title.

**Duplicate detection is two-phase:**
1. `embedUnembeddedTasks()` — sequential, stores embeddings. Independently useful for clustering/search.
2. `detectDuplicates(threshold)` — loads all 4096-dim candidates, pairwise cosine similarity, flags best match per task.

Client-side union-find clusters flagged tasks into groups of any size. `DuplicateGroupCard` shows AI-suggested merged title (editable) before user confirms.

| File | Purpose |
|------|---------|
| `dedup.ts` | Two-phase dedup pipeline, merge with AI title, dismiss |
| `generate.ts` | `embedTask()` for post-clarification re-embedding, `cosineSimilarity()` |

---

## Workflow Pages

| Page | Path | Purpose |
|------|------|---------|
| Inbox | `/inbox` | Capture, sort, triage |
| Clarify | `/clarify` | AI-powered task clarification with knowledge extraction |
| Organize | `/organize` | Project filing, audits, chat |
| Engage | `/engage` | Execution surface, tiered priority |
| Reflect | `/reflect` | Daily + weekly review (consolidation runs as weekly pre-step) |
| Knowledge | `/knowledge` | Graph visualization (List, Graph, Review, Log tabs), object management |
| Settings | `/settings` | Sync, models, migration, consolidation, export/import, embeddings |

---

## Testing

- **Runner:** Vitest
- **Pattern:** Mock DB for unit tests (pure logic), no integration tests against live DB
- **Run:** `npm test`
- **Coverage areas:** Todoist client, priority mapping, sync, clarify parsing, knowledge types/upsert/scoring/extraction/consolidation, UI accessibility

---

## Skills

| Skill | Location | When to read |
|-------|----------|-------------|
| Knowledge System | `.claude/skills/knowledge-system/SKILL.md` | Before ANY work on `src/lib/knowledge/`, `src/app/knowledge/`, or knowledge-related actions |

---

## Reference Documents

| Document | Location | Purpose |
|----------|----------|---------|
| Knowledge System Spec v1.2 | `docs/KNOWLEDGE_SYSTEM_SPEC_v1.2.md` | Full design rationale for the knowledge graph architecture |
| Legacy Project Info | `docs/PROJECT_INFO_legacy.md` | Historical project overview (pre-knowledge-graph) |

---

## Current State

_Last updated: April 5, 2026_

- Knowledge graph: Live. 8 tables, ~33 objects (30 migrated + extracted), vector search working at 4096 dims.
- Extraction: Active on all qualifying LLM calls. Learning indicator shows extractions in UI.
- Consolidation: Working. First run produced 11 dormant, 2 merges, 2 absorbed.
- Graph visualization: Live on Knowledge page (react-force-graph-2d).
- Review queue: Functional, no pending items currently.
- Legacy migration: Complete. Old tables preserved as `knowledge_entries_legacy` / `people_legacy`.

### Known Issues / Tech Debt

- ~~Global context includes all 37 projects~~ — Fixed: top 5 by recent activity.
- Extraction quality varies by LLM model — monitor success rate in Langfuse.
- No focused test coverage for the Knowledge page UI components.
- `src/app/api/todoist/route.ts` is growing large — consider splitting knowledge endpoints into a separate route.
- Task embedding throughput: parallelized in batches of 10 concurrent API calls. ~200 tasks ≈ 20 batches ≈ 40 seconds.

---

## Self-Maintenance Rules

When you (Claude Code) complete work on this codebase:

1. **Update "Current State"** if you changed what's live or fixed known issues.
2. **Update "Known Issues / Tech Debt"** if you introduced or resolved debt.
3. **Update "Key Subsystems"** if you added, renamed, or removed files.
4. **Update "Testing"** if test count or coverage areas changed significantly.
5. **Do not update other sections** unless the architecture fundamentally changed.
6. **Update BACKLOG.md** — check off completed items, add discovered bugs, move completed sprint items to done.
