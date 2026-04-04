# Knowledge Base Review

This document reviews how the Burn-Down Engine knowledge base currently works in code: how information is written, how it is stored, how it is read back into the product, and where the current implementation falls short.

Reviewed sources:
- `README.md`
- `burn-down-engine-spec.md`
- `seed.example.json`
- `scripts/seed.ts`
- `src/lib/db/schema.ts`
- `src/actions/knowledge.ts`
- `src/app/knowledge/page.tsx`
- `src/app/api/todoist/route.ts`
- `src/lib/llm/context.ts`
- `src/lib/llm/extraction.ts`
- `src/lib/embeddings/generate.ts`
- `src/actions/clarify.ts`
- `src/actions/organize.ts`
- `src/actions/reflect.ts`
- `src/lib/priority/engine.ts`
- `src/lib/db/settings.ts`
- `src/lib/llm/router.ts`
- `src/app/settings/page.tsx`

## Executive Summary

The knowledge base is conceptually one of the most important parts of the product, but the current implementation is uneven:

- Storage is broader than retrieval. The app stores many categories of knowledge, but only a subset is actually injected back into prompts.
- `knowledge_entries` is the main memory system. `people` exists beside it, but people are handled more like a manual address book than a fully integrated memory layer.
- Automatic learning exists, but the write paths are inconsistent. Some flows insert-only, some update existing entries, and some generate embeddings while others do not.
- Retrieval is currently keyword and substring driven, not semantic. Embeddings are stored, but not used for context selection.
- The knowledge base is transparent and editable in the UI, but management features are incomplete. Export omits people, reset is not implemented, and there is no audit trail for knowledge changes.

If you are making product or architecture decisions, the most important truth is this:

- The app already has a workable memory substrate.
- The bottleneck is not "can it store knowledge?"
- The bottleneck is "does stored knowledge reliably come back at the right time, in the right form, with enough quality control?"

## Highest-Priority Findings

### 1. The system stores more knowledge than it actually uses

The schema allows these `knowledge_entries.category` values:

- `identity`
- `preference`
- `pattern`
- `priority`
- `schedule`
- `decision`
- `fact`
- `workflow`
- `other`

But `buildContext()` only reads back:

- `identity`
- `priority`
- `pattern`
- `preference`
- special `pattern` entries whose key contains `defer`

That means `schedule`, `decision`, `fact`, `workflow`, and `other` are currently stored but not directly injected into prompt context by the main context builder.

Implication:
- A large part of the knowledge base is passive storage, not active working memory.

### 2. People are second-class knowledge

The app has a dedicated `people` table, but it is not treated with the same maturity as `knowledge_entries`.

Current reality:
- People are created manually through the Knowledge page, or through the seed script.
- There is no code path that automatically inserts people records during clarification or other LLM flows.
- The Knowledge page UI claims people "will appear automatically when mentioned during task clarification," but that is not implemented.
- `people.relatedProjects` is stored in the schema and seed script, but is not surfaced in the UI and is not used in retrieval.
- People are not included in "Export Knowledge Base" from Settings.

Implication:
- People data exists, but the "AI knows who I work with" loop is much weaker than the product language suggests.

### 3. Auto-learning is inconsistent depending on the code path

There are two main auto-write paths:

1. `processInlineKnowledge(...)`
- Used by `clarifyTask`, `runProjectAudit`, `generateDailyObservations`, and `generateWeeklyReview`
- Only inserts new entries if `(category, key)` is not already present
- Does not update existing entries
- Does not generate embeddings

2. `extractAndStoreKnowledge(...)`
- Used by `answerClarifyQuestion`
- Calls the configured `extract_knowledge` LLM operation
- Can update existing entries when confidence is better or the value is longer
- Does generate embeddings for new entries

Implication:
- Two different "learning systems" are operating with different quality levels.
- Most inline extraction paths are lower quality than the dedicated extraction path.

### 4. Embeddings are stored, but not used for retrieval

The app generates embeddings for:

- tasks
- manually created/updated knowledge entries
- knowledge entries created by `extractAndStoreKnowledge(...)`

But:

- `buildContext()` does not use embeddings at all
- person records have no embeddings
- inline knowledge written via `processInlineKnowledge(...)` gets no embedding
- the repo only includes a cosine similarity helper for future use

Implication:
- The system is still effectively a string-matching memory system.
- If vector retrieval is added later, the current data will need cleanup or backfill.

### 5. The knowledge model lacks validation and uniqueness guarantees

Current issues:

- There is no database uniqueness constraint on `(category, key)` for `knowledge_entries`
- There is no uniqueness constraint on `people.name`
- Manual create/update actions do not use schema validation such as Zod
- Keys are not normalized or canonicalized
- Slightly different keys like `deep-work-time`, `deep_work_time`, and `deep work time` can become separate entries

Implication:
- Memory drift and duplicate facts are likely over time, especially with LLM-generated keys.

### 6. Management tooling is incomplete

The product exposes a "Knowledge" page and "Export Knowledge Base" in Settings, but:

- Export currently fetches only `GET /api/todoist?action=knowledge`, which returns `knowledge_entries` only
- `people` is excluded from export
- Reset knowledge base is not implemented
- There is no knowledge change history or undo
- There are no tests focused on knowledge CRUD, extraction, retrieval, or prompt injection quality

Implication:
- The knowledge base is visible, but still operationally immature.

### 7. Bootstrap seeding appears broken

`scripts/seed.ts` imports:

- `import * as schema from './src/lib/db/schema';`

Because the script lives in `scripts/`, that relative import likely resolves incorrectly. It appears it should be:

- `../src/lib/db/schema`

Implication:
- The recommended "seed your knowledge base" onboarding path may fail unless tooling behavior happens to mask the bad path.

## What Counts as the Knowledge Base in This Repo

There are really three layers of memory in the current product.

### 1. Explicit knowledge tables

These are the official knowledge base tables:

#### `knowledge_entries`

Fields:
- `id`
- `category`
- `key`
- `value`
- `confidence`
- `source`
- `timesReferenced`
- `embedding`
- `embeddingText`
- `createdAt`
- `updatedAt`

This is the main long-lived memory store.

#### `people`

Fields:
- `id`
- `name`
- `relationship`
- `organization`
- `role`
- `contextNotes`
- `relatedProjects`
- `createdAt`
- `updatedAt`

This is a dedicated people directory, but it is not integrated as deeply as `knowledge_entries`.

### 2. Adjacent project memory

Projects also store useful context that affects prompt building:

- `goal`
- `notes`
- `relatedPeople`
- `keyLinks`
- `openDecisions`
- `llmObservations`
- `suggestedActions`

This data is not part of the Knowledge page, but it is part of the system's memory.

### 3. Adjacent task memory

Tasks also carry contextual knowledge:

- `contextNotes`
- `relatedPeople`
- `relatedLinks`
- `llmNotes`
- `clarifyQuestions`

This is more local and task-scoped than the knowledge base tables, but it still contributes to system memory.

## How Information Gets Written

There are three intended write channels.

### 1. Seed file bootstrap

Documented in `README.md` and demonstrated by `seed.example.json`.

Expected flow:
- Copy `seed.example.json` to `seed.json`
- Add your people and knowledge
- Run `npm run db:seed`

Seeded people fields:
- name
- relationship
- organization
- role
- contextNotes
- relatedProjects

Seeded knowledge fields:
- category
- key
- value
- confidence is hard-coded to `1.0`
- source is hard-coded to `seed`

Current caveat:
- The seed script likely has a broken relative schema import.

### 2. Manual CRUD from the Knowledge page

The Knowledge page supports:

- list knowledge entries
- filter by category
- search by key/value
- create entry
- edit entry
- delete entry
- create person
- edit person
- delete person
- view basic stats

Manual knowledge entry creation writes:
- `category`
- `key`
- `value`
- `confidence` defaults to `1.0`
- `source` becomes `user_edit`

Manual knowledge entry update:
- updates the provided fields
- refreshes `updatedAt`
- regenerates the embedding

Manual person creation/update:
- writes person fields directly
- does not generate embeddings

Current caveats:
- no input validation
- no duplicate prevention
- no confidence editing in the UI
- no editing of source or times referenced
- no UI field for `relatedProjects`

