# Burn-Down Engine Cruft Audit

Audited against the current working tree on 2026-04-04.

Goal of this document:

- identify things that are safe to delete
- identify things that are stale or broken and should either be fixed or removed
- separate real code/test coverage from low-signal maintenance weight
- give a cleanup order that reduces risk

Important framing:

- "Cruft" here means dead code, stale files, duplicated layers, generated artifacts living in the repo, or tests/docs that create maintenance drag without giving much protection.
- I am using concrete evidence from the current repo, not just intuition.
- Some items are high-confidence deletion candidates.
- Some items are better treated as refactor or archive candidates rather than immediate deletion.

---

## Executive Summary

Highest-confidence cleanup targets:

1. Unused server-action files:
   - `src/actions/engage.ts`
   - `src/actions/inbox.ts`
   - `src/actions/sync.ts`
2. Unused API route:
   - `src/app/api/clarify-stream/route.ts`
3. Unused generated UI wrapper files:
   - `src/components/ui/tabs.tsx`
   - `src/components/ui/select.tsx`
   - `src/components/ui/dropdown-menu.tsx`
4. Unused helper surface:
   - `src/lib/llm/router.ts:getModel`
   - `src/lib/embeddings/generate.ts:cosineSimilarity`
   - several unused methods on `src/lib/todoist/client.ts`
5. Broken or stale dev paths:
   - `scripts/seed.ts`
   - `npm run lint`
6. Low-signal tests that mostly re-implement logic inside the test file instead of testing production code
7. Local/generated artifacts living in the repo:
   - `.claude/settings.local.json`
   - `.playwright-mcp/`
   - `archived-images/`
   - `e2e/review-report-prev.md`

---

## High-Confidence Removal Candidates

These are the cleanest wins because I found concrete evidence that they are not being used.

### 1. Unused server-action files

Files:

- `src/actions/engage.ts`
- `src/actions/inbox.ts`
- `src/actions/sync.ts`

Evidence:

- Repo-wide action imports only reference:
  - `@/actions/clarify`
  - `@/actions/reflect`
  - `@/actions/organize`
  - `@/actions/knowledge`
- Those imports appear in `src/app/api/todoist/route.ts:8-11`.
- No repo-wide references were found for:
  - `@/actions/engage`
  - `@/actions/inbox`
  - `@/actions/sync`
- `src/actions/engage.ts:16-86` exports a full action surface that is not called.
- `src/actions/inbox.ts:10-77` exports inbox helpers that are not called.
- `src/actions/sync.ts:7-23` exports sync helpers that are not called.

Why this is cruft:

- These files create the appearance of an action layer for Engage/Inbox/Sync, but the live app paths go through `src/app/api/todoist/route.ts` and lower-level libs instead.
- They increase cognitive load and suggest abstractions that are not actually in use.

Recommendation:

- Delete them if you are committed to the `/api/todoist` route pattern.
- Or wire the app to use them directly and remove the duplicated API behavior.
- Do not keep both patterns unless both are actually used.

### 2. Unused streaming clarify endpoint

File:

- `src/app/api/clarify-stream/route.ts`

Evidence:

- No repo-wide references were found for `clarify-stream` or `/api/clarify-stream`.
- `src/app/clarify/page.tsx` talks to `/api/todoist` and `/api/voice`, not this route.
- `src/app/api/clarify-stream/route.ts:13-90` implements a streaming clarify path that appears to be orphaned.

Why this is cruft:

- It is dead endpoint surface area.
- It also keeps `geminiStream` alive as a feature path that the UI does not currently use.

Recommendation:

- Remove it if streaming clarify is not the intended near-term UX.
- If you want streaming clarify later, archive the implementation notes and re-add when the page actually uses it.

### 3. Unused generated UI wrapper files

Files:

- `src/components/ui/tabs.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/dropdown-menu.tsx`

Evidence:

- No repo-wide imports were found for these component paths.
- They are standard generated shadcn/Radix wrappers:
  - `src/components/ui/tabs.tsx:1-55`
  - `src/components/ui/select.tsx:1-160`
  - `src/components/ui/dropdown-menu.tsx:1-200`
