# ISSUES

Staff-level reliability audit of the current tree on 2026-04-06.

Baseline: `npm test` and `npm run build` are green. The problems below are semantic, architectural, and product-trust issues that can still make the app feel unreliable in real use. All 19 issues verified against the codebase.

## P0 - Trust-Breaking Workflow Bugs

### 1. `syncInbox()` invents local outcomes for anything that leaves Todoist inbox
**Status:** Verified
**Impact:** A task moved, completed, or deleted remotely gets silently promoted to `active` or `clarified` without ever checking its real state. Counts, queues, and next actions become fiction.
**Evidence:** `sync.ts:131-158`. After upserting Todoist inbox tasks, the function queries all local `status='inbox'` tasks. For any whose `todoistId` is missing from the Todoist response, it checks `clarifyConfidence`:
- If truthy → promoted to `clarified` (line 150-152)
- If falsy → promoted to `active` (line 154-157)

No remote lookup. A deleted task silently becomes `active`. A filed-but-unclarified task gets the same treatment. The function can't distinguish "moved to a project" from "deleted."
**Fix:** Before promoting, call `todoist.getTask(local.todoistId)` to verify the real state. If 404 → mark as `needs_reconcile` or `killed`. If alive in a project → leave as-is or defer to `syncAllTasks()`. At minimum, do not promote to `active`/`clarified` without evidence.
**Files:** `src/lib/todoist/sync.ts:131-158`

### 2. Full sync treats every remotely-missing task as `completed`
**Status:** Verified
**Impact:** Remote deletion, permission loss, or API inconsistency gets translated into a fake completion with a fake `completedAt` timestamp. Analytics, recurring enrichment, and undo history are corrupted.
**Evidence:** `sync.ts:302-319`. After processing all tasks from `todoist.getTasks()`, builds a set of Todoist IDs. Any local task with a `todoistId` not in that set gets `status: 'completed', completedAt: now`. The Todoist REST API `getTasks()` only returns *open* tasks — completed and deleted tasks are both absent, but they have completely different semantics.
**Fix:** Introduce a `needs_reconcile` or `external_missing` status. Tasks that disappear from the Todoist response should be flagged for investigation, not auto-completed. Optionally, call `todoist.getTask(id)` for each missing task to determine real state (completed vs deleted vs archived project).
**Files:** `src/lib/todoist/sync.ts:302-319`

### 3. Existing-task sync ignores remote priority changes
**Status:** Verified
**Impact:** The core promise of the app is prioritization, but remote priority edits in Todoist are silently ignored.
**Evidence:** Priority is mapped only on inserts:
- `sync.ts:72`: `priority: mapFromTodoistPriority(tt.priority)` — insert path
- `sync.ts:292`: same — `syncAllTasks` insert path

Priority is ABSENT from all update paths:
- `sync.ts:48-59`: `syncInbox` update — title, description, dueDate, labels, recurrence, but no priority
- `sync.ts:81-91`: `onConflictDoUpdate` — same fields, no priority
- `sync.ts:247-278`: `syncAllTasks` update — diff checks title/desc/projectId/dueDate/labels but not priority; `.set()` block has no priority field

