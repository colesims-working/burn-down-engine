# Burn-Down Engine — Product Roadmap

> A daily-driven GTD intelligence layer. Today it's powered by Todoist. Tomorrow it's the operating system for how knowledge workers get things done.

**Guiding principles:**
- Trust before features. If users can't trust the system with their professional life, nothing else matters.
- Completeness before intelligence. The app must see every task before it can prioritize intelligently.
- Intelligence before analytics. Help people do the work before showing them charts about the work.
- Customer obsession. Every feature earns its place by solving a real problem that real people feel.

---

## Tier 1 — Trust Layer

These ship first. A productivity system that drops tasks or can't be undone is worse than a notebook.

### 1. Universal Undo

Every destructive action in the app should be reversible for at least 10 seconds. Complete a task by accident? Undo. Kill a task during review? Undo. Approve a bad clarification? Undo. Bulk-approve 20 tasks and realize one was wrong? Undo that one.

**What this means concretely:**
- Toast-based undo for: task completion, task deletion/kill, clarify approve/reject, defer, block, bulk operations
- Undo reverses both the local DB state and the Todoist sync (re-open a completed task, restore a deleted one, revert a label change)
- Double-click protection: debounce rapid successive actions on the same target so a broken mouse doesn't complete two tasks
- The `taskHistory` table already tracks every state change — undo leverages this audit trail to restore the previous state

**Why this matters:** The #1 reason people abandon productivity tools is fear of losing track of something. Undo eliminates that fear entirely.

### 2. Task Integrity Monitor

A system-level health check that answers: "Has anything fallen through the cracks?"

**What this means concretely:**
- Periodic background audit that compares Burn-Down's task database against Todoist's live state
- Surface discrepancies: tasks that exist in Todoist but not locally, tasks marked complete locally but still open in Todoist, tasks that have been in `inbox` status for more than 48 hours without being clarified
- A small health indicator in the sidebar/nav (green dot = all clear, amber = minor drift, red = tasks may be missing)
- Accessible detail view: click the indicator to see exactly what's out of sync and one-click resolve each issue
- Stale task detection: flag tasks that have been `active` with no engagement (no completion, no bump, no block) for 14+ days

**Why this matters:** Users need to know — not hope, *know* — that the system has everything. This is the feature that turns "I think I can trust this" into "I know I can trust this."

### 3. Sync Health Dashboard

Visible, glanceable proof that the Todoist integration is working.

**What this means concretely:**
- Persistent display of last sync timestamp (already exists in Settings, but should be ambient — visible from any page)
- Auto-sync on app focus/resume (not just on Inbox page load)
- Sync conflict resolution UI: when a task has been modified in both Todoist and Burn-Down since the last sync, show both versions and let the user pick
- Sync failure notifications: if a push to Todoist fails silently (network error, rate limit), surface it immediately rather than swallowing the error
- Fold the existing sidebar inbox-count context provider optimization into this work (eliminate duplicate API calls between Sidebar and MobileBottomTabs by sharing state)

**Why this matters:** Invisible sync is convenient until it breaks. Visible sync builds confidence.

---

## Tier 2 — Complete GTD Coverage

The app must be the single source of truth for "what should I do next?" If users still have to check Todoist separately, the product has failed.

### 4. Legacy Task Onboarding

Bulk-process all existing Todoist tasks that predate Burn-Down — tasks already scheduled or assigned to projects but never clarified through our system.

**What this means concretely:**
- A dedicated "onboarding" mode in Clarify that pulls all un-enriched tasks (those with `status: null` or missing enrichment fields), grouped by project
- LLM enrichment in batches: priority scoring, time estimates, energy level, context labels, next-action rewording
- User reviews and approves in bulk (same UI as regular Clarify, but with a progress indicator for the full backlog)
- Once processed, tasks appear in Engage with full priority data alongside newly-clarified tasks
- Smart defaults: if a task already has a Todoist priority or due date, preserve those as starting values for the LLM

**Why this matters:** Without this, Engage only shows tasks that entered through our Inbox pipeline, missing the bulk of existing work. Users can't trust a "next action" list that's missing half their tasks.

### 5. Full Task Ingestion in Engage

Engage should pull ALL actionable tasks from Todoist — not just those that came through our Inbox flow.