- By contrast, `src/components/ui/dialog.tsx` and `src/components/ui/toast.tsx` are actively used.

Why this is cruft:

- These files add maintenance surface and dependency weight without serving the app.
- They also make the component inventory look larger and more standardized than it really is.

Recommendation:

- Remove these three files unless you plan to use them immediately.

### 4. Unused helper exports

#### 4a. Legacy `getModel` helper

File:

- `src/lib/llm/router.ts`

Evidence:

- `src/lib/llm/router.ts:27-34` exports `getModel`.
- No repo-wide usage of `getModel(` was found.

Recommendation:

- Delete it unless you plan to reintroduce a legacy sync-only model lookup path.

#### 4b. Unused `geminiStream` import in router

File:

- `src/lib/llm/router.ts`

Evidence:

- `src/lib/llm/router.ts:1` imports `geminiStream`.
- The file never uses it.

Recommendation:

- Remove the unused import.

#### 4c. Unused vector helper

File:

- `src/lib/embeddings/generate.ts`

Evidence:

- `src/lib/embeddings/generate.ts:45-54` defines `cosineSimilarity`.
- No repo-wide usage was found.
- The comment literally says `future vector search (v2)`.

Recommendation:

- Delete it for now, or move it to an archived note/reference if you want to keep the idea.

### 5. Unused Todoist client methods

File:

- `src/lib/todoist/client.ts`

Evidence:

- The following methods appear only as declarations, with no call sites found elsewhere:
  - `getProject()` at `src/lib/todoist/client.ts:191-193`
  - `deleteProject()` at `src/lib/todoist/client.ts:218-220`
  - `getLabels()` at `src/lib/todoist/client.ts:224-226`
  - `createLabel()` at `src/lib/todoist/client.ts:228-233`
  - `getComments()` at `src/lib/todoist/client.ts:237-239`
  - `getTodayTasks()` at `src/lib/todoist/client.ts:271-273`

Why this is cruft:

- They expand the Todoist surface area your code appears to support, but the app does not currently use them.
- That increases the chance of silent drift when the API changes.

Recommendation:

- Remove the unused methods now.
- Re-add only when a feature truly needs them.

---

## Unused Dependencies or Dependency Weight

These are high-confidence candidates because they either have no usage at all, or are only present to support currently unused files.

### 1. Clearly unused packages

Evidence:

- The following package names appear in `package.json` but not in live source/test usage:
  - `@radix-ui/react-alert-dialog`
  - `@radix-ui/react-label`
  - `@radix-ui/react-accordion`
  - `@radix-ui/react-progress`
  - `@radix-ui/react-separator`
  - `@radix-ui/react-slot`
  - `@radix-ui/react-tooltip`
- Searches only found them in `package.json`, not in `src`, `tests`, or `e2e`.

Recommendation:

- Remove them from `package.json`.

### 2. Packages only supporting currently unused UI wrappers

Evidence:

- `@radix-ui/react-tabs` is used by `src/components/ui/tabs.tsx`, but that wrapper file has no importers.
- `@radix-ui/react-select` is used by `src/components/ui/select.tsx`, but that wrapper file has no importers.
- `@radix-ui/react-dropdown-menu` is used by `src/components/ui/dropdown-menu.tsx`, but that wrapper file has no importers.

Recommendation:

- If you delete the unused wrapper files, remove these packages too.

### 3. Possibly unused Playwright test package

Evidence:

- `package.json:56` includes `@playwright/test`.
- Repo usage found `playwright` in `e2e/ai-review.ts:38`, but not `@playwright/test`.

Recommendation:

- If you are not planning to add actual Playwright test suites, remove `@playwright/test`.
- If you do want browser tests soon, keep it and add a real suite so the dependency earns its keep.

---

## Broken or Stale Scripts / Commands

These are not always "delete immediately" items, but they are definitely maintenance drag.

### 1. `scripts/seed.ts` is stale or broken

