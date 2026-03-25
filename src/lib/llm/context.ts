import { db, schema } from '@/lib/db/client';
import { eq, like, desc, sql, and, or, ne, inArray } from 'drizzle-orm';

type PageType = 'inbox' | 'clarify' | 'organize' | 'engage' | 'reflect';

// ─── Helpers ─────────────────────────────────────────────────

/** Bump timesReferenced for every knowledge entry included in context */
async function incrementTimesReferenced(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await db.update(schema.knowledgeEntries)
      .set({ timesReferenced: sql`${schema.knowledgeEntries.timesReferenced} + 1` })
      .where(inArray(schema.knowledgeEntries.id, ids));
  } catch (e) {
    // Best-effort — never block context construction
    console.error('Failed to increment timesReferenced:', e);
  }
}

// ─── Core Context Builders ───────────────────────────────────

export async function getIdentityContext(): Promise<string> {
  const entries = await db.query.knowledgeEntries.findMany({
    where: eq(schema.knowledgeEntries.category, 'identity'),
  });

  if (entries.length === 0) {
    return 'No identity context available yet. This is a new user — learn about them from their tasks.';
  }

  incrementTimesReferenced(entries.map(e => e.id));

  return '## User Identity\n' + entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
}

export async function getCurrentPriorities(): Promise<string> {
  const entries = await db.query.knowledgeEntries.findMany({
    where: eq(schema.knowledgeEntries.category, 'priority'),
  });

  if (entries.length === 0) return '## Current Priorities\nNot yet established.';

  incrementTimesReferenced(entries.map(e => e.id));

  return '## Current Priorities\n' + entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
}

export async function getActiveProjectSummary(): Promise<string> {
  const projects = await db.query.projects.findMany({
    where: eq(schema.projects.status, 'active'),
  });

  if (projects.length === 0) return '## Active Projects\nNone yet.';

  const lines = projects.map(p => {
    const parts = [`**${p.name}**`];
    if (p.category) parts.push(`[${p.category}]`);
    if (p.goal) parts.push(`— ${p.goal}`);
    parts.push(`(${p.openActionCount || 0} open tasks)`);
    return `- ${parts.join(' ')}`;
  });

  return '## Active Projects\n' + lines.join('\n');
}

export async function getPeopleContext(names: string[]): Promise<string> {
  if (names.length === 0) return '';

  const allPeople = await db.query.people.findMany();
  const matched = allPeople.filter(p =>
    names.some(n => p.name.toLowerCase().includes(n.toLowerCase()))
  );

  if (matched.length === 0) return '';

  const lines = matched.map(p => {
    const parts = [`**${p.name}**`];
    if (p.relationship) parts.push(`(${p.relationship})`);
    if (p.organization) parts.push(`at ${p.organization}`);
    if (p.role) parts.push(`— ${p.role}`);
    if (p.contextNotes) parts.push(`\n  Notes: ${p.contextNotes}`);
    return parts.join(' ');
  });

  return '## Related People\n' + lines.join('\n');
}

export async function getProjectContext(projectNames: string[]): Promise<string> {
  if (projectNames.length === 0) return '';

  const allProjects = await db.query.projects.findMany({
    where: eq(schema.projects.status, 'active'),
  });

  const matched = allProjects.filter(p =>
    projectNames.some(n => p.name.toLowerCase().includes(n.toLowerCase()))
  );

  if (matched.length === 0) return '';

  const lines = matched.map(p => {
    const parts = [`### ${p.name}`];
    if (p.goal) parts.push(`Goal: ${p.goal}`);
    if (p.notes) parts.push(`Notes: ${p.notes}`);
    const decisions = JSON.parse(p.openDecisions || '[]');
    if (decisions.length > 0) parts.push(`Open decisions: ${decisions.join(', ')}`);
    const links = JSON.parse(p.keyLinks || '[]');
    if (links.length > 0) parts.push(`Links: ${links.join(', ')}`);
    return parts.join('\n');
  });

  return '## Related Projects\n' + lines.join('\n\n');
}

