# Project Info

This document is a current-working-tree overview of the Burn-Down Engine codebase. It is meant to be handed to another LLM as the "full project context" document, with deeper companion files such as `KNOWLEDGE_BASE_INFO.md` used for focused architecture discussions.

Important framing:

- This document reflects the current working tree, not just the last committed `HEAD`.
- If product docs and code disagree, trust `src/` and the current API behavior over aspirational planning docs.
- This is an architecture and decision-support document, not a user guide.

Reviewed sources:

- `README.md`
- `DEPLOY.md`
- `burn-down-engine-spec.md`
- `FEATURES.md`
- `.env.example`
- `package.json`
- `next.config.js`
- `drizzle.config.ts`
- `tailwind.config.ts`
- `vercel.json`
- `vitest.config.ts`
- `scripts/seed.ts`
- `seed.example.json`
- `src/app/**`
- `src/actions/**`
- `src/components/**`
- `src/hooks/**`
- `src/lib/**`
- `tests/**`
- `e2e/ai-review.ts`

## Executive Summary

Burn-Down Engine is a single-user, AI-assisted GTD system layered on top of Todoist.

The core product model is:

- Todoist is the operational source of truth for tasks and projects.
- The local Turso/libSQL database is the app's enrichment, memory, history, analytics, and orchestration layer.
- The app guides the user through a GTD-style loop:
  `capture -> clarify -> organize -> engage -> reflect`
- LLMs are used to convert vague inputs into actionable work, help with ranking and review, and accumulate reusable knowledge about the user.
- The current working tree also includes a trust layer: undo, integrity checks, sync visibility, and shared action timing protections.

If another LLM needs one sentence to orient itself, use this:

Burn-Down Engine is a personal productivity operating system for one trusted user that sits on top of Todoist, uses AI to clarify and prioritize work, stores long-lived context in a local knowledge base, and increasingly emphasizes trust, undoability, and sync integrity.

## What The Project Is

At a product level, this repo is trying to solve a very specific problem:

- Raw task capture is easy.
- Turning raw captures into correct, scoped, trustworthy next actions is hard.
- Prioritizing those actions consistently is even harder.
- Most task systems fail when users stop trusting them.

This project responds to that by combining:

- Todoist for durable task/project primitives
- local structured storage for richer task metadata
- AI assistance for clarification, filing, review, and prioritization
- explicit workflows for inbox processing, execution, and review
- a knowledge base that learns user preferences and patterns over time
- trust-focused UX features so mistakes can be undone and sync drift becomes visible

## What The Project Is Not

These are important negative constraints for architecture decisions:

- It is not a multi-user SaaS product.
- It is not a team collaboration platform.
- It is not a general note-taking or knowledge-management system first.
- It is not intended to replace Todoist as the underlying task substrate.
- It is not designed around webhooks, real-time collaboration, or heavy back-office admin tooling.
- It is not currently organized as a strict service-oriented backend with fine-grained APIs.

If a proposed architecture starts introducing tenants, RBAC, organizations, real-time collaboration layers, complex event buses, or multi-actor synchronization models, that is probably overbuilding relative to the current product.

## Core Architectural Principles

These principles show up repeatedly across the codebase:

- Todoist-first task model:
  actionable tasks and projects ultimately need to reconcile with Todoist.
- Local intelligence layer:
  the local DB stores metadata that Todoist does not, such as clarified titles, next actions, confidence, knowledge, history, and reviews.
- Single trusted user:
  the app assumes one authenticated person, not many users with isolation boundaries.
- Server-side AI and integration logic:
  secrets, model calls, and Todoist operations live server-side.
- Workflow-driven UX:
  pages are organized by GTD stages rather than generic CRUD resources.
- Transparency over full automation:
  AI suggests and structures, but the UI keeps the user in the loop.
- Trust as a feature:
  undo, sync visibility, discrepancy detection, and protected action timing matter as much as raw capability.

## High-Level User Workflow

### 1. Capture / Inbox

The user quickly captures tasks, either manually or by voice.

Current behavior includes:

- Inbox quick-add
- Todoist inbox sync
- voice transcription via Whisper
- extraction of multiple tasks from a voice dump
- sort and select flows for inbox triage
- inbox-zero warning signals when the queue gets large
- quick-close handling for clearly trivial work

### 2. Clarify

Inbox items are turned into more actionable tasks.

Clarification can produce:

- cleaned-up title
- explicit next action
- description/context
- priority
- labels
- due date
- time estimate
- energy level
- blocking or waiting state
- follow-up questions when the original input is too vague
- optional decomposition into subtasks
- extracted inline knowledge about the user

The Clarify page is one of the most behaviorally dense areas of the app. It supports batching, auto-approve thresholds, manual edits, re-instruction, voice input for follow-up, and subtask generation.

### 3. Organize

Tasks are filed into projects and the project list is audited.

Current organize capabilities include:

- project CRUD and archive flows
- project health/activity summaries
- AI project audits
- filing suggestions for unassigned work
- an "organize chat" for project or filing assistance

### 4. Engage

This is the execution surface. Tasks are arranged into actionable tiers and can be completed, deferred, blocked, waited, bumped, or turned into fires.

The current engage model includes:

- a top "Next Up" view
- context filtering
- urgency-focused task buckets
- keyboard shortcuts
- anti-pile-up behavior for repeatedly bumped tasks
- an urgent interrupt / "fire" flow
- integration with undo support

### 5. Reflect

The app supports both daily and weekly reflection.

Daily review includes:

- completion stats
- completed and incomplete task review
- bump / block / kill actions
- freeform capture
- AI-generated observations

Weekly review includes:

- a GTD-inspired checklist
- AI-generated summary and trends
- wins and fire analysis
- project velocity
- anti-pile-up alerts
- pattern insights
- next-week focus

### 6. Knowledge

The app stores reusable memory about the user, their patterns, and the people they work with.

This area is important enough that it already has a dedicated deep-dive document:

- `KNOWLEDGE_BASE_INFO.md`

### 7. Settings / Admin

Settings is a practical control surface for:

- sync actions
- model routing and presets
- model testing
- disabled models
- auto-approve threshold
- export tools
- connection/configuration visibility

## Tech Stack

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Radix UI and shadcn-style component patterns
- Turso/libSQL
- Drizzle ORM
- Todoist REST API v1
- Gemini, Anthropic, and OpenAI integrations
- OpenAI Whisper for voice transcription
- iron-session for auth sessions
- bcrypt for password verification
- optional Langfuse tracking
- Vitest for automated tests
- Playwright-based AI review tooling in `e2e/ai-review.ts`
- Vercel deployment target

## Deployment And Runtime Model

### Hosting

- Intended deployment target is Vercel.
- `vercel.json` sets the region to `iad1` and adds basic security headers.
- `DEPLOY.md` describes production deployment from `master` and preview deployments for other branches.

### Database

- Turso/libSQL is the primary app database.
- Drizzle schema lives in `src/lib/db/schema.ts`.
- Migrations live in `src/lib/db/migrations`.

### Secrets / Env

Expected environment variables include:

- `APP_PASSWORD_HASH`
- `SESSION_SECRET`
- `TODOIST_API_TOKEN`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- optional Langfuse keys

### Auth

Auth is intentionally simple:

- one shared password
- bcrypt hash comparison
- iron-session cookie
- route protection via middleware

This is consistent with the single-user design. It also means there is no account model, no per-user data partitioning, and no role system.

## Request / Execution Architecture

The codebase uses a hybrid pattern:

- server actions exist in `src/actions/*`
- a large internal API route exists at `src/app/api/todoist/route.ts`
- client pages fetch from that API route for much of their behavior

In practice, the API route acts as the main internal application endpoint for a wide range of actions such as:

- sync
- inbox capture
- clarify flows
- engage actions
- organize actions
- reflect actions
- knowledge CRUD
- settings updates
- undo
- integrity checks

This is not a clean resource-oriented REST API. It is closer to an internal command router for the app.

That has tradeoffs:

- it is simple and pragmatic for one product owned by one user
- it concentrates orchestration logic in one place
- it can become harder to reason about as the product grows

For now, it fits the current scale and product model.

## Repository Structure

Top-level layout:

- `src/app`
  Next.js App Router pages and API routes
- `src/actions`
  server-side task, organize, reflect, sync, and knowledge actions
- `src/components`
  UI components, navigation, shared UX, trust provider, dialogs
- `src/hooks`
  client hooks such as toast handling
- `src/lib`
  business logic, database, Todoist integration, LLM integration, priority engine, undo engine, utilities
- `tests`
  Vitest coverage for logic-heavy behavior
- `e2e`
  AI-assisted Playwright review tooling and prior review output
