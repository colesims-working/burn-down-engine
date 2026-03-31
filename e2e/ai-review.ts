/**
 * AI Site Reviewer — Playwright + Claude Vision
 *
 * Systematically crawls every page at desktop + mobile viewports,
 * performs safe (read-only, idempotent) interactions, captures screenshots,
 * then sends them to Claude for structured UX/accessibility/functional review.
 *
 * Usage:
 *   APP_PASSWORD=yourpass npx tsx e2e/ai-review.ts
 *
 * Reads .env.local automatically for ANTHROPIC_API_KEY.
 * Set APP_PASSWORD env var to your login password.
 */

import fs from 'fs';
import path from 'path';

// ─── Load .env.local before anything that reads env ───────────
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].split('#')[0].trim();
    }
  }
}

import { chromium, type Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';

// ─── Config ───────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.APP_PASSWORD || '';
const MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-4-20250514';
const OUTDIR = path.join(process.cwd(), 'e2e', 'screenshots');
const REPORT = path.join(process.cwd(), 'e2e', 'review-report.md');

// ─── Page Definitions ─────────────────────────────────────────
// Each page declares its purpose, CRUD surface, and safe interactions.
// Interactions must be idempotent (no creates, updates, or deletes).

interface Interaction {
  label: string;
  action: (p: Page) => Promise<void>;
}

interface PageDef {
  route: string;
  name: string;
  crud: string;
  interactions: Interaction[];
}

const safe = (fn: (p: Page) => Promise<void>): ((p: Page) => Promise<void>) =>
  async (p) => { try { await fn(p); } catch {} };

const PAGES: PageDef[] = [
  {
    route: '/login',
    name: 'Login',
    crud: 'Auth only — password input, submit. No data CRUD.',
    interactions: [
      { label: 'focus-password', action: safe(async p => {
        await p.locator('input[type="password"]').focus();
      })},
    ],
  },
  {
    route: '/inbox',
    name: 'Inbox',
    crud: 'CREATE: quick-add form + voice capture. READ: task list from Todoist. DELETE: multi-select + delete. SYNC: pull from Todoist.',
    interactions: [
      { label: 'focus-capture', action: safe(async p => {
        await p.locator('input[placeholder="Quick capture..."]').focus();
      })},
    ],
  },
  {
    route: '/clarify',
    name: 'Clarify',
    crud: 'READ: pending inbox tasks. UPDATE: AI clarification → approve/edit/reject. CREATE: subtasks from decomposition. DELETE: reject back to inbox, mark already-done. Interactions: individual checkboxes, process selected, approve, un-approve, inline edit, reject, mark complete.',
    interactions: [
      { label: 'toggle-first-checkbox', action: safe(async p => {
        await p.locator('button.shrink-0').first().click();
      })},
    ],
  },
  {
    route: '/organize',
    name: 'Organize',
    crud: 'READ: projects + filing suggestions. UPDATE: accept/change/skip filing. Tabs: Projects, Filing.',
    interactions: [
      { label: 'filing-tab', action: safe(async p => {
        await p.locator('button:has-text("Filing")').click();
        await p.waitForTimeout(1000);
      })},
      { label: 'back-to-projects', action: safe(async p => {
        await p.locator('button:has-text("Projects")').click();
        await p.waitForTimeout(500);
      })},
    ],
  },
  {
    route: '/engage',
    name: 'Engage',
    crud: 'READ: prioritized task list (fires, must-do, should-do, this-week, waiting). UPDATE: complete, defer, block, kill. CREATE: fire incoming. Sections expand/collapse.',
    interactions: [
      // Try expanding a task card
      { label: 'expand-first-task', action: safe(async p => {
        const card = p.locator('[class*="rounded-xl"][class*="border"]').first();
        if (await card.count() > 0) await card.click();
      })},
    ],
  },
  {
    route: '/reflect',
    name: 'Reflect',
    crud: 'READ: daily stats + completed/incomplete lists. UPDATE: bump/block/kill/schedule actions. CREATE: observations, save review. Tabs: Daily Close-Out, Weekly Review.',
    interactions: [
      { label: 'weekly-tab', action: safe(async p => {
        await p.locator('button:has-text("Weekly Review")').click();
        await p.waitForTimeout(1000);
      })},
      { label: 'daily-tab', action: safe(async p => {
        await p.locator('button:has-text("Daily Close-Out")').click();
        await p.waitForTimeout(500);
      })},
    ],
  },
  {
    route: '/knowledge',
    name: 'Knowledge',
    crud: 'Full CRUD: CREATE entries/people, READ with search + category filter, UPDATE via edit dialog, DELETE. Tabs: Knowledge, People.',
    interactions: [
      { label: 'people-tab', action: safe(async p => {
        await p.locator('button:has-text("People")').click();
        await p.waitForTimeout(1000);
      })},
      { label: 'focus-search', action: safe(async p => {
        await p.locator('input[placeholder*="Search"]').focus();
      })},
    ],
  },
  {
    route: '/settings',
    name: 'Settings',
    crud: 'READ: current model config + sync state. UPDATE: model selection, thresholds, disable toggles. TEST: per-model test button. EXPORT: knowledge/history download.',
    interactions: [
      // Scroll to bottom to capture everything
      { label: 'scrolled', action: safe(async p => {
        await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await p.waitForTimeout(500);
      })},
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────
interface Screenshot { label: string; filepath: string }
interface PageResult {
  def: PageDef;
  screenshots: Screenshot[];
  consoleErrors: string[];
  redirectedTo: string;
}

// ─── Crawl ────────────────────────────────────────────────────
async function crawlPage(page: Page, def: PageDef, viewport: string): Promise<PageResult> {
  const screenshots: Screenshot[] = [];
  const consoleErrors: string[] = [];

  const onConsole = (msg: any) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  page.on('console', onConsole);

  await page.goto(`${BASE_URL}${def.route}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  // Wait for skeleton loaders to clear
  await page.waitForFunction(
    () => document.querySelectorAll('.animate-pulse').length === 0,
    { timeout: 10000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);

  const redirectedTo = page.url();

  // Initial screenshot
  const initPath = path.join(OUTDIR, `${def.name.toLowerCase()}-${viewport}.png`);
  await page.screenshot({ path: initPath, fullPage: true });
  screenshots.push({ label: `${viewport}`, filepath: initPath });

  // Run interactions (desktop only — mobile is layout-focused)
  if (viewport === 'desktop') {
    for (const ix of def.interactions) {
      await ix.action(page);
      await page.waitForTimeout(600);
      const fp = path.join(OUTDIR, `${def.name.toLowerCase()}-${ix.label}.png`);
      await page.screenshot({ path: fp, fullPage: true });
      screenshots.push({ label: ix.label, filepath: fp });
    }
  }

  page.off('console', onConsole);
  return { def, screenshots, consoleErrors, redirectedTo };
}

// ─── Claude Review ────────────────────────────────────────────
function makeImages(shots: Screenshot[]) {
  return shots.map(s => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/png' as const,
      data: fs.readFileSync(s.filepath).toString('base64'),
    },
  }));
}

async function reviewPage(client: Anthropic, result: PageResult): Promise<string> {
  const labels = result.screenshots.map(s => s.label).join(', ');
  const errors = result.consoleErrors.length ? result.consoleErrors.join('\n') : 'None';

  const prompt = `You are a senior UX engineer and accessibility specialist reviewing a dark-theme GTD task management app (Next.js + Tailwind + shadcn/ui).

PAGE: "${result.def.name}" (${result.def.route})
ACTUAL URL: ${result.redirectedTo}
SCREENSHOTS: ${labels}
CONSOLE ERRORS: ${errors}
CRUD SURFACE: ${result.def.crud}

Review these screenshots thoroughly for:

1. **VISUAL** — Layout bugs, alignment, spacing, contrast, dark theme, typography hierarchy, visual clutter
2. **UX** — Interaction clarity, affordances, state feedback, cognitive load, destructive-action safety, discoverability
3. **ACCESSIBILITY** — Labels, focus indicators, color-only info, touch targets, screen reader concerns
4. **FUNCTIONAL** — CRUD completeness for this page, empty states, error states, loading indicators
5. **RESPONSIVE** — Mobile layout, text overflow, touch targets, horizontal scroll
6. **ROBUSTNESS** — Double-click safety (idempotency), error recovery, stale data handling

For each finding:
**[CRITICAL|HIGH|MEDIUM|LOW]** Category: Specific description → Concrete recommendation

End with **What's working well** (2-3 observations).`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: [...makeImages(result.screenshots), { type: 'text', text: prompt }] }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

async function reviewHolistic(client: Anthropic, results: PageResult[]): Promise<string> {
  // One desktop screenshot per page (skip login)
  const images = results
    .filter(r => r.def.route !== '/login' && r.screenshots.length > 0)
    .map(r => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: fs.readFileSync(r.screenshots[0].filepath).toString('base64'),
      },
    }));

  const prompt = `You are reviewing a complete GTD (Getting Things Done) workflow app. These screenshots show every page in workflow order: Inbox → Clarify → Organize → Engage → Reflect → Knowledge → Settings.

The GTD pipeline: Capture (Inbox) → Clarify (AI enrichment) → Organize (project filing) → Engage (daily execution) → Reflect (review).

Review the WHOLE APPLICATION:

1. **NAVIGATION** — Is the GTD workflow clear? Can users tell where they are and what comes next?
2. **CONSISTENCY** — Button styles, card patterns, colors, spacing, typography — consistent across pages?
3. **INFORMATION ARCHITECTURE** — Sidebar intuitive? Each page's purpose obvious at a glance?
4. **WORKFLOW COMPLETENESS** — Gaps in the GTD pipeline? Missing transitions between stages?
5. **VISUAL COHERENCE** — Does it feel like one product? Color palette, spacing system, icon usage?
6. **DATA LIFECYCLE** — Can users trace a task from inbox to completion? Is every CRUD path reachable?
7. **TOP 5 IMPROVEMENTS** — Highest-impact changes to make this a reliable daily-driver app.

Format: **[CRITICAL|HIGH|MEDIUM|LOW]** Description → Recommendation`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt }] }],
  });
  return res.content[0].type === 'text' ? res.content[0].text : '';
}

