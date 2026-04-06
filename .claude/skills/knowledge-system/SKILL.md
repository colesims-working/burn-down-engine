---
name: knowledge-system
description: Ontology-driven GraphRAG knowledge system for Burn-Down Engine. Use when working on any knowledge, memory, embedding, retrieval, extraction, consolidation, or ontology code. Read this before writing or modifying any file in src/lib/knowledge/, src/actions/knowledge.ts, src/app/knowledge/, or any file that references the knowledge database.
---

# Knowledge System — Claude Code Reference

This is the authoritative implementation reference for Burn-Down Engine's ontology-driven knowledge system. The full design spec is in `KNOWLEDGE_SYSTEM_SPEC_v1.2.md` at the repo root. This file is the condensed version for active coding.

## Architecture Overview

The knowledge system is a **separate database** from the task database. It implements a personal knowledge graph with:
- **Typed objects** (nodes) with semantic subtypes
- **Typed links** (edges) with directional relationships
- **Hybrid retrieval** combining vector search + graph traversal (GraphRAG)
- **Inline micro-extraction** that learns from every LLM interaction
- **Brain-inspired consolidation** that fades, absorbs, and synthesizes — never deletes

## Database Connection

The knowledge graph uses its own Turso/libSQL database, separate from the task database.

```typescript
// Knowledge DB — separate from task DB
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';

const knowledgeClient = createClient({
  url: process.env.TURSO_KG_DATABASE_URL!,
  authToken: process.env.TURSO_KG_AUTH_TOKEN,
});

export const knowledgeDb = drizzle(knowledgeClient);
```

Environment variables:
- `TURSO_KG_DATABASE_URL` — libsql://knowledge-graph-colesims.aws-us-east-1.turso.io
- `TURSO_KG_AUTH_TOKEN` — auth token for knowledge DB
- `OPENROUTER_API_KEY` — for embedding generation

## Embedding Model

- **Model:** `qwen/qwen3-embedding-8b` via OpenRouter
- **Dimensions:** 4096
- **API:** OpenAI-compatible at `https://openrouter.ai/api/v1/embeddings`
- **Instruction-aware:** Queries get task-specific instruction prefixes. Stored objects are embedded as plain text (no prefix).

### Embedding function pattern

```typescript
async function generateEmbedding(
  text: string,
  options?: { isQuery?: boolean; taskInstruction?: string }
): Promise<number[]> {
  let input = text;
  if (options?.isQuery && options?.taskInstruction) {
    input = `Instruct: ${options.taskInstruction}\nQuery: ${text}`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen/qwen3-embedding-8b',
      input,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding;
}
```

### Task instructions for query-side embedding

| Use Case | Instruction |
|----------|-------------|
| Knowledge retrieval | `"Given a task description, retrieve relevant personal knowledge, preferences, and context about the user"` |
| Deduplication | `"Identify semantically duplicate or near-duplicate knowledge entries"` |
| Synthesis clustering | `"Group related behavioral observations and patterns for consolidation"` |

### Storage-side embedding (no instruction)

When embedding objects for storage, use bare text only:
```
{type}: {name} — {value or contextNotes or goal}
```

## Drizzle + Vector Strategy

Drizzle does NOT natively support `F32_BLOB`. Use the `customType` pattern:

```typescript
import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/sqlite-core';

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
    return Array.from(new Float32Array(value.buffer));
  },
  toDriver(value: number[]) {
    return sql`vector32(${JSON.stringify(value)})`;
  },
});
```

**CRITICAL:** `vector_top_k()` queries and vector index creation MUST use raw SQL via `knowledgeDb.execute()`. Drizzle's query builder cannot express table-valued functions. All CRUD operations use Drizzle ORM normally.

```typescript
// Vector search — always raw SQL
const results = await knowledgeDb.execute(sql`
  SELECT o.id, o.type, o.name, o.properties, o.confidence
  FROM vector_top_k('objects_embedding_idx', vector(${JSON.stringify(queryEmbedding)}), 30) AS v
  JOIN objects o ON o.rowid = v.id
  WHERE o.status = 'active'
    AND o.superseded_by IS NULL
  LIMIT 20
`);

// Vector index creation — raw SQL in migration
await knowledgeDb.execute(sql`
  CREATE INDEX objects_embedding_idx ON objects(libsql_vector_idx(embedding, 'metric=cosine'))
