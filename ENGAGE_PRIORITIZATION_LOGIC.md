# Engage Prioritization Logic

This document explains how Burn-Down Engine currently decides what appears in Engage, how tasks are bucketed and ordered, what data influences that ordering, and where the implementation does not match the apparent product intent.

This is a current-working-tree review, not a description of what the product aspires to do.

If this file is being handed to another LLM, the recommended pairing is:

- `PROJECT_INFO.md` for whole-project context
- `ENGAGE_PRIORITIZATION_LOGIC.md` for Engage-specific sorting and interaction logic

Reviewed sources:

- `src/lib/priority/engine.ts`
- `src/app/engage/page.tsx`
- `src/app/api/todoist/route.ts`
- `src/lib/db/schema.ts`
- `src/lib/llm/prompts/engage.ts`
- `src/lib/llm/context.ts`
- `src/lib/llm/router.ts`
- `src/lib/db/settings.ts`
- `src/lib/todoist/sync.ts`
- `src/actions/engage.ts`
- `src/actions/clarify.ts`
- `src/actions/organize.ts`
- `src/components/providers/trust-provider.tsx`
- `tests/ui-accessibility.test.ts`
- `tests/engine-todoist-sync.test.ts`
- `tests/priority-mapping.test.ts`

## Executive Summary

Engage ordering is a two-stage system:

1. Server-side bucketing in `buildEngageList()`
- tasks are grouped primarily by stored `priority` and `status`
- only P1 and P2 get explicit intra-tier ranking
- P3, P4, Fires, Waiting/Blocked, and Completed Today are not explicitly sorted

2. Client-side display shaping in `src/app/engage/page.tsx`
- context filters are applied
- "Next Up" is built from `fires + mustDo + shouldDo`
- the page then renders sections in a fixed order

The most important implementation truth is this:

- Engage mostly trusts the task records as they already exist in the database
- it does not currently run a comprehensive "recompute priority for every task" pass before display
- there is an unused helper called `assignPriority()`, but it is not actually part of the live Engage pipeline

That means current Engage behavior depends heavily on:

- whatever `priority` was previously assigned
- whatever `status` the task already has
- whether the LLM ranker succeeds for P1 and P2
- the page's local filtering and highlighting rules

## The Actual Pipeline

This is the current end-to-end path used when the Engage page loads.

### Step 1. The page requests Engage data

`src/app/engage/page.tsx` fetches:

- `GET /api/todoist?action=engage`

The API route immediately delegates to:

- `buildEngageList()` in `src/lib/priority/engine.ts`

### Step 2. Deferred tasks may be auto-reactivated

Before building the list, `buildEngageList()` finds tasks where:

- `status === 'deferred'`
- `dueDate <= today`

Those tasks are updated to:

- `status = 'active'`

Nothing else about those tasks is recomputed at this step.

Important implication:

- deferring a task removes it from Engage until its due date arrives
- when the due date arrives, it comes back with whatever `priority` it already had

### Step 3. All non-killed, non-inbox tasks are loaded

The engine loads:

- every task where `status !== 'killed'`
- and `status !== 'inbox'`

This means Engage is broader than "active tasks only."

Tasks with these statuses can still appear in Engage buckets:

- `clarified`
- `organized`
- `active`
- `waiting`
- `blocked`
- `deferred` is excluded from most visible sections, but only because of later filtering
- `completed` can appear in Completed Today

### Step 4. Tasks are bucketed by hard-coded filters

The server creates these arrays:

- `fires`
- `p1`
- `p2`
- `p3`
- `p4`
- `waiting`
- `completed`

The current filters are:

#### `fires`

Included if:

- `priority === 0`
- `status !== 'completed'`
- `status !== 'deferred'`

Notably, Fires do not exclude:

- `waiting`
- `blocked`

So a blocked or waiting P0 task can appear:

- in `fires`
- and also in `waiting`

That means duplicate visibility is possible.

#### `mustDo` candidate pool (`p1`)

Included if:

- `priority === 1`
- status is not `completed`
- status is not `waiting`
- status is not `blocked`
- status is not `deferred`

#### `shouldDo` candidate pool (`p2`)

Included if:

- `priority === 2`
- status is not `completed`
- status is not `waiting`
- status is not `blocked`
- status is not `deferred`

#### `thisWeek` candidate pool (`p3`)

Included if:

- `priority === 3`
- status is not `completed`
- status is not `waiting`
- status is not `blocked`
- status is not `deferred`