// ─── Report ───────────────────────────────────────────────────
function buildReport(
  reviews: { name: string; review: string }[],
  holistic: string,
  results: PageResult[],
): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const shots = results.reduce((n, r) => n + r.screenshots.length, 0);
  const errors = results.flatMap(r => r.consoleErrors);

  let md = `# AI Site Review — ${now}\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Target | \`${BASE_URL}\` |\n`;
  md += `| Model | \`${MODEL}\` |\n`;
  md += `| Pages | ${results.length} |\n`;
  md += `| Screenshots | ${shots} |\n`;
  md += `| Console Errors | ${errors.length} |\n\n`;

  if (errors.length > 0) {
    md += `## Console Errors\n\n`;
    for (const e of errors) md += `- \`${e}\`\n`;
    md += '\n';
  }

  md += `---\n\n## Page-by-Page Review\n\n`;
  for (const { name, review } of reviews) {
    md += `### ${name}\n\n${review}\n\n---\n\n`;
  }

  md += `## Holistic Review\n\n${holistic}\n`;
  return md;
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🔍 AI Site Reviewer');
  console.log(`   URL:   ${BASE_URL}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Auth:  ${PASSWORD ? 'yes' : 'SKIPPED — set APP_PASSWORD for authenticated pages'}\n`);
  if (!PASSWORD) {
    console.log('   💡 Run with: APP_PASSWORD=yourpass npx tsx e2e/ai-review.ts\n');
  }

  // Clean + create output dir
  if (fs.existsSync(OUTDIR)) fs.rmSync(OUTDIR, { recursive: true });
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results: PageResult[] = [];

  // ── Desktop (1280×800) ──
  console.log('🖥️  Desktop pass...');
  const dCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dPage = await dCtx.newPage();

  if (PASSWORD) {
    await login(dPage, PASSWORD);
  }

  for (const def of PAGES) {
    process.stdout.write(`   📸 ${def.name}...`);
    const r = await crawlPage(dPage, def, 'desktop');
    results.push(r);
    const errNote = r.consoleErrors.length ? ` (${r.consoleErrors.length} errors)` : '';
    console.log(` ${r.screenshots.length} shots${errNote}`);
  }
  await dCtx.close();

  // ── Mobile (375×812) ──
  console.log('\n📱 Mobile pass...');
  const mCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  });
  const mPage = await mCtx.newPage();

  if (PASSWORD) {
    await login(mPage, PASSWORD);
  }

  for (const def of PAGES.filter(d => d.route !== '/login')) {
    process.stdout.write(`   📸 ${def.name}...`);
    const r = await crawlPage(mPage, def, 'mobile');
    // Merge into existing result
    const existing = results.find(x => x.def.route === def.route);
    if (existing) {
      existing.screenshots.push(...r.screenshots);
      existing.consoleErrors.push(...r.consoleErrors);
    }
    console.log(` ${r.screenshots.length} shots`);
  }
  await mCtx.close();
  await browser.close();

  const totalShots = results.reduce((n, r) => n + r.screenshots.length, 0);
  console.log(`\n📊 ${totalShots} screenshots across ${results.length} pages\n`);

  // ── Review ──
  console.log('🤖 Claude review...');
  const anthropic = new Anthropic();
  const reviews: { name: string; review: string }[] = [];

  for (const result of results) {
    if (!result.screenshots.length) continue;
    process.stdout.write(`   💬 ${result.def.name}...`);
    try {
      const review = await reviewPage(anthropic, result);
      reviews.push({ name: result.def.name, review });
      console.log(' ✓');
    } catch (err: any) {
      console.log(` ✗ ${err.message?.slice(0, 80)}`);
      reviews.push({ name: result.def.name, review: `Review failed: ${err.message}` });
    }
  }

  process.stdout.write('   💬 Holistic...');
  let holistic = '';
  try {
    holistic = await reviewHolistic(anthropic, results);
    console.log(' ✓');
  } catch (err: any) {
    holistic = `Review failed: ${err.message}`;
    console.log(` ✗ ${err.message?.slice(0, 80)}`);
  }

  // ── Report ──
  const report = buildReport(reviews, holistic, results);
  fs.writeFileSync(REPORT, report, 'utf-8');
  console.log(`\n✅ Report saved: ${REPORT}`);
}

async function login(page: Page, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  // Call the auth API directly from the browser context —
  // avoids React controlled-input issues with Playwright.
  const result = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    return { ok: res.ok, status: res.status };
  }, password);

  if (result.ok) {
    await page.goto(`${BASE_URL}/inbox`);
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log('   🔐 Logged in');
  } else {
    console.log(`   ⚠️  Login failed (HTTP ${result.status}) — pages will show login redirect`);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