- `scripts`
  setup and seed scripts

## Key Pages And Their Roles

### `src/app/inbox/page.tsx`

Primary responsibilities:

- fetch and display inbox tasks
- auto-sync stale inbox state
- support quick capture
- handle voice recording/upload and extracted tasks
- let the user select tasks for clarification
- allow fast completion for obvious trivial tasks

### `src/app/clarify/page.tsx`

Primary responsibilities:

- batch clarification of inbox items
- show AI output and confidence
- ask and answer follow-up questions
- edit before approval
- split tasks into subtasks
- auto-approve when confidence is high enough
- preserve in-progress clarify state in local storage

This page is large and stateful. Any refactor here needs to preserve nuanced workflow behavior, not just visual output.

### `src/app/organize/page.tsx`

Primary responsibilities:

- show project health
- audit project lists
- surface filing suggestions
- support project creation/update/archive
- host the organize chat

### `src/app/engage/page.tsx`

Primary responsibilities:

- build execution view from ranked active work
- support task actions with fast feedback
- handle fire creation/promotion
- support block and waiting flows
- provide context-based filtering and shortcuts

### `src/app/reflect/page.tsx`

Primary responsibilities:

- daily closeout
- weekly review workflow
- save daily review data
- generate weekly review analysis

### `src/app/knowledge/page.tsx`

Primary responsibilities:

- browse knowledge entries and people
- search and filter memory
- create, edit, and delete records
- show knowledge statistics

### `src/app/settings/page.tsx`

Primary responsibilities:

- model and sync controls
- export tooling
- connection visibility
- auto-approve configuration
- model testing

## Data Model Overview

The schema is central to understanding the app. The most important tables are:

### `tasks`

This is the enriched local representation of work.

It stores:

- raw original text
- clarified title
- next action
- description
- task status
- priority
- due date
- labels
- project link
- context notes
- people and link references
- clarify confidence and questions
- decomposition state
- Todoist linkage
- embeddings
- timestamps

This is the most important local table for orchestration. Even though Todoist is the operational source of truth for tasks, the app's real intelligence lives in these extra fields.

### `projects`

Stores:

- local project metadata
- Todoist mapping
- status
- activity/health-related fields
- review-oriented fields

### `knowledge_entries`

Stores structured memory across categories such as:

- identity
- preference
- pattern
- priority
- schedule
- decision
- fact
- workflow
- other

Each entry stores a key, value, confidence, source, optional embedding, and reference count.

### `people`

Stores:

- name
- relationship
- organization
- role
- context notes
- related projects

This is adjacent to the knowledge base but currently behaves more like a dedicated people registry than a fully integrated semantic memory system.

### `task_history`

Stores state transitions and action audit trails.

This table is especially important because the current trust/undo layer uses it as part of its reversibility story.

### `daily_reviews`

Stores daily closeout output and related state.

### `weekly_reviews`

There is a dedicated table in the schema, but the current product behavior appears more mature for daily review persistence than for weekly review persistence.

### `llm_interactions`

Stores:

- provider/model info
- operation name
- prompt/response metadata
- timing and token estimates
- rough cost

### `sync_state`

Stores integration status details such as:

- last sync times
- counts
- sync metadata used by UI and health indicators

### `app_settings`

Stores user-configurable app behavior such as:

- model routing
- auto-approve threshold
- disabled models
- other internal app settings

## Todoist Integration Model

The Todoist integration is foundational.

Key truths:

- Todoist projects and tasks are pulled into the local DB.
- Local tasks can be pushed back to Todoist after clarification or updates.
- Task actions such as complete, reopen, defer-related due date changes, waiting labels, and project changes reconcile with Todoist.
- The app intentionally maps local priority semantics to Todoist priorities.

Important priority nuance:

- Todoist `p4` maps to local `P1`
- Todoist `p3` maps to local `P2`
- Todoist `p2` maps to local `P3`
- Todoist `p1` maps to local `P4`

This reversed semantic mapping matters a lot. Any change touching priority behavior needs to preserve it or intentionally migrate it.

Key integration code:

- `src/lib/todoist/client.ts`
- `src/lib/todoist/sync.ts`

## LLM Architecture

The app has a real LLM routing layer, not just ad hoc calls.

Key pieces:

- `src/lib/llm/router.ts`
- `src/lib/db/settings.ts`
- `src/lib/llm/providers.ts`
- `src/lib/llm/context.ts`
- `src/lib/llm/extraction.ts`
- `src/lib/llm/tracking.ts`

### What the LLMs are used for

- task clarification
- follow-up question handling
- knowledge extraction
- voice task extraction
- filing suggestions
- project audits
- organize chat
- engage ranking support
- daily observations
- weekly review analysis

### Model routing

Settings can choose providers and models per operation.

This is an important design feature:

- the app is not hardcoded to one model vendor
- different operations can use cheaper or more capable models
- the product is designed to treat model choice as user-tunable infrastructure

### Context building

`buildContext()` assembles prompt context from:

- stored knowledge
- projects
- people
- page/workflow type
- the current input

Important nuance:

- retrieval is useful but still uneven
- some stored knowledge categories are more actively used than others
- the memory system is broader than the current prompt injection strategy

For a deeper review of that area, use:

- `KNOWLEDGE_BASE_INFO.md`

### LLM observability

Interactions are logged in the database, and Langfuse can be enabled for external tracing.

## Knowledge Base Model

The knowledge base is strategically important but should be thought of as "partially mature."

Current reality:

- the schema and UI already support a meaningful memory layer
- auto-extraction exists across multiple workflows
- storage quality is ahead of retrieval quality
- manual curation is possible
- people are stored separately from `knowledge_entries`

The best current deep-dive document for this subsystem is:

- `KNOWLEDGE_BASE_INFO.md`

If another LLM is brainstorming architecture in this area, it should read that file after this one.

## Priority / Engage Engine

Execution logic is centered in `src/lib/priority/engine.ts`.

This subsystem is responsible for:

- assigning and adjusting priorities
- ranking tasks within tiers
- building the engage list
- handling bump/block/wait/fire behaviors
- syncing certain effects back to Todoist

This is not a generic sort-by-field implementation. It encodes product philosophy:

- urgency matters
- blocked and waiting work need distinct handling
- repeatedly bumped work is a smell
- the system should surface "fires" when work becomes urgent enough

## Trust Layer

The current working tree includes an increasingly important trust subsystem.

Key pieces:

- `src/components/providers/trust-provider.tsx`
- `src/lib/undo/engine.ts`
- `src/components/shared/health-indicator.tsx`
- `src/hooks/use-toast.ts`

What this layer is trying to do:

- make destructive actions undoable
- make sync state visible
- detect drift between local state and Todoist
- protect users from accidental duplicate actions
- standardize action timing across the app

Current implemented behaviors include:

- toast-based undo scaffolding
- a shared protected busy/debounce window for repeated actions
- sync-state refresh on focus
- periodic integrity checking
- a visible health indicator in navigation
- an internal undo endpoint

This is an important current direction of the product. New feature work should not bypass it casually.

## UI / UX Characteristics

This repo is not just backend logic wrapped in pages. The workflow and UX details matter.

Important characteristics:

- the app is organized around stages of thought and action, not generic resources
- keyboard shortcuts are supported in several core workflows
- mobile navigation is intentionally considered, not an afterthought
- toast and confirmation patterns are reused across destructive actions
- action speed and trust are treated as product concerns

Several core pages are fairly large client components. That is not automatically wrong here, but it means behavior is often coupled to local UI state in a way that architectural changes need to respect.

## Testing And Quality Posture

The repo has a meaningful but selective automated test suite.

Current test files include:

- `tests/todoist-client.test.ts`
- `tests/push-to-todoist.test.ts`
- `tests/priority-mapping.test.ts`
- `tests/engine-todoist-sync.test.ts`
- `tests/inbox-sort.test.ts`
- `tests/clarify-validation.test.ts`
- `tests/clarify-operations.test.ts`
- `tests/confirm-dialog.test.ts`
- `tests/ui-accessibility.test.ts`

What is covered relatively well:

- Todoist client behavior
- priority mapping
- sync-related task engine behavior
- clarify parsing and edge cases
- some UX logic and accessibility-oriented helper behavior

What is less covered:

- full browser flows
- end-to-end state reconciliation
- real LLM integrations under live conditions
- the knowledge base as a cohesive subsystem

There is also an unconventional but useful AI-driven review script:

- `e2e/ai-review.ts`

That script uses Playwright plus an LLM reviewer to generate UX findings and screenshots. It is more like a product-review harness than a traditional e2e regression suite.

## Current Strengths