### 3. Automatic extraction from LLM workflows

#### Clarify

`clarifyTask(...)` expects the LLM to return:
- clarified task fields
- `knowledgeExtracted: []`

It stores that inline extracted knowledge via `processInlineKnowledge(...)`.

`answerClarifyQuestion(...)` additionally calls `extractAndStoreKnowledge(...)`, which is the more capable extraction path.

#### Organize

`runProjectAudit()` allows `knowledgeExtracted` in the LLM response and sends it to `processInlineKnowledge(...)`.

#### Reflect

Both `generateDailyObservations()` and `generateWeeklyReview()` allow `knowledgeExtracted` and send it to `processInlineKnowledge(...)`.

#### Engage

Engage prompt files include `knowledgeExtracted` in some JSON outputs, but the ranking flow itself does not currently process extracted knowledge.

Current caveat:
- the auto-learning story is real, but partial and inconsistent.

## How Information Is Stored

## Storage semantics for `knowledge_entries`

### Category

Human-defined taxonomy bucket. Categories are broad and intentionally flexible.

### Key

A short identifier for the fact or pattern.

Examples from the seed file:
- `role`
- `focus-areas`
- `deep-work-time`
- `communication-style`

Important behavior:
- the key is the dedupe anchor in code
- there is no enforced normalization
- if the key changes shape, the system may create a separate memory instead of improving an existing one

### Value

The actual memory payload. This is freeform text.

### Confidence

Used as a rough trust score for extracted knowledge.

Current behavior:
- manual entries default to `1.0`
- seed entries default to `1.0`
- extracted entries take the LLM-provided value
- stats compute average confidence across knowledge entries only

### Source

The recorded origin of the entry.

Observed values:
- `seed`
- `user_edit`
- `clarify`
- `organize`
- `reflect`

Current limitation:
- if a user edits an auto-extracted entry, the source is not explicitly updated to reflect that manual correction

### timesReferenced

A usage counter incremented when some knowledge entries are included in built context.

Current limitation:
- only certain knowledge categories are tracked this way
- people do not have equivalent usage tracking
- this is not a full retrieval analytics system, just a coarse counter

### Embedding and embeddingText

Prepared for future semantic retrieval.

Current limitation:
- retrieval does not use them yet
- not all auto-created entries receive embeddings

## How Information Is Retrieved and Used

The main retrieval mechanism is `buildContext(input, page)`.

### Always included in context

Every context build includes:

- identity entries
- priority entries
- active project summary

This means some knowledge is always global, regardless of the task.

### Input-based matching

The system tries to match:

- mentioned people from the input text
- mentioned projects from the input text

Matching behavior is currently simple substring search over:

- full person names in the `people` table
- active project names in the `projects` table

This is not semantic retrieval. It is literal text matching.

### Page-specific retrieval

#### Clarify

Adds:
- task patterns
- decomposition templates
- preferences

This is the richest knowledge injection path.

#### Organize

Adds:
- preferences

#### Engage

Adds:
- deferral patterns
- tasks bumped 2 or more times

#### Reflect

Adds:
- deferral patterns
- task patterns

### Category-by-category reality

| Category | Stored? | Retrieved into prompt context? | Notes |
|---|---|---|---|
| `identity` | Yes | Yes, always | First-class |
| `priority` | Yes | Yes, always | First-class |
| `preference` | Yes | Yes, clarify + organize | First-class |
| `pattern` | Yes | Yes, clarify + reflect + deferral special case | First-class |
| `schedule` | Yes | No direct retrieval | Stored, mostly dormant |
| `decision` | Yes | No direct retrieval | Stored, mostly dormant |
| `fact` | Yes | No direct retrieval | Stored, mostly dormant |
| `workflow` | Yes | No direct retrieval | Stored, mostly dormant |
| `other` | Yes | No direct retrieval | Stored, mostly dormant |

This table is the single most important "how it works vs how it sounds" distinction in the codebase.

## How People Work Specifically

People context only enters prompts when:

- the input string contains a person name that matches a row in the `people` table

When matched, the prompt receives:

- name
- relationship
- organization
- role
- context notes