Comment at line 246 says "Only update fields that actually changed from Todoist" — priority is just missing from both the diff check and the write.
**Fix:** Add `priority: mapFromTodoistPriority(tt.priority)` to all three update paths. Include priority in the `changed` diff check at line 255. Decide on conflict resolution: when local AI ranking disagrees with remote Todoist priority, which wins? Recommendation: Todoist priority wins during sync (it's the source of truth), AI ranking adjusts `rankWithinTier` within the tier.
**Files:** `src/lib/todoist/sync.ts:48-59, 81-91, 247-278`

### 4. Many mutation handlers acknowledge success even when Todoist did not update
**Status:** Verified (partially — severity varies by handler)
**Impact:** The app says "done" after a local DB write even when the remote source of truth was never touched.
**Evidence:** Handler-by-handler analysis:
- `kill` (route.ts:836-854): **Worst case.** Todoist failure produces silent 200 with zero warning. No `syncWarning` attached.
- `someday` (route.ts:873-883): No Todoist push at all — silent local-only status change.
- `reactivate` (route.ts:922-929): No Todoist push at all.
- `complete` (route.ts:807-816): Returns `syncWarning` on failure — correctly designed.
- `update-task` (route.ts:943-981): Returns `syncWarning` on failure — correctly designed.
- `delegate` (route.ts:885-919): Returns `syncWarning` on failure — correctly designed.
**Fix:** For `kill`: attach `syncWarning` on Todoist failure (match the `complete`/`update-task` pattern). For `someday`/`reactivate`: decide whether these should sync to Todoist (add labels? update priority?) or explicitly document them as local-only with UI indication.
**Files:** `src/app/api/todoist/route.ts:836-854, 873-883, 922-929`

### 5. Several POST handlers return `200` with empty/undefined payload when no row changed
**Status:** Verified
**Impact:** Client optimistically moves on even though the task never existed, creating UI drift and hiding bugs.
**Evidence:** After `.returning()`, `result[0]` is `undefined` if `WHERE` matched no rows:
- `kill` (route.ts:853): `return NextResponse.json(killed[0])` — no existence guard
- `someday` (route.ts:882): `return NextResponse.json(somedayTask[0])` — no guard
- `reactivate` (route.ts:928): `return NextResponse.json(reactivated[0])` — no guard
- `update-task` (route.ts:964): `updatedTask` can be `undefined`; spreading it produces empty object

Safe handlers: `complete` (throws on missing), `delegate` (has `findFirst` guard with 404), `complete-in-clarify` (has `findFirst` guard with 404).
**Fix:** After every `.returning()`, check `result[0]`. If `undefined`, return `NextResponse.json({ error: 'Not found' }, { status: 404 })`. Pattern already exists in `delegate` handler — apply consistently.
**Files:** `src/app/api/todoist/route.ts:853, 882, 928, 964`

### 6. Fire mode bumps the wrong P2 task
**Status:** Verified
**Impact:** Fire always harms the highest-priority P2 task instead of the lowest.
**Evidence:** `engine.ts:382-394`. The query sorts `desc(t.rankWithinTier)` (line 389). `rankWithinTier=1` is the best-ranked P2 (assigned first in the LLM-ordered array at lines 131-134). Descending order puts the worst (highest number) first. `p2Tasks[p2Tasks.length - 1]` (line 394) picks the LAST element — which in descending order is `rankWithinTier=1`, the BEST P2 task. This is exactly backwards.
**Fix:** Change line 394 to `const toBump = p2Tasks[0]` (take the first element in descending order = worst-ranked = most deferrable). Or change to `asc(t.rankWithinTier)` and keep taking the last element. Add a regression test with ranks 1/2/3 verifying the worst-ranked task is bumped.
**Files:** `src/lib/priority/engine.ts:389, 394`

### 7. Clarify split confirmation can destroy the original task even when replacement tasks fail
**Status:** Verified
**Impact:** Partial child creation still ends by rejecting and completing the parent — can lose work.
**Evidence:** `page.tsx:186-230`. `confirmSplit` uses `Promise.allSettled` (line 187) for child creation. If a child's `createRes.ok` is false, the async function returns (line 194), but `allSettled` never throws — execution always reaches lines 216-228. The original is marked `rejected` (line 218) and completed in Todoist (line 222-228) with `catch {}`. If zero children survived, the user's work is gone.
**Fix:** Count successfully created children before touching the original. Only reject + complete the original if `successCount === proposals.length` (all children survived). If partial, toast a warning and leave the original in `done` state for the user to manually resolve.
**Files:** `src/app/clarify/page.tsx:186-230`

### 8. Filing suggestions can be "accepted" without actually filing to the suggested project
**Status:** Verified
**Impact:** User sees green checkmark but the task didn't move.
**Evidence:** `organize/page.tsx:207-209`. Project resolution: `projects.find(p => p.name === s.suggestedProject)?.id ?? null`. This is strict equality — case-sensitive, no trimming. If LLM returns `"work"` and project is `"Work"`, `projectId` is `null`. Line 212: `if (projectId)` is falsy, so project isn't added to `updateData`. But line 224 runs unconditionally: `setAcceptedIds(prev => new Set(prev).add(s.taskId))` — green checkmark regardless.
**Fix:** Use case-insensitive matching (matching the pattern already used in `clarify.ts:139-141`). If the project still can't be resolved, surface an error instead of marking accepted.
**Files:** `src/app/organize/page.tsx:206-224`

## P1 - Data Integrity And Knowledge-System Correctness

### 9. `runConsolidation({ scope: 'active_only' })` is not actually scoped
**Status:** Verified
**Impact:** Weekly Review expects a light maintenance pass but gets a full dedup + synthesis cycle.
**Evidence:** `consolidation.ts:41`: `const scope = options.scope ?? 'full'`. Written to the DB record at line 53. Never referenced again. `runDormancy` (line 141), `runDeduplication` (line 207), `runSynthesis` (line 317), `runReferenceCleanup` (line 514) all accept only `runId` and `sourceContext` — none accept scope. Weekly Review caller at `reflect.ts:197` passes `{ scope: 'active_only' }` expecting lightweight behavior.
**Fix:** Gate sub-functions on scope: if `active_only`, run only `runDormancy` + `runReferenceCleanup`. Skip `runDeduplication` and `runSynthesis`. These are the expensive operations that shouldn't run on every weekly review.
**Files:** `src/lib/knowledge/consolidation.ts:41, 87-110`, `src/actions/reflect.ts:194-197`

### 10. Consolidation rollback is not a full rollback
**Status:** Verified
**Impact:** After "rollback," retired objects are alive again but their graph edges still point to the survivor.
**Evidence:** Link rewrites at `consolidation.ts:286-297` change `sourceId`/`targetId` on existing links from retired → survivor. No `sourceContext` tagging on rewritten rows. Rollback at lines 586-644: restores statuses (absorbed→active, dormant→active), deletes synthesis objects, deletes `absorbed_into` links — but does NOT restore rewritten link IDs. No record of which links were rewritten.
**Fix:** Record every link rewrite per run (e.g., insert a `link_rewrite_log` entry with `runId`, `linkId`, `oldSourceId`, `oldTargetId`). On rollback, restore original link IDs. Or: tag rewritten links with `sourceContext` so they can be identified and reverted.
**Files:** `src/lib/knowledge/consolidation.ts:285-297, 586-645`

### 11. Dedup merges bypass the invariant-preserving knowledge write path
**Status:** Verified
**Impact:** Merged survivors get a new name and properties without recomputing aliases, dedup identity, embeddings, or evidence.
**Evidence:** `consolidation.ts:258-265`: raw `tx.update(schema.objects).set({...})` — does not call `updateKnowledgeObject()`. When `evaluation.survivorName` differs from `survivor.name`, `canonicalName` and `dedupKey` are not recomputed, `createAlias()` is not called, no embedding regeneration occurs. `updateKnowledgeObject()` at `upsert.ts:436-481` handles all of this correctly.
**Fix:** Route dedup merges through `updateKnowledgeObject()`. Replace the raw `tx.update` with a call to the shared helper (may need to be adapted to accept a transaction context).
**Files:** `src/lib/knowledge/consolidation.ts:258-265`, `src/lib/knowledge/upsert.ts:410-497`

### 12. Synthesis-created knowledge objects are inserted half-formed
**Status:** Verified
**Impact:** Synthesized insights are invisible to vector search, alias lookup, and graph retrieval.
**Evidence:** `consolidation.ts:441-455` provides: type, subtype, name, canonicalName, dedupKey, properties, status, confidence, source, sourceContext. Missing vs the standard path (`upsert.ts:140-173`): no `embedding`, `embeddingModel`, `embeddingText` (invisible to vector search), no `createAlias()` call (unreachable via alias lookup), no `createEvidence()` call (no provenance).
**Fix:** Create synthesis outputs via `upsertKnowledge()` or immediately follow the insert with `createAlias()`, `generateEmbedding()`, and `createEvidence()`.
**Files:** `src/lib/knowledge/consolidation.ts:441-455`, `src/lib/knowledge/upsert.ts:140-173`

### 13. `updateKnowledgeObject()` leaves dedup identity stale on subtype/property-only edits
**Status:** Verified
**Impact:** Subtype or property changes leave the stored `dedupKey` stale, causing future upserts to create duplicates.
**Evidence:** `upsert.ts:437`: `if (updates.name !== undefined && updates.name !== existing.name)` — dedupKey only recomputed inside the name-change branch. But `buildDedupKey()` (`aliases.ts:41-55`) depends on subtype and (for concepts) `properties.key`. Updating subtype at `upsert.ts:456` has no associated dedupKey recompute.
**Fix:** Recompute `dedupKey` whenever name, subtype, or properties change — not just name. Move the `buildDedupKey` call outside the name-change `if` block.
**Files:** `src/lib/knowledge/upsert.ts:436-456`, `src/lib/knowledge/aliases.ts:41-55`

### 14. Knowledge retrieval cache keys can collide for long inputs
**Status:** Verified
**Impact:** Two different long inputs sharing the same first 100 characters get the same cached context.
**Evidence:** `retrieval.ts:62`: `const cacheKey = '${String(page)}:${input.slice(0, 100)}'`. Any inputs differing only after character 100 collide.
**Fix:** Hash the full input: `const cacheKey = '${page}:${simpleHash(input)}'`. A fast hash (e.g., DJB2 or fnv1a) costs nothing and eliminates collisions.
**Files:** `src/lib/knowledge/retrieval.ts:62`

### 15. Retrieval serves stale object snapshots after edits because the object cache is never invalidated
**Status:** Verified
**Impact:** Manual edits, consolidation, reactivation, and deletes leave retrieval using stale embeddings/statuses for up to 2 minutes.
**Evidence:** `retrieval.ts:257-268`: module-level `_objectCache` with 2-minute TTL. No invalidation path exported. No call to clear it from `updateKnowledgeObject()`, `upsertKnowledge()`, or any API route.
**Fix:** Export a `invalidateObjectCache()` function. Call it from `updateKnowledgeObject()`, `upsertKnowledge()`, and the consolidation completion path. Alternatively, version the cache with a monotonic token stored in the knowledge DB.
**Files:** `src/lib/knowledge/retrieval.ts:257-268`

### 16. Duplicate-threshold defaults disagree across the app
**Status:** Verified
**Impact:** Fresh installs use 0.65 (aggressive dedup). After Settings is opened, DB default 0.92 kicks in (conservative). Behavior changes silently with no user action.
**Evidence:**
- `settings.ts:46`: `DEFAULTS.dupeSimilarityThreshold = 0.65`
- `settings.ts:62`: merge fallback uses `?? DEFAULTS.dupeSimilarityThreshold` = 0.65
- `schema.ts:295`: DB column `.default(0.92)`

First run (no settings row): `getAppSettings()` returns 0.65. After Settings page creates the row: DB default 0.92 takes effect.
**Fix:** Define the threshold once in a shared constant. Use 0.85 (balanced) everywhere. Update both `DEFAULTS` and the schema `.default()` to the same value.
**Files:** `src/lib/db/settings.ts:46`, `src/lib/db/schema.ts:295`

### 17. Knowledge object detail view still has an unguarded JSON parse
**Status:** Verified
**Impact:** One malformed `properties` payload on an absorbed source crashes the entire Knowledge page.
**Evidence:** `object-detail.tsx:209`: `const srcProps = JSON.parse(src.properties || '{}')`. Inside a `.map()` over `absorbedSources`. No try/catch. The `|| '{}'` guards against null/empty but not corrupt JSON. A thrown exception inside React render propagates up and crashes the component tree.
**Fix:** `let srcProps: Record<string, unknown> = {}; try { srcProps = JSON.parse(src.properties || '{}'); } catch {}` — matching the pattern already used in `object-list.tsx:116`.
**Files:** `src/app/knowledge/components/object-detail.tsx:209`

## P2 - Recovery, Accounting, And Product Semantics

### 18. Daily review save is not atomic, and some aggregate fields are just wrong
**Status:** Verified
**Impact:** Partial failure leaves task state and review state disagreeing. `fireCount` is always 0.
**Evidence:** `reflect.ts:116-148`: three sequential mutation loops (bump, block, kill) using `await` inside `for...of`. Each loop calls the actual mutation function (which hits the DB and possibly Todoist). The review row write at line 152-180 happens after all mutations. No transaction wraps the sequence. If the process crashes between mutation loop 2 and the review write, applied mutations are permanent but the review record doesn't exist. `fireCount: 0` at line 158 is a literal — never computed from actual fire data.
**Fix:** Wrap the mutation loops + review insert in a transaction. Compute `fireCount` from `db.query.tasks.findMany({ where: eq(priority, 0) })` for the review date. Use `Promise.allSettled` for the mutation loops and record which succeeded.
**Files:** `src/actions/reflect.ts:116-180`

### 19. Undo history lies about what happened
**Status:** Verified
**Impact:** Every undo is logged as `unblocked` regardless of the original action, polluting audit history.
**Evidence:** `undo/engine.ts:107-112`: `action: 'unblocked'` is hardcoded. The comment says "closest enum value for undo operations." The actual `undoneAction` is stored in the `details` JSON blob but the `action` column itself is always `unblocked`.
**Fix:** Add `'undone'` to the `taskHistory` action enum in `schema.ts`. Use `action: 'undone'` in the undo log. The `details` already carries the original action via `undoneAction` — this preserves the full context.
**Files:** `src/lib/undo/engine.ts:107-112`, `src/lib/db/schema.ts` (action enum)

## Suggested Order Of Attack

1. Fix sync truthfulness first: issues 1-5.
2. Fix Fire and Clarify data-loss paths next: issues 6-8.
3. Repair knowledge-write and consolidation invariants: issues 9-17.
4. Clean up review/undo accounting after the product is trustworthy again: issues 18-19.

If this app needs to feel bulletproof for daily use, the sync contract needs to become explicit: one authoritative model for remote truth, one first-class place for "pending local intent," and no silent guessing in between.