`);
```

## Object Types

| Type | Description | Dedup Key Pattern |
|------|-------------|-------------------|
| `person` | People the user works with | `person:{name}:{org}` |
| `project` | Workstreams, maps to Todoist projects | `project:todoist:{id}` or `project:{name}` |
| `organization` | Companies, teams, groups | `org:{name}` |
| `concept` | Knowledge atoms: preferences, patterns, facts, decisions | `concept:{subcategory}:{key}` |
| `event` | Time-anchored: meetings, deadlines, trips | `event:{name}:{date}` |

## Concept Subtypes

| Subtype | Always Global? | Auto-Pinned? |
|---------|---------------|-------------|
| `identity` | Yes | Yes |
| `priority` | Yes | Yes |
| `preference` | No | No |
| `pattern` | No | No |
| `schedule` | No | No |
| `decision` | No | No |
| `fact` | No | No |
| `workflow` | No | No |
| `observation` | No — primary consolidation target | No |

**CRITICAL RULE:** Single-interaction behavioral inferences MUST default to `observation` subtype. Only repeated evidence across multiple interactions should yield `pattern` objects. Observations are raw material; consolidation promotes them to patterns.

## Link Types

**Expansion allowlist** (traversed during retrieval):
`works_at`, `reports_to`, `collaborates_on`, `owns`, `applies_to`, `about`, `involves`, `relates_to`, `depends_on`, `supersedes`, `part_of`

**Excluded from expansion** (provenance/UI only):
`absorbed_into`, `associated`, `contradicts`

All link types are enforced by Zod schema. Use `associated` as escape hatch — it is low-confidence and non-expanding by default.

## Object Lifecycle States

`active` → `dormant` → `absorbed` (automatic transitions)
Any → `deleted` (user-initiated ONLY, never automatic)

- **Pinned** objects never go dormant or get consolidated.
- **Manual/seed** objects never get auto-absorbed or merged. Changes go to review queue.
- `ON DELETE RESTRICT` everywhere. Never cascade.

## Dedup Key Construction

All dedup keys: lowercase, replace whitespace/special chars with hyphens, trim.

```typescript
function buildDedupKey(type: string, obj: ExtractedObject): string {
  switch (type) {
    case 'person':
      return `person:${canonicalize(obj.name)}:${canonicalize(obj.properties.organization || 'unknown')}`;
    case 'concept':
      return `concept:${obj.subtype || 'other'}:${canonicalize(obj.properties.key || obj.name)}`;
    case 'project':
      return obj.properties.todoistId
        ? `project:todoist:${obj.properties.todoistId}`
        : `project:${canonicalize(obj.name)}`;
    case 'event':
      return `event:${canonicalize(obj.name)}:${obj.properties.date || 'undated'}`;
    case 'organization':
      return `org:${canonicalize(obj.name)}`;
    default:
      return `${type}:${canonicalize(obj.name)}`;
  }
}

function canonicalize(s: string): string {
  return s.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
```

## Retrieval Pipeline (buildContext)

Four stages:
1. **Global Context** — pinned objects (`pinned = 1, status = 'active'`), current project summary. ~500 token budget.
2. **Semantic Recall** — `vector_top_k` on active objects (inflate K to 30, post-filter to 20). Separate reactivation check on dormant objects (top 5, reactivate if similarity ≥ 0.90).
3. **Graph Expansion** — 1-hop from all seeds (max 5 per seed), 2-hop from person/project seeds only (max 3 per secondary). Hard cap 50 total expanded. Only allowlisted link types.
4. **Rank & Assemble** — Retrieval score formula, multiplicative page boosts (×1.15), conflict handling (supersedes: keep new only; contradicts: include both with flag). Pack to ~1500 token budget. Log references with `outcome = 'pending'`.

### Retrieval score (non-events)
```
(vector_similarity * 0.35) + (link_proximity * 0.25) + (recency_weight * 0.20) + (reference_density * 0.20)
```

### Retrieval score (events/schedules)
```
(vector_similarity * 0.30) + (link_proximity * 0.20) + (temporal_relevance * 0.25) + (recency_weight * 0.10) + (reference_density * 0.15)
```