What is not currently used:

- `relatedProjects`
- any aliasing or nickname logic
- any embeddings or semantic lookup
- any auto-creation of people from extracted mentions

Operationally, this means:

- people context is useful if the user manually maintains the people table
- otherwise it is easy for this part of the system to stay sparse

## Embeddings: What Exists vs What Is Real

### What exists

The code can generate embeddings for:
- tasks
- knowledge entries

Embedding text format for knowledge entries:
- `${category}: ${key} - ${value}`

### What is real today

Embeddings do not drive retrieval today.

The current retrieval engine is:
- category filters
- substring matching
- manual ordering by `timesReferenced`

So embeddings are currently:
- stored
- future-facing
- not product-defining yet

## Knowledge Base UI and Product Surface

### Knowledge page strengths

- transparent
- searchable
- editable
- category-aware
- shows confidence, source, and times referenced for entries
- exposes people separately

### Knowledge page limitations

- people have fewer metadata fields exposed than knowledge entries
- no `relatedProjects` editing
- no provenance editing
- no merge/dedupe tools
- no sort by confidence or usage
- no bulk actions
- no audit history

### Settings page limitations

- "Export Knowledge Base" exports only `knowledge_entries`
- people are omitted
- reset is a stub only

## Reality vs the Product/Spec Narrative

The spec and README describe a system that learns from everything and meaningfully injects the right context back into prompts. The current implementation partially supports that vision, but not fully.

### Where implementation matches the vision

- there is a real memory store
- there is real manual CRUD
- there is real auto-extraction
- there is real prompt context building
- there is real usage counting
- there are real embeddings stored for future retrieval

### Where implementation falls short

- many stored categories are not retrieved
- people are not auto-created from mention-level learning
- there is no semantic retrieval
- auto-learning quality differs by code path
- export/reset/admin tooling is incomplete

## Testing Status

There is effectively no focused automated test coverage for the knowledge base.

Observed tests touch:
- clarify result shapes containing `knowledgeExtracted`
- generic mocked `buildContext()` in an engine test

Missing test coverage:
- knowledge CRUD behavior
- duplicate prevention
- extraction update behavior
- people matching
- category retrieval behavior
- `timesReferenced` increments
- export contents
- seed script correctness
- embedding generation on each write path

## Decision Guidance

If you are deciding what to improve next, the best leverage is:

1. Strengthen retrieval before expanding the schema further.
2. Unify auto-learning so all extraction paths can update, dedupe, and embed consistently.
3. Decide whether people are part of the knowledge base proper or just supporting metadata, then implement accordingly.
4. Add canonicalization and uniqueness rules before long-term memory drift gets worse.
5. Finish operational tooling: export, reset, auditability, and tests.

## Recommended Near-Term Fixes

### High value, low ambiguity

- Add a unique index on `knowledge_entries(category, key)`
- Add a uniqueness rule or duplicate handling strategy for `people.name`
- Fix `scripts/seed.ts` import path
- Make Settings export include both `knowledge_entries` and `people`
- Update the Knowledge page copy so it does not claim people auto-appear unless that feature is actually implemented

### High value, moderate effort

- Replace `processInlineKnowledge(...)` with a single upsert-style helper that:
  - normalizes keys
  - updates existing entries when new data is better
  - always generates embeddings
- Add retrieval support for at least:
  - `workflow`
  - `schedule`
  - `decision`
  - `fact`
- Add people extraction/upsert if that is core to the product promise

### Strategic improvements

- Add prompt budget rules so identity/preferences/projects do not grow unbounded
- Add semantic retrieval using stored embeddings
- Add knowledge change history and undo
- Add evaluation tests for retrieval quality, not just unit tests for shapes

## Bottom Line

The knowledge base is already meaningful infrastructure, not a toy. It has:

- explicit storage
- manual editing
- automatic learning hooks
- prompt injection
- usage counters
- future-ready embeddings

But today it is best described as:

- a partially integrated memory layer
- with strong foundations
- and weak retrieval discipline

If this repo wants the knowledge base to be the product moat, the next wave of work should focus less on storing more facts and more on making stored facts reliably useful.