#### `backlog` candidate pool (`p4`)

Included if:

- `priority === 4`
- status is not `completed`
- status is not `waiting`
- status is not `blocked`
- status is not `deferred`

#### `waiting`

Included if:

- `status === 'waiting'`
- or `status === 'blocked'`

Priority does not matter for inclusion here.

#### `completed`

Included if:

- `status === 'completed'`
- `completedAt` starts with today's date string

This is a "completed today" section, not all completed tasks.

### Step 5. Only P1 and P2 are explicitly ranked

The engine runs `rankTasksInTier()` for:

- P1
- P2

It does not run this for:

- Fires
- P3 / This Week
- P4 / Backlog
- Waiting / Blocked
- Completed Today

### Step 6. The page builds "Next Up"

On the client, the page constructs:

- `allActive = [...fires, ...mustDo, ...shouldDo]`
- applies context filtering to that combined list
- sets `nextTasks = filteredActive.slice(0, 10)`

Important implications:

- "Next Up" only includes Fires, Must Do, and Should Do
- "This Week" tasks are excluded from Next Up
- Waiting/Blocked tasks are excluded from Next Up
- Completed tasks are excluded from Next Up
- Backlog tasks are excluded from Next Up

### Step 7. The page renders sections in a fixed order

The page displays sections in this order:

1. Fires
2. Must Do
3. Should Do
4. This Week
5. Waiting / Blocked
6. Completed Today

The `backlog` section returned by the engine is not rendered on the Engage page at all.

That means P4 tasks are currently built server-side but effectively hidden from the Engage UI.

## What Data Actually Affects Ordering

### Fields that matter most

These task fields directly affect Engage bucketing or ordering:

- `priority`
- `status`
- `dueDate`
- `bumpCount`
- `completedAt`
- `labels`
- `contextNotes`
- `timeEstimateMin`
- `energyLevel`
- `projectId`
- `title`
- `nextAction`

### What each field is used for

#### `priority`

This is the main top-level bucket selector.

Current meanings:

- `0` = Fire
- `1` = Must Do
- `2` = Should Do
- `3` = This Week
- `4` = Backlog

Without a usable `priority`, most tasks will not land in the main Engage tiers.

#### `status`

Status acts as a second-level include/exclude gate.

For example:

- `waiting` and `blocked` remove P1-P4 tasks from their normal tier sections
- `deferred` hides tasks from the visible action tiers until their due date arrives
- `completed` moves tasks out of action tiers and into Completed Today if finished today

#### `dueDate`

`dueDate` currently affects Engage in only a few direct ways:

- deferred tasks reactivate when `dueDate <= today`
- the P1/P2 LLM ranker can see it
- the fallback sorter uses "has due date or not" as a signal

Important caveat:

- there is no live global rule that says "due today automatically becomes Must Do" in the current active pipeline
- such a rule exists in `assignPriority()`, but that helper is not currently called

#### `bumpCount`

`bumpCount` influences:

- LLM ranking input for P1/P2
- fallback sorting within P1/P2
- anti-pile-up modal behavior after defer actions
- deferral-pattern context given to the Engage ranker

Important caveat:

- there is no live global rule that says "bumped 3 times automatically becomes P1" in the current active pipeline
- again, that exists only in the unused `assignPriority()` helper

#### `labels` and `contextNotes`

These do not affect server-side bucket membership.

They do affect client-side context filtering:

- the page checks whether `labels` or `contextNotes` contain the selected context string
- it also checks labels after removing the `@` prefix

This is simple substring matching, not structured context parsing.

#### `timeEstimateMin`, `energyLevel`, `projectId`, `title`, `nextAction`

These are not used by the hard bucket filters.

They are passed to the P1/P2 ranker and can influence LLM ordering there.

## Where `priority` Comes From

Engage does not compute priority from scratch. It mostly consumes whatever priority already exists.

### Source 1. Clarify

During clarification, the LLM returns a `priority`, and `applyClarification()` writes it to the task.

After a successful push back to Todoist, the task is promoted to `status = 'clarified'`.

That means clarified tasks can appear in Engage even if they are not explicitly marked `active`, because Engage includes all non-inbox, non-killed tasks and then filters by priority/status.

### Source 2. Todoist sync

Newly created local tasks imported from Todoist get priority via:

- `mapFromTodoistPriority()`

Mapping:

- Todoist `4` -> local `1`
- Todoist `3` -> local `2`
- Todoist `2` -> local `3`
- Todoist `1` -> local `4`