- Clear product identity and workflow model
- Thoughtful integration of Todoist rather than replacing it
- A real, configurable multi-provider LLM layer
- Rich local task schema that supports more than Todoist alone
- Knowledge base foundation already exists
- Strong product emphasis on trust, undo, and integrity
- Tests cover several important logic-heavy behaviors
- Settings page exposes meaningful operational controls

## Important Caveats And Design-Relevant Gaps

These are the main implementation truths another architecting LLM should keep in mind.

### 1. The codebase is product-rich but unevenly mature

Some areas are deeply thought through and behaviorally rich. Others still have stubs, partially connected features, or implementation gaps.

### 2. Central orchestration is pragmatic, not highly modular

The main API route is intentionally broad. This keeps development simple, but it means architecture discussions should expect a "central app command surface" rather than a set of clean domain services.

### 3. Retrieval quality lags storage richness in the knowledge system

The app stores a lot of memory, but not all stored memory is used equally well at decision time.

### 4. Weekly review persistence appears less complete than daily review persistence

The weekly review experience is present in the UI and generation flow, but the current persistence story appears thinner than for daily reviews.

### 5. Export and admin tooling are uneven

Some export and reset behaviors exist in the UI or settings surface but are still partial or incomplete in practice.

### 6. Some implementation ambitions are only partially realized

Examples include:

- fully uniform action timing across all pages
- complete optimistic local-first reconciliation
- comprehensive trust/integrity coverage for every workflow
- deeper memory retrieval semantics

### 7. Some supporting scripts need scrutiny before relying on them

For example, the current `scripts/seed.ts` pathing should be treated cautiously and verified before assuming it is production-ready.

## Architecture Guidance For Future Work

If another LLM is helping design a feature, these heuristics should guide its proposals:

- Preserve the single-user model unless explicitly asked to change it.
- Preserve Todoist as the operational task/project source of truth unless the goal is a deliberate platform rewrite.
- Prefer small, pragmatic internal patterns over enterprise abstractions.
- Keep secrets, provider calls, and external integration logic server-side.
- Respect the GTD workflow order:
  capture, clarify, organize, engage, reflect.
- Treat trust features as first-class requirements:
  undoability, discrepancy visibility, protected action timing, and low-anxiety UX matter.
- Be careful with priority semantics because the Todoist mapping is intentionally reversed.
- If proposing refactors, preserve current workflow behavior before optimizing structure.
- If proposing memory improvements, focus on retrieval quality and feedback loops, not just additional storage.

## How To Use This Document With Claude Or Another LLM

Recommended handoff pattern:

1. Give the model this file first.
2. Then give it one focused subsystem document, such as `KNOWLEDGE_BASE_INFO.md`.
3. Then give it the specific feature idea, architectural question, or product tension you want help with.

That sequence should let the model reason with:

- the full project frame
- the subsystem-specific realities
- the exact design question at hand

## Suggested Companion Documents

- `KNOWLEDGE_BASE_INFO.md`
  deep dive on how knowledge is written, stored, retrieved, and where it falls short
- `FEATURES.md`
  roadmap and feature tiers
- `burn-down-engine-spec.md`
  aspirational product and UX spec
- `README.md`
  quick project overview and setup

## Read These Files First

If someone needs to inspect code after reading this document, these are the highest-value files to start with:

- `src/lib/db/schema.ts`
- `src/app/api/todoist/route.ts`
- `src/lib/todoist/sync.ts`
- `src/lib/priority/engine.ts`
- `src/lib/llm/router.ts`
- `src/lib/llm/context.ts`
- `src/components/providers/trust-provider.tsx`
- `src/actions/clarify.ts`
- `src/actions/organize.ts`
- `src/actions/reflect.ts`
- `src/app/inbox/page.tsx`
- `src/app/clarify/page.tsx`
- `src/app/engage/page.tsx`
- `src/app/knowledge/page.tsx`
- `src/app/settings/page.tsx`

## Bottom Line

Burn-Down Engine is best understood as a personal AI-augmented execution system built on Todoist, with a strong emphasis on turning messy inputs into trustworthy action and using memory, review, and integrity tooling to keep the system usable over time.

The most important architectural truth is not "it uses LLMs."

It is this:

- the product only works if the user trusts it
- trust depends on sync integrity, reversible actions, and scoped, helpful AI behavior
- almost every meaningful design decision in this repo should be evaluated through that lens
