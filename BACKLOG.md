# BACKLOG.md

_Claude Code: update this file when you complete items, discover bugs, or identify new work._

---

## Active Sprint

_Nothing active. Pick from Up Next._

---

## Up Next

Prioritized. Top items get pulled into Active Sprint first.

### Cruft Cleanup (do before new features)

Quick wins that reduce repo noise and prevent confusion.

- [x] Delete dead action files: `src/actions/engage.ts`, `src/actions/inbox.ts`, `src/actions/sync.ts`
- [x] Delete orphaned streaming endpoint: `src/app/api/clarify-stream/route.ts`
- [x] Delete unused UI wrappers: `select.tsx`, `dropdown-menu.tsx` (kept `tabs.tsx` — used by knowledge page)
- [x] Remove unused exports: `getModel` and `geminiStream` import in `router.ts` (kept `cosineSimilarity` — used by dedup)
- [x] Remove unused Todoist client methods: `getProject`, `deleteProject`, `getLabels`, `createLabel`, `getComments`, `getTodayTasks`, `TodoistLabel`
- [x] Prune unused Radix packages: removed 9 packages, kept `react-dialog`, `react-tabs`, `react-toast`
- [x] Fix or remove `scripts/seed.ts` — deleted (legacy, knowledge graph replaced it). Updated README.
- [x] Fix or remove `npm run lint` — removed from package.json (no ESLint config)
- [x] Gitignore: added `.playwright-mcp/`, `.claude/settings.local.json`, `e2e/review-report-prev.md`
- [x] Move or delete `archived-images/` — deleted (5.3MB, no references)
- [x] Move shared trust/integrity types — extracted to `src/lib/types/trust.ts`, re-exported from trust-provider
- [x] Archive `burn-down-engine-spec.md` → `docs/burn-down-engine-spec-v1-historical.md`
- [x] Delete `CLAUDE_NITS.md` — already gone

### Sprint 4 — Engage Correctness and Deadline Awareness

- [ ] Due-date visibility and overdue/near-deadline treatment in Engage
- [ ] Deterministic pre-ranking rules before LLM reordering
- [ ] Safer and more validated application of `rankedTaskIds`
- [ ] Explicit ordering for Fires, This Week, Waiting/Blocked, Completed Today sections
- [ ] Clearer fire/bump/deadline interaction model
- [ ] Malformed LLM ranking output cannot silently hide tasks
- [ ] Batch Quick-Complete for Inbox tasks (select a group and quick complete all)

Build on: `src/lib/priority/engine.ts`, `src/app/engage/page.tsx`

### Sprint 5 — Clarify Guardrails (knowledge retrieval portion is DONE)

Knowledge storage, retrieval, and extraction are complete (Phases 1-5). Remaining work:

- [ ] Definition of done and non-goals in clarification output and UI
- [ ] Scope-boundary use in decomposition, organize chat, and prioritization
- [ ] Clarified tasks should have explicit finish lines

Build on: `src/actions/clarify.ts`, `src/app/clarify/page.tsx`

### Sprint 6 — Someday/Maybe and Real Delegation Tracking

- [ ] First-class Someday/Maybe system (not just checklist references)
- [ ] Separate waiting-for from blocked in data handling and UI
- [ ] Delegation metadata: owner, handoff date, follow-up date, cadence
- [ ] Reminders and review hooks for delegated work
- [ ] Weekly review can reactivate or clear Someday/Maybe items

Build on: `src/lib/priority/engine.ts`, `src/app/engage/page.tsx`, `src/app/reflect/page.tsx`

### Sprint 7 — Recurring Work, Quick-Close Intelligence, Better Capture

- [ ] Recurring-task recognition and enrichment reuse
- [ ] Streak tracking and broken-streak detection
- [ ] Proactive inbox recommendations (two-minute tasks, stale tasks, already-done items)
- [ ] Structured natural-language quick-add parsing (dates, priority, labels, context hints)