Evidence:

- `scripts/seed.ts:16` imports `./src/lib/db/schema`.
- From the `scripts/` directory, that relative path is wrong; it should point outside the directory, not inside it.
- `package.json:15` still advertises `npm run db:seed`.
- `README.md:27-29`, `README.md:76`, and `README.md:85-89` still direct users to use the seed workflow.

Why this matters:

- This is a user-facing setup path documented as standard onboarding.
- Broken setup paths are some of the worst kinds of cruft because they waste time and damage trust.

Recommendation:

- Either fix the script and keep the flow, or remove the documented seed flow until it is real again.

### 2. `npm run lint` is effectively stale

Evidence:

- `package.json:10` defines `lint` as `next lint`.
- No ESLint config file was found.
- No ESLint packages were found in `package.json`.
- Running `npm run lint` opened the interactive Next.js ESLint setup prompt instead of linting.

Why this matters:

- A repo script that looks official but does not actually run is cruft.

Recommendation:

- Either set up ESLint properly, or remove the `lint` script until you do.

---

## Low-Signal Test Cruft

These files are not all worthless, but a meaningful part of this test suite is not testing production code. It is testing logic recreated inside the test file.

That means:

- the tests can stay green while the real app breaks
- the tests create a false sense of safety
- the maintenance cost is real, but the protection is weak

### High-confidence rewrite-or-delete candidates

#### 1. `tests/inbox-sort.test.ts`

Evidence:

- `tests/inbox-sort.test.ts:22-28` defines its own local `sortTasks()` function instead of importing production code.

Assessment:

- This is a specification example, not a real regression test.

#### 2. `tests/confirm-dialog.test.ts`

Evidence:

- `tests/confirm-dialog.test.ts:18-25` defines local props/config builders.
- The file never imports the real component.

Assessment:

- This is effectively testing made-up configuration objects, not app behavior.

#### 3. `tests/clarify-validation.test.ts`

Evidence:

- `tests/clarify-validation.test.ts:37-38` defines a local `filterSubtasks`.
- `tests/clarify-validation.test.ts:92-112` defines a local clarification object factory.

Assessment:

- These are useful notes about desired validation behavior, but not strong regression tests.

#### 4. `tests/clarify-operations.test.ts`

Evidence:

- `tests/clarify-operations.test.ts:18-22` defines local completion logic.
- `tests/clarify-operations.test.ts:81-85` defines local undo logic.
- `tests/clarify-operations.test.ts:207-213` defines local batching logic.
- `tests/clarify-operations.test.ts:251-272` defines local sanitize logic.

Assessment:

- Much of this file is re-implementing business logic in the test body instead of importing production helpers.

#### 5. Large portions of `tests/ui-accessibility.test.ts`

Evidence:

- `tests/ui-accessibility.test.ts:34-35` defines local pluralization logic.
- `tests/ui-accessibility.test.ts:68-73` defines local search filtering logic.
- `tests/ui-accessibility.test.ts:272-278` defines local project-health label logic.
- `tests/ui-accessibility.test.ts:315-325` defines local inbox alert severity/message logic.

Assessment:

- Parts of this file are valuable as product rules, but many sections are closer to documentation/spec assertions than to tests of the actual implementation.

### Tests that look worth keeping

These appear to exercise real production modules and are not obvious cruft:

- `tests/todoist-client.test.ts`
- `tests/push-to-todoist.test.ts`
- `tests/engine-todoist-sync.test.ts`
- `tests/priority-mapping.test.ts`

Recommendation:

- Keep the real module tests.
- Rewrite the low-signal tests so they import pure helpers from production code, or replace them with browser/component tests that observe real UI behavior.

---

## Generated / Local Artifact Cruft

These are not source code, but they are currently cluttering the repo and should be archived, ignored, or moved out of the project root.

### 1. `.claude/settings.local.json`

Evidence:

- `.claude/settings.local.json:1-20` contains local permission settings and machine-specific paths.

Why this is cruft:

- This is per-user, per-machine tooling state.
- It should not be part of shared project source.

