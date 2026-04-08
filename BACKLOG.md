# BACKLOG

## Sprint 1 - Clarify Trust and Inbox Stability ✅
Goal: make capture-to-clarify-to-inbox state reliable and predictable.

- [x] Send the full current project list with every clarify call so the model can pick the best existing project.
- [x] Teach clarify that `[merged]` means consolidated input, not literal user intent.
- [x] Fix undo for accidental quick-complete in Inbox so restored tasks immediately reappear in the list.
- [x] Make Inbox ordering stable and deterministic, with a clear default sort.
- [x] Fix the slow re-instruct / re-approve path so counts stay correct while tasks are still processing.
- [x] Fix the case where a task is approved in Clarify but still remains in Inbox after navigation.

## Sprint 2 - Project-First Organize and Execution ✅
Goal: let the user shape project structure and execution order directly.

- [x] Add a per-project execution view where tasks can be manually ordered in the sequence they should be done.
- [x] Add a "Done" action in that project view so the system can learn project-specific priorities and patterns.
- [x] Allow engaging a single project so the user can intentionally work through one project in context.
- [x] Add an AI-assisted project assignment review that proposes tasks to move between projects, with accept / reject controls.
- [x] Add an AI-assisted project merge review that proposes which projects should merge, which project survives, and where tasks should move.

## Sprint 3 - Deterministic Engage ✅
Goal: make Engage feel consistent, controllable, and trustworthy.

- [x] Move more ranking structure into Clarify so Engage can rank deterministically from fields like priority, duration, and urgency class.
- [x] Reduce dependence on non-deterministic LLM ordering in Engage.
- [x] Add savable Engage quick filters for Personal only, Work only, or Both.

## Sprint 4 - Duplicate and Merge UX
Goal: make deduplication understandable and actionable.

- [ ] When suggesting duplicate merges, return a proposed merged task title / destination based on the overlapping work.
- [ ] Improve merged-task suggestions for cases like multiple resume-related tasks collapsing into one clean canonical task.
- [ ] Show duplicate-finder progress while embeddings are still generating so the user knows whether the system is loading or done.

## Sprint 5 - High-Throughput Selection UX
Goal: make bulk task workflows faster for power users.

- [ ] Support shift-select for selecting groups of tasks.
- [ ] Make clicking task text select the task, not just clicking directly on the checkbox.

## Sprint 6 - Embeddings and Structural Discovery
Goal: turn task similarity into something visible and useful.

- [ ] Make the embeddings model user-configurable and testable from Settings.
- [ ] Visualize task embeddings as a graph, similar to the knowledge graph.
- [ ] Use task embedding clusters to suggest project cleanup, project creation, or better grouping of related work.

## Sprint 7 - Architecture and Test Cleanup
Goal: reduce structural drag before adding more intelligence.

- [ ] Split `src/app/api/todoist/route.ts` into separate route files by concern.
- [ ] Straighten the action-vs-route boundary and choose one consistent pattern.
- [ ] Split `e2e/ai-review.ts` into smaller focused modules for smoke checks, screenshot crawling, prompt templates, and report generation.
- [ ] Rewrite low-signal tests that mostly re-implement app logic instead of validating production behavior.

## Sprint 8 - Knowledge Graph Expansion
Goal: make the knowledge system more powerful and more explainable.

- [ ] Add a time-lapse or replay view showing how the knowledge graph grows over time.
- [ ] Explore Switchboard integration with the knowledge graph.
- [ ] Explore CredRank integration with the knowledge graph.
- [ ] Implement graph inference rules such as transitive relationship rules like `works_at + part_of -> works_at`.

## Sprint 9 - Brand and Product Identity
Goal: sharpen the product's presentation and naming.

- [ ] Rename / rebrand "Burn-Down Engine" to something stronger, with "Forge" as the current working candidate.