Important caveat:

- for existing local tasks, `syncAllTasks()` does not update `priority`
- `syncInbox()` also does not update `priority` for existing inbox items

So once a task exists locally, Engage often treats the local priority as canonical, even if Todoist priority changes later.

### Source 3. Fire handling

Promoting or creating a fire sets:

- `priority = 0`

That immediately affects Engage because Fires are the first bucket considered in the page's active ordering.

### Source 4. Direct local updates

The API has an `update-task` path that can change:

- `priority`
- `status`
- `dueDate`
- other fields

The Engage anti-pile-up modal uses this local update route for some choices.

Important caveat:

- the `update-task` route currently updates the local DB only
- it does not automatically sync those edits to Todoist

That means local Engage ordering can change immediately even when Todoist is not updated.

## Where `status` Comes From

Status is just as important as priority.

Current status entry points include:

- `syncInbox()` sets inbox tasks to `status = 'inbox'`
- leaving the inbox during reconciliation can move tasks to `clarified` or `active`
- `applyClarification()` sets successful tasks to `clarified`
- `syncAllTasks()` creates non-inbox Todoist tasks as `active`
- `bumpTask()` sets `status = 'deferred'`
- `blockTask()` sets `status = 'blocked'`
- `waitTask()` sets `status = 'waiting'`
- `completeTask()` sets `status = 'completed'`
- kill sets `status = 'killed'`

Because Engage excludes only `inbox` and `killed` at the initial fetch stage, many not-fully-active states still remain eligible for later sections.

## P1 and P2 Ranking Logic

Only P1 and P2 use the LLM-based ranking path.

### Input to the ranker

For each task in the tier, the engine sends:

- `id`
- `title`
- `nextAction`
- `projectId`
- `timeEstimateMin`
- `energyLevel`
- parsed `labels`
- `dueDate`
- `bumpCount`

It also sends:

- `Current time: ${currentHour}:00`
- `Priority tier: P${tier}`
- Engage context from `buildContext('', 'engage')`

### What the Engage context contains

The Engage context builder always includes:

- identity context
- current priorities from the knowledge base
- active project summary
- deferral patterns

Because the ranker calls `buildContext('', 'engage')` with an empty input string:

- no people are matched from input
- no projects are matched from input

So the ranker gets broad user/project context, not task-specific context.

### Important constraint on project awareness

The ranking prompt says to consider:

- grouping related project tasks

But the task summaries only include:

- `projectId`

They do not include:

- project name
- project goal
- project notes

The active project summary in context includes project names and goals, but not a mapping from `projectId` to project name.

That means the model can tell that multiple tasks share the same `projectId`, but it cannot reliably know what that project actually is from the task payload alone.

### The ranking prompt

The LLM is told to consider:

- dependencies
- energy matching
- time estimates
- context switching
- quick wins
- meetings or hard commitments

Important caveat:

- the actual task payload does not include enough structured information to fully support all of those dimensions
- for example, there is no meeting/calendar feed here, and no explicit dependency graph

### Model selection

The ranking operation is:

- `rank_tasks`

By default, this uses the primary model assignment, which is currently configured to default to:

- Gemini Flash Lite

This can be overridden in Settings.

### What happens on success

The ranker is expected to return:

- `rankedTaskIds`

The engine then reconstructs the ordered tier by mapping those IDs back to tasks.

### What happens on failure

If the ranking call throws an error, the engine falls back to:

- tasks with a due date before tasks without one
- then higher `bumpCount` before lower `bumpCount`

Important caveat:

- fallback does not sort actual due dates chronologically
- it only prefers "has due date" over "no due date"

### Important validation gap

The engine trusts `rankedTaskIds` almost blindly.

That means:

- duplicate IDs can duplicate tasks in the output
- omitted IDs can make tasks disappear from the ranked tier
- unknown IDs are dropped

There is no post-processing that guarantees:

- every original task appears exactly once

The fallback is only used if the LLM call throws, not if it returns a malformed-but-parseable partial ID list.

## What Is Not Explicitly Sorted

### Fires

`fires` are returned in the order they came back from the database query.

There is no explicit sort by:

- creation time
- urgency
- due date
- updated time

### This Week / P3

`thisWeek` is returned as `p3` with no ranking step.

There is no explicit ordering.

### Backlog / P4

`backlog` is returned as `p4` with no ranking step.

But it is not rendered in the Engage page at all.

### Waiting / Blocked