Build on: `src/lib/todoist/sync.ts`, `src/app/inbox/page.tsx`, `src/app/clarify/page.tsx`

### Sprint 8 — Product Shell, Installability, Frontend Performance

- [ ] Real app metadata, icons, manifest, installability (PWA)
- [ ] Offline capture foundations and background sync queue
- [ ] List virtualization or pagination for large task/project views
- [ ] Polished light/dark theme switching

Build on: `src/app/layout.tsx`, large-list pages

### Sprint 9 — Search, Discoverability, High-Throughput UX

- [ ] Global search across the product (not just Knowledge page)
- [ ] User-controlled clarify batch sizing with time/cost feedback
- [ ] First-run onboarding flow: connect → sync → clarify → engage
- [ ] Keyboard shortcut discoverability and broader coverage
- [ ] Mobile gesture actions for common task operations

### Sprint 10 — Planning Intelligence and Daily Execution Support

- [ ] Context-aware batching suggestions
- [ ] Task-bound timer and elapsed-vs-estimate tracking
- [ ] Calendar-aware focus planning
- [ ] AI daily briefing on open/Engage
- [ ] Quick-action launcher widget

### Sprint 11 — Review, Analytics, Structural Intelligence

- [ ] Project progress and velocity visualization
- [ ] Task-history / activity explorer UI
- [ ] Stronger weekly review synthesis and configurable review cadences
- [ ] Optional goal/OKR linkage
- [ ] Reusable project templates

### Sprint 12 — Reporting, Retention, Delight

- [ ] Project and domain summary generation
- [ ] Performance-review-style accomplishment narratives
- [ ] Stakeholder-specific export formats
- [ ] Optional weekly digest delivery
- [ ] Completion animations and milestone feedback
- [ ] Lightweight gamification on real productivity signals

### Sprint 13 — Multi-User Accounts (Epic — do not bundle with other sprints)

- [ ] Real account system
- [ ] Per-user isolation (database-per-user via Turso)
- [ ] Per-user provider and model settings
- [ ] Migration from single shared-password model

### Sprint 14 — Platform Abstraction (Epic — do not bundle with other sprints)

- [ ] Provider interface for task backends
- [ ] Todoist moved behind that interface
- [ ] Future-provider support without breaking current product

Sprint 15: Create a scripts/product-review.ts script. It should:

Launch Playwright against the running local app
Log in and perform a full workflow cycle: capture 3 tasks → clarify them → file to projects → complete one → defer one → block one → run daily review
Screenshot every page state
Send each screenshot + page HTML to an LLM with this persona prompt:

"You are a ruthlessly honest product reviewer. You have impossibly high standards for software — you believe every pixel matters, every interaction should feel inevitable, and anything that makes the user think twice is a bug. Review this screen and identify: broken functionality, confusing UX, missing affordances, visual inconsistencies, wasted space, unclear copy, and anything that would make a power user lose trust. Be specific. Reference exact elements. Score each issue: critical / annoying / polish."

Compile all findings into a report
Parse the report into structured items and append new ones to the Bugs or Ideas section of BACKLOG.md (deduplicated against existing items)

---

## Bugs