export async function getTaskPatterns(): Promise<string> {
  const patterns = await db.query.knowledgeEntries.findMany({
    where: eq(schema.knowledgeEntries.category, 'pattern'),
    orderBy: desc(schema.knowledgeEntries.timesReferenced),
    limit: 15,
  });

  if (patterns.length === 0) return '';

  incrementTimesReferenced(patterns.map(p => p.id));

  return '## Known Patterns\n' + patterns.map(p => `- ${p.value}`).join('\n');
}

export async function getPreferences(): Promise<string> {
  const prefs = await db.query.knowledgeEntries.findMany({
    where: eq(schema.knowledgeEntries.category, 'preference'),
  });

  if (prefs.length === 0) return '';

  incrementTimesReferenced(prefs.map(p => p.id));

  return '## User Preferences\n' + prefs.map(p => `- ${p.key}: ${p.value}`).join('\n');
}

export async function getDeferralPatterns(): Promise<string> {
  const entries = await db.query.knowledgeEntries.findMany({
    where: and(
      eq(schema.knowledgeEntries.category, 'pattern'),
      like(schema.knowledgeEntries.key, '%defer%'),
    ),
  });

  // Also get tasks bumped 2+ times
  const bumpedTasks = await db.query.tasks.findMany({
    where: and(
      sql`${schema.tasks.bumpCount} >= 2`,
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
    ),
  });

  if (entries.length > 0) {
    incrementTimesReferenced(entries.map(e => e.id));
  }

  const parts: string[] = [];
  if (entries.length > 0) {
    parts.push('Deferral patterns: ' + entries.map(e => e.value).join('; '));
  }
  if (bumpedTasks.length > 0) {
    parts.push('Tasks bumped 2+ times: ' + bumpedTasks.map(t => `"${t.title}" (${t.bumpCount}x)`).join(', '));
  }

  return parts.length > 0 ? '## Deferral Patterns\n' + parts.join('\n') : '';
}

export async function getDecompositionTemplates(): Promise<string> {
  const templates = await db.query.decompositionTemplates.findMany({
    orderBy: desc(schema.decompositionTemplates.timesUsed),
    limit: 10,
  });

  if (templates.length === 0) return '';

  return '## Known Decomposition Templates\n' + templates.map(t =>
    `- "${t.triggerPattern}" → ${t.template}`
  ).join('\n');
}

// ─── Text Matching ───────────────────────────────────────────

export function extractMentionedPeople(text: string): string[] {
  // Simple approach: match against known people names
  // In production, this would also use embeddings
  return []; // Will be populated by scanning people table
}

export async function matchPeople(text: string): Promise<string[]> {
  const allPeople = await db.query.people.findMany();
  const textLower = text.toLowerCase();
  return allPeople
    .filter(p => textLower.includes(p.name.toLowerCase()))
    .map(p => p.name);
}

export async function matchProjects(text: string): Promise<string[]> {
  const allProjects = await db.query.projects.findMany({
    where: eq(schema.projects.status, 'active'),
  });
  const textLower = text.toLowerCase();
  return allProjects
    .filter(p => textLower.includes(p.name.toLowerCase()))
    .map(p => p.name);
}

// ─── Main Context Builder ────────────────────────────────────

export async function buildContext(input: string, page: PageType): Promise<string> {
  const sections: string[] = [];

  // Always include core context
  sections.push(await getIdentityContext());
  sections.push(await getCurrentPriorities());
  sections.push(await getActiveProjectSummary());

  // Match mentioned entities
  const mentionedPeople = await matchPeople(input);
  if (mentionedPeople.length > 0) {
    sections.push(await getPeopleContext(mentionedPeople));
  }

  const mentionedProjects = await matchProjects(input);
  if (mentionedProjects.length > 0) {
    sections.push(await getProjectContext(mentionedProjects));
  }

  // Page-specific context
  switch (page) {
    case 'clarify':
      sections.push(await getTaskPatterns());
      sections.push(await getDecompositionTemplates());
      sections.push(await getPreferences());
      break;

    case 'organize':
      sections.push(await getPreferences());
      break;

    case 'engage':
      sections.push(await getDeferralPatterns());
      break;

    case 'reflect':
      sections.push(await getDeferralPatterns());
      sections.push(await getTaskPatterns());
      break;
  }

  return sections.filter(s => s.length > 0).join('\n\n');
}