The waiting section is returned in database order.

There is no explicit sorting by:

- how long it has been blocked
- due date
- person waited on
- project

### Completed Today

The completed section is built by filtering today's completed tasks out of `allTasks`.

There is no explicit sort by:

- completion time
- priority
- original section

So Completed Today is not guaranteed to be newest-first.

## Client-Side Display Logic

After the server sends Engage data, the page changes how it is presented.

### Context filter

The context filter options are:

- `all`
- `@computer`
- `@calls`
- `@office`
- `@home`
- `@errands`
- `@waiting`

Filtering works by substring matching against:

- `labels`
- `contextNotes`

This is not a dedicated context field with structured parsing.

### "Next Up"

The page constructs:

- `allActive = fires + mustDo + shouldDo`
- `filteredActive = filterByContext(allActive)`
- `nextTasks = filteredActive.slice(0, 10)`

Important implications:

- Next Up is effectively a highlight strip, not a separate computed ranking system
- it inherits the order already present in `fires`, `mustDo`, and `shouldDo`
- it ignores `thisWeek`, backlog, waiting, and completed tasks

Important mismatch:

- comments and tests still talk about "Top 5"
- the actual code uses `slice(0, 10)`

So the live UI is a top-10 view, not a top-5 view.

### Duplication behavior

Tasks shown in Next Up are often also shown again in their section lists.

The page only does a narrow dedupe:

- if there is no Fire and there is a `nextTask`, it drops the first Must Do item from the Must Do section

It does not comprehensively remove Next Up tasks from:

- Fires
- the rest of Must Do
- Should Do

So duplication between Next Up and lower sections is expected.

### Waiting and Completed are not context-filtered

The page uses `filterByContext()` for:

- Fires
- Must Do
- Should Do
- This Week

It does not use `filterByContext()` for:

- Waiting / Blocked
- Completed Today

So context filtering changes the action tiers, but not those two bottom sections.

## What Actions Do To Future Engage Ordering

Engage order is heavily path-dependent. Interacting with tasks changes the fields the engine later reads.

### Complete

`completeTask()` sets:

- `status = 'completed'`
- `completedAt = now`

Effect on Engage:

- task leaves Fires / Must Do / Should Do / This Week / Waiting
- task appears in Completed Today if the completion date matches today

### Defer

`bumpTask()` sets:

- `bumpCount += 1`
- `dueDate = tomorrow`
- `status = 'deferred'`

Effect on Engage:

- task disappears from action tiers for now
- it will reactivate automatically when the due date arrives
- when it returns, it keeps its old priority unless something else changed it

If `bumpCount >= 3`, the server returns an `antiPileUp` flag and the page opens an anti-pile-up decision modal.

### Anti-pile-up modal

The modal offers:

- promote
- delegate
- kill
- schedule

Current effects:

- `promote` updates local task to `priority = 1`, `status = 'active'`, `dueDate = null`
- `schedule` updates local `dueDate` and `status = 'active'`
- `delegate` currently uses the Block route with a canned note
- `kill` removes the task from future Engage lists

Important caveat:

- the promote and schedule paths use `update-task`, which is local-only and does not sync to Todoist

### Block

`blockTask()` sets:

- `status = 'blocked'`
- `blockerNote`
- adds a `blocked` label

Effect on Engage:

- P1-P4 tasks leave their normal tier section
- they appear in Waiting / Blocked
- if a blocked task has `priority = 0`, it may still also appear in Fires

### Wait

`waitTask()` sets:

- `status = 'waiting'`
- `blockerNote`
- adds a `waiting-for` label

Effect on Engage:

- same section behavior as blocked tasks

### Fire

`handleFire()` can:

- create a brand-new P0 task
- or promote an existing task to `priority = 0`

Effect on Engage:

- the fire will appear before Must Do and Should Do because the page builds `allActive = fires + mustDo + shouldDo`

Important implementation caveat:

The Fire modal says:

- "The lowest-priority P2 task will be deferred to tomorrow to make room."

But the current server implementation does not actually do that.

Instead, it:

- queries P2 tasks with no explicit sort
- picks the last task in that unsorted list
- increments only `bumpCount`
- does not change `status` to `deferred`
- does not set `dueDate` to tomorrow

So current Fire behavior does not truly make room in the queue the way the UI text suggests.

It also does not exclude P2 tasks that are already:

- blocked
- waiting
- deferred

from the "task to bump" candidate set.

## Dormant Or Unused Logic