- [x] **Duplicate detection misses semantic duplicates.** Was using Gemini embedding-001 (768d) instead of Qwen3-Embedding-8B (4096d). Switched to `generateEmbedding` from knowledge system.
- [x] **Duplicate view doesn't show both tasks.** Now shows both tasks (A/B) side by side in each duplicate entry. Also labels merge button "Merge (keep richer)".
- [x] **Duplicates show from both sides.** Added canonical pair deduplication using sorted ID pairs — only one entry per pair.
- [x] **Duplicates should handle clusters > 2.** Added union-find clustering — 3+ similar tasks grouped into one entry with numbered tasks.
- [x] **"Merge" action is unclear.** Button renamed "Merge (keep richer)" with tooltip explaining behavior. "Keep All" button also has tooltip.
- [x] **Re-instruct reverts instead of iterating.** Strengthened previous-result prompt: now explicitly says "Only change the specific fields the user asked to change. Keep ALL other fields exactly as they are."
- [x] **Page navigation blocked during background actions.** Added AbortController to inbox sync/load fetches — requests cancel on unmount so navigation is instant.
- [x] **Daily activity graph on Settings bucketing wrong.** `split('T')[0]` returned full timestamp for SQLite `datetime()` format (space-separated). Fixed with `slice(0, 10)`.
- [x] **Global context includes all 37 projects.** Limited to top 5 by `lastActivityAt` in both retrieval.ts and legacy context.ts.
- [x] **Extraction quality varies by model.** Monitoring item — extraction prompt already hardened with concrete JSON examples. String-array issue fixed in Phase 3. Langfuse traces extraction calls for ongoing monitoring.
- [x] **Quick-Completed Tasks Initially Disappear then Reappear.** `fetchTasks()` replaced entire list from server, ignoring `removedIdsRef`. Now filters out removed IDs on every fetch. Combined with earlier fix (sync no longer overwrites completed status to inbox).
- Explain that [merged] means we merged several tasks. Here's an example of how clarify misunderstood: The user noted this is a '[merged]' item, implying it may have been consolidated from previous feedback or drafts.
- Undoing a completed task in Inbox (accidental quick complete) didn't populate it back into list
- Ordering in inbox seems non-deterministic, tasks jump around as different processes complete. We should probably check that we sort based on creation time or something so it doesn't do this.
---

## Ideas (Someday/Maybe)

- Embeddings model should be user-configurable/testable from Settings
- Toggle for Personal-Only, Work-Only, or Both mode in Engage (savable quick filters)
- Task embeddings visualized as a graph (like the knowledge graph) based on similarity
- Task embedding clusters could suggest project cleanup or creation
- Rename/rebrand from "Burn-Down Engine" to something better (working name: "Forge")
- Knowledge graph: time-lapse replay of knowledge growth
- Switchboard integration with knowledge graph
- CredRank integration with knowledge graph
- Phase 6: Graph inference — transitive rules (works_at + part_of → works_at)
- Split `src/app/api/todoist/route.ts` into separate route files by concern (sync, clarify, engage, organize, reflect, knowledge)
- Straighten the action-vs-route boundary (choose one pattern, remove the unused half)
- Split `e2e/ai-review.ts` (1033 lines) into smoke checks, screenshot crawler, prompt templates, report generation
- Rewrite low-signal tests that re-implement logic inside the test file instead of testing production code
- Merged tasks should have a suggested task to merge into drawing from the info in both, so when you suggest to merge 2 or more tasks, the AI should return what the merged task should be. Finish revamping resume + make resume updates + Update Resume should show up in the possible duplicates and it should ask if I want to merge into something like "Complete Resume Updates" or whatever.
- Should duplicate finder show progress on its embeddings generation so we know when it's still working and when it's loaded? Similar to the sync bar?

---

## Completed

- [x] Knowledge Graph Phase 1: Schema & Foundation
- [x] Knowledge Graph Phase 2: Retrieval Engine (4-stage GraphRAG pipeline)
- [x] Knowledge Graph Phase 3: Extraction Everywhere (inline micro-extraction + buffer)
- [x] Knowledge Graph Phase 4: Consolidation Engine (dormancy, dedup, synthesis, rollback)
- [x] Knowledge Graph Phase 5: UI & Observability (graph viz, review queue, consolidation log)
- [x] Sprints 1-3 (verified implemented prior to audit)
- [x] Universal undo and duplicate-click protection
- [x] Task integrity monitor
- [x] Full task ingestion in Engage
- [x] Project deep review (audit flow)

---

## Rules

- Trust the current working tree over older planning language.
- Preserve the single-user, Todoist-first architecture (until Sprint 13/14).
- Build on the trust layer instead of bypassing it.
- Prefer finishing partial systems over starting unrelated new ones.
- Do not combine normal sprints with the multi-user or platform-abstraction epics.
- Do not re-implement verified features listed in Completed.