### Graph-expanded object scoring
Objects found via graph traversal (not vector search) derive score from seed:
```
graph_semantic_score = seed_similarity * edge_confidence * hop_penalty
```
Where `hop_penalty` = 0.85 (1-hop), 0.60 (2-hop).

## Extraction System

### Inline micro-extraction
Appended to every qualifying LLM call (input > 20 tokens). Max 5 objects, 8 links per extraction. Inject known entity names into prompt. Parse asynchronously after primary response.

### Extraction buffer
Non-LLM events (complete, defer, bump, block, wait, fire, kill) write to `extraction_buffer`. Flushed at: daily review start, weekly review start, or when buffer > 15 entries.

### upsertKnowledge() behavior
1. Normalize names, build canonical_name and dedup_key
2. Resolve aliases via `object_aliases` table
3. Check `UNIQUE(type, dedup_key)`:
   - No match → INSERT
   - Match + source is manual/seed → create review_queue entry, don't overwrite
   - Match + source is extracted/consolidated → supersede if significantly different, merge if richer, skip if equal
4. Resolve link references to object IDs (create stubs for unknowns)
5. Generate embedding (never block on failure)
6. Create evidence record
7. Catch constraint violations → retry as update

## Consolidation Engine

Runs as weekly review pre-step, or on active object budget (>300), or manually.

### Salience score (query-independent, for lifecycle)
```
salience = confidence * exp(-days_since_last_activity / 60) * min(1.0, refs_last_90_days / 10)
```

### Operations
1. **Dormancy** — active → dormant when salience < 0.15 (skip pinned, manual, seed)
2. **Deduplication** — per-object `vector_top_k` queries (NOT cross-join), LLM merge evaluation, retired → absorbed with `absorbed_into` link
3. **Synthesis** — cluster by graph locality + embedding similarity (min 3 per cluster), LLM synthesis, sources → absorbed with provenance links
4. **Reference cleanup** — purge references > 180 days
5. **Log run** in `consolidation_runs`, tag all changes with `consolidation:{run_id}`

### Confidence reinforcement
Positive reference: `new_confidence = min(1.0, confidence + 0.02 * (1.0 - confidence))`
Negative reference: logged, not penalized directly. High negative ratio → flagged for review.

## Prompt Injection Hygiene

All knowledge injected into prompts MUST be wrapped in `<knowledge_context>` tags to separate data from instructions. Never allow stored values to override system behavior. Normalize extracted content before storage.

## Error Handling Rules

- Malformed extraction JSON → log and continue with primary task. Never retry extraction.
- Embedding failure → queue for retry. Null embedding never blocks insertion.
- Consolidation failure → transaction rollback. No partial absorptions.
- Vector search returns zero → fall back to global context only (cold start).
- Cold start (<30 active objects) → skip vector search, include all active objects.

## File Organization

```
src/lib/knowledge/
  db.ts              — Knowledge DB client (knowledgeDb)
  schema.ts          — Drizzle schema with customType for vectors
  types.ts           — TypeScript interfaces and Zod schemas
  embedding.ts       — Embedding generation (OpenRouter, instruction-aware)
  upsert.ts          — upsertKnowledge() unified write path
  retrieval.ts       — buildContext() 4-stage pipeline
  scoring.ts         — Retrieval score + salience score computation
  extraction.ts      — Inline extraction parsing, buffer management
  consolidation.ts   — Consolidation engine (dormancy, dedup, synthesis)
  aliases.ts         — Alias resolution
  evidence.ts        — Provenance logging
  migration.ts       — Data migration from legacy tables
  config.ts          — All tunable parameters
```

## Do NOT

- Use `name` for uniqueness. Always use `dedup_key`.
- Use `ON DELETE CASCADE`. Always `RESTRICT`.
- Auto-delete any object. Only user-initiated `deleted` status.
- Embed queries and documents the same way. Queries get instruction prefix.
- Use Drizzle query builder for `vector_top_k`. Always raw SQL.
- Create `pattern` objects from single interactions. Default to `observation`.
- Let extraction block the primary LLM response. Always async.
- Run consolidation without a `consolidation_runs` record.
- Cross-join objects for deduplication. Use per-object `vector_top_k`.
- Traverse `absorbed_into`, `associated`, or `contradicts` links during retrieval expansion.