Recommendation:

- Ignore `.claude/` or at least `settings.local.json`.

### 2. `.playwright-mcp/`

Evidence:

- The directory contains many local console logs and page YAML snapshots.
- One file is over 1 MB.
- `.gitignore` does not currently ignore `.playwright-mcp/`.

Why this is cruft:

- These are transient local debugging artifacts.

Recommendation:

- Add `.playwright-mcp/` to `.gitignore`.
- Delete the directory contents locally when not needed.

### 3. `archived-images/`

Evidence:

- `archived-images/` contains 66 `.png` files totaling about 5.3 MB.
- No repo references to these archived image names were found.

Why this is cruft:

- These are not part of the running app.
- They are asset archive material living in the main repo root.

Recommendation:

- If you want to keep them, move them to an external archive or a clearly ignored `docs-archive/` style location.
- If they are no longer useful, delete them.

### 4. `e2e/review-report-prev.md`

Evidence:

- `e2e/ai-review.ts:48` explicitly treats this as a previous generated report.
- `.gitignore` ignores:
  - `e2e/screenshots/`
  - `e2e/review-report.md`
- But it does not ignore `e2e/review-report-prev.md`.

Why this is cruft:

- It is an output artifact, not source.

Recommendation:

- Ignore it the same way you ignore the current review report.

### 5. Build artifacts in the workspace

Examples:

- `.next/`
- `node_modules/`
- `tsconfig.tsbuildinfo`

Assessment:

- These are normal local artifacts, not source cruft.
- They are already ignored or intended to stay ignored.

Recommendation:

- No code action needed, but they reinforce that the repo has a lot of local workspace noise and should keep `.gitignore` disciplined.

---

## Structural Cruft / Refactor Targets

These are not "delete today" items, but they are real maintenance drag.

### 1. Monolithic catch-all API route

File:

- `src/app/api/todoist/route.ts`

Evidence:

- 502 lines long.
- Handles inbox, engage, projects, knowledge, people, settings, integrity, undo, clarify, organize, reflect, model tests, and sync logic.

Why this is cruft:

- It is acting as multiple APIs and orchestration layers in one place.
- That makes it hard to navigate, hard to test, and easy to accidentally grow.

Recommendation:

- Split by concern:
  - sync
  - clarify
  - engage
  - organize
  - reflect
  - knowledge/settings

### 2. Server route importing UI-layer types

Evidence:

- `src/app/api/todoist/route.ts:15` imports `IntegrityIssue` and `IntegrityLevel` from `src/components/providers/trust-provider.tsx`.

Why this is cruft:

- It couples server code to a React component/provider file.
- Even though type-only imports disappear at runtime, the layering is backwards.

Recommendation:

- Move shared trust/integrity types into a `src/lib/...` or `src/types/...` module.

### 3. Mixed action/API boundaries

Evidence:

- `src/app/api/todoist/route.ts` imports some server-action modules (`clarify`, `reflect`, `organize`, `knowledge`) but bypasses other action files entirely.
- Meanwhile `src/actions/engage.ts`, `src/actions/inbox.ts`, and `src/actions/sync.ts` exist but are unused.

Why this is cruft:

- The architecture suggests one abstraction, but the app actually uses another.
- That kind of half-migration is classic cruft.

Recommendation:

- Choose one clear pattern:
  - pages call server actions directly
  - or pages call typed route handlers
- Then remove the unused half.

### 4. `e2e/ai-review.ts` is a giant single-file harness

Evidence:

- 1033 lines long.
- Handles env loading, login, smoke checks, screenshot crawling, test data seeding, cleanup, persona prompts, synthesis, and markdown report generation all in one file.

Why this is cruft:

- It is high-maintenance and brittle.
- It hardcodes UI copy such as `Urgent Interrupt`, `Do Now`, and route-specific expectations.
- It also generates artifacts that accumulate in the repo.

Recommendation:

- Split into:
  - smoke checks
  - screenshot crawler
  - prompt templates
  - report generation