There are several signs of intended sophistication that are not fully live in the current Engage pipeline.

### `assignPriority()` exists but is unused

This helper contains rules like:

- blocked or waiting tasks keep their current priority
- due today becomes P1
- bumped 3+ times becomes P1
- existing meaningful priority is preserved
- otherwise default to P4

This sounds important, but it is not currently called anywhere in the current working tree.

So these rules are not the live source of Engage priority assignment.

### `rankWithinTier` exists in the schema but is unused

The task schema includes:

- `rankWithinTier`

And the DB index includes:

- `priority, rankWithinTier`

But current Engage logic does not read or write `rankWithinTier`.

### History action types exist for prioritization/reranking but are not active here

The schema allows task-history actions like:

- `prioritized`
- `reranked`

Current Engage code does not appear to record those actions when building the list.

## Important Edge Cases And Caveats

These are the highest-value truths for architecture work.

### 1. P4 / Backlog exists server-side but is invisible in the page

The engine returns `backlog`, but the page does not render it.

So P4 tasks are effectively hidden from Engage.

### 2. Null priority can make a task disappear

The engine only buckets main tiers with exact comparisons:

- `priority === 0`
- `priority === 1`
- `priority === 2`
- `priority === 3`
- `priority === 4`

So a task that is:

- not completed
- not waiting
- not blocked
- not deferred
- and has `priority = null`

can fail to appear in any Engage section.

### 3. Fires can duplicate with Waiting / Blocked

Because `fires` excludes only `completed` and `deferred`, a P0 blocked/waiting task can appear twice.

### 4. Existing Todoist priority changes may not flow back into Engage

New imports map Todoist priority into local priority.

Existing tasks do not currently get priority refreshed during the main sync paths.

So local Engage ordering can drift away from Todoist.

### 5. The fallback sorter is simple

If the ranker fails, the fallback only prefers:

- any due date over no due date
- then higher bump count

It does not do nuanced chronological or energy-aware sorting.

### 6. The LLM ranking output is not strongly validated

Malformed-but-parseable ranking output can affect visibility, not just order.

### 7. This Week tasks are visible but not part of the main interaction funnel

They appear in their own section, but they do not participate in:

- Next Up
- keyboard-driven top-of-queue interaction
- total planned progress

### 8. Waiting / Completed are lower-visibility informational sections

They are rendered later, not included in Next Up, and not context-filtered.

### 9. The Engage ranker uses broad context, not task-specific retrieval

Because it calls `buildContext('', 'engage')`, it gets:

- identity
- priorities
- active project summary
- deferral patterns

But no task-specific people/project matching from input text.

## Test Coverage Reality

Current test coverage helps with some related logic, but not the full prioritization pipeline.

What is covered:

- priority mapping between local and Todoist
- defer/block/wait/fire sync side effects
- context filter behavior
- Next Up slice behavior at a UI-logic level

What is not strongly covered:

- `buildEngageList()` end-to-end ordering
- malformed `rankedTaskIds` behavior
- unsorted Fires / P3 / Waiting / Completed behavior
- Fire bump-target selection correctness
- duplication between Fires and Waiting
- hidden backlog behavior

## If You Want To Change Engage Safely

These are the safest framing assumptions for future design work.

- Treat `priority` and `status` as the live source of truth for Engage membership today.
- Do not assume `assignPriority()` is currently active.
- Do not assume P3, P4, Waiting, Completed, or Fires have meaningful explicit ordering.
- Do not assume Fire currently makes room correctly.
- Do not assume local and Todoist priority are always in sync.
- If you improve ranking, validate `rankedTaskIds` before reconstructing the tier.
- If you improve visibility, decide intentionally whether P4 should be shown in Engage or elsewhere.
- If you want due-today or anti-pile-up promotion to be real, wire `assignPriority()` or replace it with an explicit live recalculation pass.

## Bottom Line

The live Engage system is best understood as:

- a stored-priority bucket system
- with LLM-assisted ordering only inside P1 and P2
- plus a client-side "Next Up" highlight layer

It is not yet a fully recomputed daily priority engine.

The biggest architectural truth is:

- Engage feels dynamic, but most of its behavior is downstream of previously written fields
- if those fields are stale, partial, or locally divergent from Todoist, Engage will faithfully sort the stale state

That makes future improvements most valuable in three places:

- making priority/status recomputation explicit and reliable
- validating and hardening P1/P2 ranking output
- tightening the match between UI promises and actual action side effects
