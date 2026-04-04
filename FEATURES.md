# Burn-Down Engine - Code-Audited Sprint Roadmap

This file was reviewed against the current codebase on 2026-04-04.

Purpose:

- remove features that already have concrete implementation evidence
- keep only remaining work
- group that work into sprint-sized prompts that are realistic for Claude Code `feature-dev`
- keep one source of truth for future implementation planning

How to use this file:

- copy one sprint section at a time into Claude Code `feature-dev`
- always give Claude [PROJECT_INFO.md](PROJECT_INFO.md)
- also give Claude [ENGAGE_PRIORITIZATION_LOGIC.md](ENGAGE_PRIORITIZATION_LOGIC.md) for Engage-heavy sprints
- also give Claude [KNOWLEDGE_BASE_INFO.md](KNOWLEDGE_BASE_INFO.md) for knowledge-base or memory-heavy sprints
- do not ask Claude to re-implement the verified features listed below

## Verified Implemented In Code

These were removed from future sprint work because there is already concrete implementation evidence in the repo.

### Removed Feature A - Universal Undo and Duplicate-Click Protection

Concrete evidence:

- `src/components/providers/trust-provider.tsx`
- `src/lib/undo/engine.ts`
- `src/app/api/todoist/route.ts` (`action: 'undo'`)
- undo is wired into Inbox, Engage, Reflect, and Clarify-adjacent flows

What already exists:

- undo stack
- 10-second undo toasts
- duplicate-click protection / protected busy windows
- local restore plus Todoist reconciliation paths

### Removed Feature B - Task Integrity Monitor

Concrete evidence:

- `src/components/shared/health-indicator.tsx`
- `src/components/providers/trust-provider.tsx`
- `src/app/api/todoist/route.ts` (`action: 'integrity-check'`)

What already exists:

- periodic integrity checks
- stale inbox detection
- stale active-task detection
- local-vs-Todoist mismatch checks
- navigation health indicator
- issue panel with one-click resolution paths

### Removed Feature C - Full Task Ingestion in Engage

Concrete evidence:

- `src/lib/todoist/sync.ts` (`syncAllTasks()`)
- `src/app/settings/page.tsx` (`Full Sync`)
- `src/lib/priority/engine.ts` (`buildEngageList()` loads all non-`inbox`, non-`killed` tasks)
- `src/app/engage/page.tsx`

What already exists:

- full Todoist task import into local DB
- non-inbox Todoist tasks created as `active`
- Engage built from the broader local task set, not just inbox-born tasks

Important note:

- the remaining work is enrichment and presentation quality, not basic ingestion

### Removed Feature D - Project Deep Review As Originally Written

Concrete evidence:

- `src/actions/organize.ts` (`runProjectAudit()`)
- `src/app/organize/page.tsx` (`LLM Project Audit`)

What already exists:

- project-level audit across tasks and project registry
- LLM-generated health summary
- recommendations with actions
- organize chat follow-up flow

Important note:

- future work should extend this audit, not rebuild a separate project-review feature from scratch

## Verified Foundations To Build On

These are not removed roadmap items, but they already exist and should be extended rather than recreated.

- Sync health visibility, auto-sync-on-focus, and sync failure surfacing already exist
- Keyboard shortcuts already exist in Inbox, Clarify, and Engage
- Quick completion / two-minute-rule actions already exist in Inbox and Clarify
- Weekly review already exists
- Knowledge CRUD, people CRUD, stats, and search already exist
- Model routing, model testing, and per-operation settings already exist
- Task history capture and export already exist
- Mobile navigation and responsive shell already exist

## Implementation Rules

- Trust the current working tree over older planning language
- Preserve the single-user, Todoist-first architecture
- Build on the trust layer instead of bypassing it
- Prefer finishing partial systems over starting unrelated new ones
- Do not combine normal feature sprints with the multi-user or platform-abstraction epics

---

## Sprint 1 - Reliability Completion

Covers remaining work from older items:

- old `1` Proper Loading States, Error Handling, and Mutation Feedback
- old `4` Sync Health Dashboard and Consistent Optimistic Actions, but only the remaining gaps

Read with:

- `PROJECT_INFO.md`

Build on:

- `src/components/providers/trust-provider.tsx`
- `src/components/shared/health-indicator.tsx`
- `src/app/api/todoist/route.ts`
- page-level loaders already present in `src/app/*/page.tsx`

Implement:

- complete loading, error, retry, and offline-aware states across Inbox, Clarify, Organize, Engage, Reflect, Knowledge, Settings, and Login
- finish the remaining optimistic local-first action paths so task actions feel equally fast across pages
- add sync conflict resolution UI for cases where Todoist and Burn-Down diverge on the same task
- standardize mutation success/failure feedback so no action fails silently

Done when:

- there are no silent mutation failures
- every major page has explicit loading and failure handling
- sync conflicts can be surfaced and resolved in-product
- action speed feels consistent across major workflows

---

## Sprint 2 - Diagnostics, Cost Visibility, and Provider Expansion

Covers older items:

- old `5` High-Fidelity Local Logging and Diagnostics
- old `21` Cost and Token Dashboard
- old `40` OpenRouter Integration

Read with:

- `PROJECT_INFO.md`

Build on:

- `src/lib/llm/tracking.ts`
- `src/lib/db/schema.ts` (`llmInteractions`)
- `src/app/settings/page.tsx`
- `src/lib/llm/providers.ts`

Implement:

- richer local diagnostics for task actions, sync attempts, failures, and LLM operations
- a real usage dashboard showing LLM calls, tokens, cost by operation, and historical spend
- budget and cost-visibility controls in Settings
- OpenRouter as an optional provider path integrated with the existing model router

Done when:

- the app has a useful diagnostics trail beyond ad hoc console output
- token/cost reporting reflects real operational usage, not just model-test calls
- OpenRouter can be configured through the same routing model as other providers

---

## Sprint 3 - Ingestion Hygiene and Legacy Backlog Enrichment

Covers older items:

- old `6` Duplicate Detection During Inbox Sync
- old `7` Legacy Task Onboarding

Read with:

- `PROJECT_INFO.md`

Build on:

- `src/lib/todoist/sync.ts`
- `src/app/inbox/page.tsx`
- `src/app/clarify/page.tsx`
- `src/app/settings/page.tsx`

Implement:

- duplicate and near-duplicate detection during inbox sync
- a dedicated onboarding / enrichment workflow for legacy Todoist tasks that were imported but never fully clarified
- bulk enrichment and bulk approval flows for that legacy workload
- clear identification of imported-but-unenriched tasks during onboarding

Done when:

- duplicate spam does not quietly pollute the inbox
- existing Todoist backlogs can be processed into Burn-Down enrichment without manual one-by-one triage
- imported legacy tasks preserve useful Todoist metadata while gaining local enrichment

---

## Sprint 4 - Engage Correctness and Deadline Awareness

Covers older items:

- old `9` Due Date and Deadline Awareness
- old `10` Engage Prioritization Overhaul

Read with:

- `PROJECT_INFO.md`
- `ENGAGE_PRIORITIZATION_LOGIC.md`

Build on:

- `src/lib/priority/engine.ts`
- `src/app/engage/page.tsx`
- `src/lib/llm/prompts/engage.ts`
- `src/lib/llm/context.ts`

Implement:

- due-date visibility and overdue / near-deadline treatment in Engage
- deterministic pre-ranking rules before any LLM reordering
- safer and more validated application of `rankedTaskIds`
- explicit ordering for currently under-sorted sections such as Fires, This Week, Waiting / Blocked, and Completed Today
- a clearer and more correct fire / bump / deadline interaction model

Done when:

- Engage ordering is explainable, testable, and more deterministic
- deadline pressure affects ordering in visible and predictable ways
- malformed LLM ranking output cannot silently hide tasks

---

## Sprint 5 - Knowledge Retrieval and Clarify Guardrails

Covers older items:

- old `11` Knowledge Base Storage and Retrieval Hardening
- old `12` Clarify Scope Boundaries

Read with:

- `PROJECT_INFO.md`
- `KNOWLEDGE_BASE_INFO.md`

Build on:

- `src/lib/llm/context.ts`
- `src/lib/llm/extraction.ts`
- `src/actions/knowledge.ts`
- `src/actions/clarify.ts`
- `src/app/knowledge/page.tsx`

Implement:

- more consistent knowledge write paths and retrieval behavior
- broader use of stored knowledge categories during prompt construction
- `definition of done` and `non-goals` in clarification output and UI
- scope-boundary use in later AI operations such as decomposition, organize chat, and prioritization

Done when:

- stored knowledge comes back more reliably at decision time
- clarified tasks have explicit finish lines and explicit non-goals
- later AI operations can use those boundaries instead of re-expanding task scope

---

## Sprint 6 - Someday / Maybe and Real Delegation Tracking

Covers older items:

- old `13` Someday / Maybe System
- old `14` Waiting-For and Delegation Tracker

Read with:

- `PROJECT_INFO.md`
- `KNOWLEDGE_BASE_INFO.md`

Build on:

- current waiting / blocked statuses in `src/lib/priority/engine.ts`
- `src/app/engage/page.tsx`
- `src/app/reflect/page.tsx`
- `src/app/knowledge/page.tsx`

Implement:

- a first-class Someday / Maybe system instead of checklist references only
- separate waiting-for from blocked in both data handling and UI
- delegation metadata such as owner, handoff date, follow-up date, and cadence
- reminders and review hooks for delegated work

Done when:

- good ideas can be parked without polluting the active queue
- delegated work is trackable as a real workflow, not just a label/status hack
- weekly review can actually reactivate or clear Someday / Maybe items

---

## Sprint 7 - Recurring Work, Quick-Close Intelligence, and Better Capture

Covers older items:

- old `15` Recurring Task Intelligence
- old `16` Inbox Quick Close Recommendations
- old `23` Structured Natural Language Quick Add

Read with:

- `PROJECT_INFO.md`
- `KNOWLEDGE_BASE_INFO.md`

Build on:

- `src/lib/todoist/sync.ts` (`isRecurring`, `recurrenceRule`)
- `src/app/inbox/page.tsx`
- `src/app/clarify/page.tsx`

Implement:

- recurring-task recognition and enrichment reuse
- streak tracking and broken-streak detection
- proactive inbox recommendations for likely two-minute tasks, likely stale tasks, and likely already-done items
- structured natural-language quick-add parsing for dates, priority, labels, and context hints

Done when:

- recurring work stops feeling like brand-new work every time
- the inbox can proactively suggest safe quick closes
- capture text can fill in useful structure immediately

---

## Sprint 8 - Product Shell, Installability, and Frontend Performance

Covers older items:

- old `17` Performance and PWA Foundation
- old `18` Virtual Scrolling and Pagination for Large Lists
- old `41` Theme System

Read with:

- `PROJECT_INFO.md`

Build on:

- `src/app/layout.tsx`
- current mobile layout and nav components
- large-list pages such as Inbox, Clarify, and Organize

Implement:

- real app metadata, icons, manifest, and installability
- offline capture foundations and background sync queue design where practical
- list virtualization or pagination for large task/project views
- polished light/dark theme switching without breaking the existing dark theme

Done when:

- the app feels like a real installable product shell
- large lists do not degrade UX
- theme switching exists and is polished enough for daily use

---

## Sprint 9 - Search, Discoverability, and High-Throughput UX

Covers older items:

- old `19` Search Across the App
- old `20` Batch Size Selector and Safe Bulk Clarify Controls
- old `22` First-Run Onboarding Flow
- old `24` Keyboard-First Power User Mode, but only the remaining gaps
- old `25` Mobile Swipe Actions

Read with:

- `PROJECT_INFO.md`

Build on:

- existing search on `src/app/knowledge/page.tsx`
- existing shortcuts in Inbox, Clarify, and Engage
- current Clarify batching logic in `src/app/clarify/page.tsx`

Implement:

- global search plus per-page search parity beyond the Knowledge page
- user-controlled clarify batch sizing with time/cost feedback
- a first-run onboarding flow from connect -> sync -> clarify -> engage
- keyboard shortcut discoverability and broader shortcut coverage
- mobile gesture actions for common task operations

Done when:

- search works across the product, not just in Knowledge
- new users can reach a first success without guessing the workflow
- power users have faster and more discoverable controls on desktop and mobile

---

## Sprint 10 - Planning Intelligence and Daily Execution Support

Covers older items:

- old `26` Smart Batching Suggestions
- old `27` Focus Timer / Pomodoro
- old `28` Calendar Integration and Focus Time Planner
- old `29` AI Daily Briefing
- old `42` Widget / Quick-Action Launcher

Read with:

- `PROJECT_INFO.md`
- `ENGAGE_PRIORITIZATION_LOGIC.md`

Build on:

- `src/app/engage/page.tsx`
- `src/lib/priority/engine.ts`
- `src/app/reflect/page.tsx`

Implement:

- context-aware batching suggestions
- task-bound timer and elapsed-vs-estimate tracking
- calendar-aware focus planning
- AI daily briefing on open / Engage
- optional lightweight quick-action surface outside the main page shell

Done when:

- the app can help decide not just what to do, but when and how to batch it
- focus sessions can be tracked against tasks
- the user can get oriented faster at the start of the day

---

## Sprint 11 - Review, Analytics, and Structural Intelligence

Covers older items:

- old `31` Project Progress Visualization and Velocity Analytics
- old `32` Decision Log Explorer and Activity Feed
- old `33` Enhanced Weekly Review and Custom Review Cadences
- old `34` Goal and OKR Alignment
- old `35` Template Projects

Read with:

- `PROJECT_INFO.md`

Build on:

- `src/app/organize/page.tsx`
- `src/app/reflect/page.tsx`
- `src/lib/db/schema.ts`
- `taskHistory`, `dailyReviews`, `weeklyReviews`, `projects`

Implement:

- project progress and velocity visualization
- a real task-history / activity explorer UI
- stronger weekly review synthesis and configurable review cadences
- optional goal / OKR linkage
- reusable project templates

Done when:

- the system can show trend and velocity information grounded in real history
- task history is explorable in-product
- reflection and project structure become stronger over time instead of staying static

---

## Sprint 12 - Reporting, Retention, and Delight

Covers older items:

- old `36` Project and Domain Summaries
- old `37` Performance Review Generator
- old `38` Weekly Email Digest
- old `39` Manager and Stakeholder Reporting Formats
- old `43` Completion Animations and Delight
- old `44` Gamification / XP Layer

Read with:

- `PROJECT_INFO.md`

Build on:

- existing review/history data
- LLM router
- task history and project metadata

Implement:

- project and domain summary generation
- performance-review-style accomplishment narratives
- stakeholder-specific export formats
- optional weekly digest delivery
- tasteful completion delight and milestone feedback
- lightweight gamification layered on top of real productivity signals

Done when:

- the system can generate credible accomplishment outputs from real task history
- retention features build on actual productivity data rather than noise
- delight is additive, not distracting

---

## Sprint 13 - Multi-User Accounts Epic

Covers older item:

- old `45` Multi-User Account System with Per-User Provider Configuration

Read with:

- `PROJECT_INFO.md`

Important rule:

- do not bundle this with another normal sprint

Implement:

- real account system
- per-user isolation
- per-user provider and model settings
- migration away from the current single shared-password model

Done when:

- the app can safely support more than one person without cross-user leakage
- settings and provider configuration belong to users, not the whole deployment

---

## Sprint 14 - Platform Abstraction Epic

Covers older item:

- old `46` Platform Abstraction Layer

Read with:

- `PROJECT_INFO.md`

Important rule:

- do not bundle this with another normal sprint

Implement:

- a provider interface for task backends
- Todoist moved behind that interface
- future-provider support without breaking the current product

Done when:

- Todoist is no longer hardwired through the entire app
- the product can evolve from "Todoist-first intelligence layer" toward a broader platform if desired

---

## Notes On Remaining Partial Features

These are intentionally still in the sprint plan because the code only contains partial foundations:

- sync health exists, but sync conflict resolution does not
- keyboard shortcuts exist, but coverage and discoverability are incomplete
- knowledge storage exists, but retrieval quality is still uneven
- waiting / blocked exists, but delegation tracking does not
- recurring-task fields exist, but recurring-task intelligence does not
- quick complete exists, but proactive quick-close recommendations do not
- project health exists, but project progress / velocity visualization does not
- weekly review exists, but custom cadences and richer synthesis do not

## Source Of Truth

If new feature ideas come from Claude, bugs, code review, or product discussion, add them here after checking whether the codebase already contains the feature or a partial foundation for it.