- Or archive it if this review flow is no longer core to development.

---

## Documentation Cruft / Drift Candidates

These are not obvious deletions, but they are likely to drift or duplicate one another.

### 1. Historical spec vs living docs

File:

- `burn-down-engine-spec.md`

Evidence:

- 1783 lines long.
- Header says:
  - `Technical & Design Specification v1.0`
  - dated February 23, 2026
  - `Status: Locked for v1 Development`
- The repo also now contains living overview docs such as:
  - `PROJECT_INFO.md`
  - `KNOWLEDGE_BASE_INFO.md`
  - `ENGAGE_PRIORITIZATION_LOGIC.md`
  - `FEATURES.md`

Why this may be cruft:

- The historical spec is likely useful for context, but it is not a safe operational source of truth anymore.
- It risks drift against code and against the newer LLM-oriented docs.

Recommendation:

- Keep it only if explicitly marked `historical` or `design archive`.
- Otherwise it will compete with the living docs.

### 2. Review output vs roadmap/nits docs

Files involved:

- `e2e/review-report-prev.md`
- `CLAUDE_NITS.md`
- `BUGS.md`

Assessment:

- `CLAUDE_NITS.md` and `BUGS.md` look like active product-tracking docs.
- `e2e/review-report-prev.md` is generated output.
- Generated review output should not live beside curated roadmap docs as if it has equal status.

Recommendation:

- Archive or ignore generated review outputs.
- Keep curated docs only.

---

## What I Would Not Call Cruft

These may be imperfect, but they are clearly live:

- `src/actions/clarify.ts`
- `src/actions/reflect.ts`
- `src/actions/organize.ts`
- `src/actions/knowledge.ts`
- `src/components/ui/dialog.tsx`
- `src/components/ui/toast.tsx`
- `src/lib/voice/whisper.ts`
- `src/lib/undo/engine.ts`
- `src/components/providers/trust-provider.tsx`
- `src/components/shared/health-indicator.tsx`
- `tests/todoist-client.test.ts`
- `tests/push-to-todoist.test.ts`
- `tests/engine-todoist-sync.test.ts`
- `tests/priority-mapping.test.ts`

---

## Recommended Cleanup Order

### Phase 1: Zero-risk repo hygiene

- Ignore or remove `.playwright-mcp/`
- Ignore or remove `.claude/settings.local.json`
- Ignore `e2e/review-report-prev.md`
- Decide whether `archived-images/` belongs in the repo at all

### Phase 2: Delete confirmed dead code

- Remove:
  - `src/actions/engage.ts`
  - `src/actions/inbox.ts`
  - `src/actions/sync.ts`
  - `src/app/api/clarify-stream/route.ts`
  - `src/components/ui/tabs.tsx`
  - `src/components/ui/select.tsx`
  - `src/components/ui/dropdown-menu.tsx`
- Remove unused exports and unused Todoist client methods

### Phase 3: Prune dependencies

- Remove definitely unused Radix packages
- Remove packages only supporting deleted wrapper files
- Reassess whether `@playwright/test` should stay

### Phase 4: Fix or remove stale scripts

- Fix `scripts/seed.ts` or remove the seed flow from docs/scripts
- Set up ESLint properly or remove `npm run lint`

### Phase 5: Rewrite low-signal tests

- Replace tests that re-implement logic locally
- Keep the real module tests
- Move product rules into production helpers if you want to test them directly

### Phase 6: Structural cleanup

- Split `src/app/api/todoist/route.ts`
- straighten the action-vs-route boundary
- move shared types out of UI files
- archive or relabel historical docs

---

## Bottom Line

If you want the shortest high-value cleanup list, start here:

1. Remove unused actions, unused clarify stream route, and unused UI wrappers.
2. Prune the now-unused dependencies.
3. Fix or remove `db:seed` and `lint` so package scripts stop lying.
4. Ignore the local/dev artifact directories and generated review outputs.
5. Rewrite the low-signal tests that currently assert copied logic instead of production behavior.

That would meaningfully reduce repo noise without touching the core product.