**What this means concretely:**
- Include scheduled tasks and project tasks directly from Todoist, even if they haven't been enriched yet
- Display un-enriched tasks with a visual indicator ("not yet clarified") so they're still surfaced for execution
- Un-enriched tasks sort by Todoist's native priority and due date until they get full Burn-Down enrichment
- As Legacy Onboarding (#4) processes them, they seamlessly gain full priority/time/energy data
- One-tap "clarify this task" action on any un-enriched task in the Engage view

**Why this matters:** Engage must be the single pane of glass. If a user has to flip between Engage and Todoist to see their full picture, they'll abandon Engage.

### 6. Waiting-For and Delegation Tracker

GTD's "Waiting For" list — elevated from a label hack to a first-class feature.

**What this means concretely:**
- Dedicated "Waiting For" section in the Engage view (already exists as a combined waiting/blocked bucket — separate them for clarity)
- Per-item tracking: who owns it, when you handed it off, expected response date, follow-up cadence
- Automated follow-up nudges: "It's been 5 days since you asked Sarah for the security review. Nudge?" Surfaced during Daily Review or as a notification
- LLM auto-detection: during Clarify, identify tasks that look like waiting-for items (e.g. "Waiting for...", "Follow up with...", "Ping X about...") and auto-suggest tagging them
- Delegation view: filter by person to see everything you're waiting on from a specific individual
- Integration with the People knowledge base — when you delegate to someone, their context notes are available

**Why this matters:** In GTD, the Waiting-For list is how you prevent things from falling into a black hole after you hand them off. Most people track this in their head. That doesn't scale.

### 7. Recurring Task Intelligence

Stop re-clarifying the same recurring task every week. Treat recurrence as a first-class pattern.

**What this means concretely:**
- Recognize returning tasks: when a recurring task reappears in the inbox, match it to its previous clarification and auto-apply the same enrichment (priority, project, labels, time estimate)
- Track completion streaks: "You've completed 'Weekly 1:1 prep' every Monday at 9am for 12 weeks straight"
- Flag broken streaks during Daily Review: "You missed 'Weekly 1:1 prep' — reschedule or skip?"
- Separate recurring tasks in the Engage view so they don't compete with one-off deep work (a "Routines" section)
- Allow users to edit the enrichment template for a recurring task once and have it apply to all future occurrences

**Why this matters:** Recurring tasks are the backbone of most people's productivity. Treating them as new tasks every time wastes time and creates noise.

---

## Tier 3 — Summarize Suite

This is the feature set that makes people say "I need this." Auto-generated accomplishment reports that save hours of painful self-reporting. This is the monetization engine.

### 8. Project Summarize

Select a project + timeframe and get a detailed accomplishment narrative.

**What this means concretely:**
- Timeframe options: last day, last week, last month, last quarter, last semester, last year, all time, or custom date range
- LLM produces: tasks completed, key milestones hit, decisions made (from taskHistory), blockers resolved, time invested (from time estimates), people involved
- Output is a shareable narrative — not bullet points, but prose that reads like a human wrote it
- Export options: formatted for Slack message, email, bullet points, or free-form copy
- Tone selector: casual (standup), professional (1:1 with manager), formal (skip-level or exec review)

**Why this matters:** Nobody likes writing status updates. This writes them for you, grounded in actual task data — not memory.

### 9. Domain Summarize

Same as Project Summarize but scoped to an entire domain — a parent project and all its nested children.

**What this means concretely:**
- e.g. "Microsoft" rolls up Verdict Agent, Phishing Triage Agent, etc.
- Aggregates completions across all sub-projects
- Highlights which sub-projects drove the most output
- Surfaces cross-project patterns and dependencies
- Answers: "What did I ship for [employer/client] this quarter?"

**Why this matters:** Knowledge workers often work across multiple parallel projects for a single stakeholder. Reporting per-project misses the forest for the trees.

### 10. Performance Review Generator

The crown jewel. Full-system accomplishment report that writes your performance review for you.

**What this means concretely:**
- Spans every project and domain for a given timeframe (typically 6 months or 1 year)
- Breaks down by domain/project, ranks where time and effort went
- Highlights top accomplishments with specific details and dates
- Flags projects with zero completions (stalled) — lets you address gaps before your manager does
- Identifies patterns: "You shipped 3 major features in Q1, resolved 12 blockers, and led 2 cross-team initiatives"
- Produces an executive-style narrative suitable for pasting directly into a performance review form
- Supports custom prompting: "Emphasize leadership contributions" or "Focus on technical depth"
- Optional: import your company's review rubric/criteria and map accomplishments to each dimension

**Why this matters:** Performance reviews determine compensation and career trajectory. Most people wing them from memory and undersell themselves. This is backed by 6 months of actual, specific, timestamped accomplishment data. It's the feature people will tell their coworkers about.

---

## Tier 4 — Productivity Intelligence

Features that deepen engagement and make the system smarter over time.

### 11. Project Deep Review

Select a project and let the LLM review all tasks in context of the project goal.

**What this means concretely:**
- LLM sees the full picture: all tasks, their statuses, the project goal, related people, history
- Suggests: consolidate duplicates, split vague tasks into concrete next actions, flag stale items, identify missing steps, reorder by dependency
- More powerful than per-task Clarify because it sees the whole project at once
- Produces a structured "project health report" with specific recommended actions, each one-click actionable

**Why this matters:** Individual task clarification is bottom-up. This is top-down — ensuring the project as a whole makes sense and nothing is missing.

### 12. Focus Time Planner

Turn the task queue into a time-blocked plan.

**What this means concretely:**
- Analyzes your active tasks: priorities, deadlines, energy tags, estimated durations
- Recommends optimal focus blocks: "You have 3 deep-work tasks totaling ~4hrs — block Tuesday morning"
- Calendar integration (Google Calendar, Outlook) to find open slots
- Energy-aware scheduling: high-energy tasks in the morning, low-energy tasks after lunch (based on knowledge base patterns)
- One-click to create calendar events from the recommended plan

**Why this matters:** A prioritized list answers "what should I do?" but not "when should I do it?" This bridges the gap.

### 13. Decision Log Explorer

Surface the decisions already being captured in taskHistory with a searchable, browsable UI.

**What this means concretely:**
- The `taskHistory` table already captures every state change with timestamps — killed, archived, priority changed, deferred, etc.
- Build a searchable timeline view: filter by project, date range, action type, person
- When someone asks "why did we drop that?" six months later, the answer is there
- Pairs with the Summarize features — decisions are included in accomplishment reports
- Optional: LLM-generated decision summaries that explain the reasoning behind a pattern of decisions ("You killed 5 tasks in Project X last month — all were low-priority scope creep items")

**Why this matters:** Decisions are the most valuable output of knowledge work, but they're the first thing forgotten. This is institutional memory for individuals.

---

## Backlog

High-value features that require more infrastructure or design work.

### B1. Velocity Analytics Dashboard
Charts and trends: tasks completed per day/week/month, average time-to-close, completion rate by project/context/energy, throughput trends. Sparklines and heatmaps. The data already exists in `taskHistory` and `dailyReviews` — this is a presentation layer. Answers: "Am I actually getting faster?"

### B2. Custom Review Cadences
Beyond weekly — configure daily standups (auto-generated), monthly strategic reviews, quarterly goal check-ins. Each review type has its own template and LLM prompt tuned to the right altitude. Daily = tactical, monthly = strategic, quarterly = visionary.

### B3. Goal and OKR Alignment
Link projects to quarterly/annual OKRs. Score how much task throughput aligns with stated goals vs. reactive/unplanned work. High value but requires new data input (defining OKRs, linking projects). Needs careful UX to avoid feeling like busywork.

### B4. Platform Abstraction Layer
Decouple the task engine from Todoist. Define a provider interface that Todoist implements, then add adapters for: Microsoft To Do, Things 3, TickTick, Asana, or no provider at all (Burn-Down as the sole task store). This is the path from "Todoist companion" to "standalone productivity OS."

### B5. Performance and PWA
- Page load optimization (lazy loading, route prefetching)
- Organize page: cache project list instead of re-fetching on every load
- `apple-mobile-web-app-capable` meta tag for Add to Home Screen
- Service worker for offline task capture
- Background sync queue for offline-created tasks

### B6. Enhanced Weekly Review
Expand the existing weekly review with: calendar integration (import upcoming commitments), Someday/Maybe list management, and automated "state of the system" health scores. Track when you last completed a review and nudge if overdue.

### B7. OpenRouter Integration
Enable integration with OpenRouter to simplify down to 1 API key if desired. This will also allow more models for
users to work with, including some that we don't have currently like Qwen.

---

## Already Shipped

These features are live and working today:

- **Mobile-Responsive Layout** — Bottom tab bar, touch-optimized actions, responsive pages
- **Natural Language Quick Capture** — Text quick-add + voice brain-dump with Whisper transcription
- **Weekly Review with AI Analysis** — GTD checklist + Claude-powered weekly insights
- **Basic Waiting-For / Blocked Tracking** — Status labels, Todoist comments, Engage bucket
- **Task History Audit Trail** — Every state change logged with timestamps
- **Multi-Model LLM Router** — Per-operation model assignment across Gemini, Claude, and OpenAI
- **Knowledge Base** — Passive knowledge extraction + manual CRUD + people tracking
- **Project Audit** — LLM-powered project health analysis with actionable recommendations
