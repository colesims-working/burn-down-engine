# Nits

Polish items — not broken, but reducing the feeling of quality, trust, and delight.
These are the things that separate "works" from "gorgeous, functional, and fun."

---

## Visual Polish

### NIT-001: Labels display as raw JSON instead of styled badges
**Where:** Engage task cards (NEXT UP bucket)
**Current:** `["work","deep-work"]` — literal JSON string with brackets and quotes
**Expected:** Individual `@work` `@deep-work` chips/badges with subtle background colors, matching the context filter pills at the top of the page.

### NIT-002: Confidence bars in Knowledge entries always show orange/red
**Where:** `/knowledge`
**Current:** All confidence bars render with the same orange-red color regardless of the confidence percentage (90%, 95%, 100% all look the same).
**Expected:** Green for high confidence (>80%), amber for medium (50-80%), red for low (<50%). The color should reinforce the meaning.

### NIT-003: Knowledge entry keys use `snake_case`
**Where:** `/knowledge`
**Current:** Entry keys like `project_acronyms`, `pta_maintenance_needs`, `fitness_schedule_rotation` look like database column names.
**Expected:** Human-readable titles: "Project Acronyms", "PTA Maintenance Needs". The snake_case key can still exist internally but the display should be user-friendly.

### NIT-004: Skeleton loading states have no animation
**Where:** Engage, Organize (initial load)
**Current:** Empty dark rectangles that look like broken UI.
**Expected:** Subtle shimmer/pulse animation to communicate "loading." Even better: skeleton shapes that match the actual card layout (title line, metadata line, buttons).

### NIT-005: Workflow progress dots are hard to read
**Where:** Sidebar, below logo
**Current:** Five tiny dots with subtle color changes (red/orange/gray). Hard to tell which stages are "done" vs "current" vs "upcoming" at a glance.
**Expected:** Larger dots or a more expressive progress indicator. Consider labels on hover, or a mini stepper with stage names.

### NIT-006: Active tab style is too subtle
**Where:** Organize (Projects/Filing), Reflect (Daily/Weekly)
**Current:** The selected tab has a slightly lighter background. Easy to miss which tab is active.
**Expected:** Bolder differentiation — underline, filled background, color change. Match the sidebar's active-page highlight style.

### NIT-007: Priority badge colors don't differentiate urgency
**Where:** Engage cards
**Current:** P1 and P2 both use green circle badges. P3 uses purple. But P1 should feel more urgent than P2.
**Expected:** P1 = red/fire, P2 = orange/amber, P3 = blue, P4 = gray. Color-code urgency intuitively.

### NIT-008: "0% Rate" shown in red at start of day is demotivating
**Where:** `/reflect` Daily Close-Out
**Current:** Shows "0 Completed" (green) / "18 Remaining" (yellow) / "0 Fires" (red) / "0% Rate" (red) at the beginning of every day.
**Expected:** Show "—" or "Start your day!" when no data exists yet. Or show yesterday's closing rate as context. Seeing red numbers before you've had a chance to do anything is a bad UX emotion.

---

## Information Architecture

### NIT-009: Inbox sort control says "Newest" but doesn't explain what's being sorted
**Where:** `/inbox`
**Current:** Button says "Newest" with a sort icon. Unclear if it sorts by creation date, due date, or sync date.
**Expected:** Tooltip or label like "Sort by: Date added (newest first)".

### NIT-010: Engage progress bar "5/22" lacks context
**Where:** `/engage`
**Current:** A progress bar with "5/22" — no label explaining what this means.
**Expected:** "5 of 22 tasks completed today" or similar. First-time users won't know what the numbers represent.

### NIT-011: Inbox task dates are ambiguous
**Where:** `/inbox`
**Current:** Shows dates like "4/3/2026" on some tasks. Is this the date the task was created? When it was synced? Its due date?
**Expected:** Label the date (e.g., small "added" or "due" prefix), or use a distinct icon for due dates vs. sync dates.

### NIT-012: Stale badge shows "37d ago" — unit unclear for new users
**Where:** `/organize` Projects tab
**Current:** "37d ago" — the "d" abbreviation is fine for power users but may confuse new users.
**Expected:** "37 days ago" on first use, or at least a tooltip.

### NIT-013: "444 issues" count is alarming without context
**Where:** Health indicator (sidebar)
**Current:** A red dot with "444 issues" — sounds catastrophic.
**Expected:** Break down into categories: "X stale inbox items, Y stale tasks, Z sync mismatches". The aggregate number without context causes anxiety rather than trust. Consider showing "Attention needed" instead of a raw number for high counts.

---

## Interaction & Responsiveness

### NIT-014: Quick capture "+" button disabled state is unclear
**Where:** `/inbox`
**Current:** The "+" submit button is disabled when the input is empty, but visually looks nearly identical to the enabled state (just slightly dimmer). Enter key works for submit since it's a form.
**Expected:** Clearer disabled/enabled visual distinction. Consider auto-focusing the input on page load.

### NIT-015: Engage "THIS WEEK" tasks have no inline action buttons
**Where:** `/engage`
**Current:** Only "NEXT UP" tasks show Done/Defer/Block buttons. Lower-bucket tasks require clicking to expand, or navigating differently.
**Expected:** All tasks should have quick-action buttons, or at least show them on hover/focus. "THIS WEEK" tasks are still actionable.

### NIT-016: Mobile three-dot menu doesn't have Knowledge/Settings badges
**Where:** Mobile navigation
**Current:** Three-dot menu shows "Knowledge", "Settings", "Log out" as plain text links.
**Expected:** If there are actionable items (e.g., 31 knowledge entries, or settings that need attention), show subtle indicators.

### NIT-017: No visual feedback when Sync button is clicked
**Where:** `/inbox` Sync button
**Current:** Clicking Sync triggers the API but the button doesn't change state (no spinner, no "Syncing..." text).
**Expected:** Button should show a loading spinner while sync is in progress, then briefly show "Synced!" or a checkmark.

### NIT-018: Inbox "Select all (205)" line is crowded
**Where:** `/inbox`
**Current:** "Select all (205) ↕ Newest j/k navigate · space select · a select all" — all on one line.
**Expected:** Keyboard hints could move to a subtle tooltip or be shown only on first visit. The select/sort controls need breathing room.

---

## Typography & Spacing

### NIT-019: Clarify GTD question box is text-heavy on mobile
**Where:** `/clarify` (mobile)
**Current:** The orange GTD questions box takes up nearly half the viewport. Three numbered questions + the AI note is a lot of text above the fold.
**Expected:** Collapse by default after first visit, or show as a dismissible banner.

### NIT-020: Engage card descriptions truncate inconsistently
**Where:** `/engage`
**Current:** Some cards show full 2-line descriptions, others show 1 line. No consistent max-lines.
**Expected:** Consistent 2-line clamp with "..." truncation for long descriptions.

### NIT-021: Organize project list has no visual grouping
**Where:** `/organize` Projects tab
**Current:** All projects in a flat list with Active/Stale badges. Work projects mixed with personal projects.
**Expected:** Group by category (work-primary, personal, side-project) with section headers, since the category field exists in the schema.

### NIT-022: Bottom tab bar icons could benefit from active animation
**Where:** Mobile bottom navigation
**Current:** Active tab is highlighted but static.
**Expected:** Subtle scale or color transition on tap for tactile feedback.
