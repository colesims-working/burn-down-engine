import { db, schema } from '@/lib/db/client';
import { eq, and, ne, sql, asc, lte, isNotNull, isNull, inArray } from 'drizzle-orm';
import { llmGenerateJSON } from '@/lib/llm/router';
import { buildContext } from '@/lib/llm/context';
import { RANK_TASKS_PROMPT } from '@/lib/llm/prompts/engage';
import { todoist } from '@/lib/todoist/client';
import { syncTaskDueDate, syncTaskLabels, addTodoistComment, mapToTodoistPriority } from '@/lib/todoist/sync';
import { format, addDays } from 'date-fns';

// ─── Tier Assignment ─────────────────────────────────────────

export async function assignPriority(task: schema.Task): Promise<number> {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Hard rules first
  if (task.status === 'blocked' || task.status === 'waiting') return task.priority || 4;
  if (task.dueDate === today) return 1;
  if ((task.bumpCount || 0) >= 3) return 1; // Anti-pile-up

  // Keep existing priority if already set meaningfully
  if (task.priority && task.priority >= 1 && task.priority <= 4) {
    return task.priority;
  }

  return 4; // Default to backlog
}

// ─── Intra-Tier Ranking ──────────────────────────────────────

/**
 * Deterministic pre-sort: overdue → due-today → due-this-week → bumpCount desc.
 * Applied BEFORE LLM reranking as a stable baseline.
 */
function deterministicSort(tasks: schema.Task[]): schema.Task[] {
  const today = format(new Date(), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  return [...tasks].sort((a, b) => {
    // Overdue first
    const aOverdue = a.dueDate && a.dueDate < today ? 1 : 0;
    const bOverdue = b.dueDate && b.dueDate < today ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    // Due today next
    const aDueToday = a.dueDate === today ? 1 : 0;
    const bDueToday = b.dueDate === today ? 1 : 0;
    if (aDueToday !== bDueToday) return bDueToday - aDueToday;

    // Due this week next
    const aThisWeek = a.dueDate && a.dueDate <= weekEnd ? 1 : 0;
    const bThisWeek = b.dueDate && b.dueDate <= weekEnd ? 1 : 0;
    if (aThisWeek !== bThisWeek) return bThisWeek - aThisWeek;

    // Bump count (most bumped = most urgent)
    return (b.bumpCount || 0) - (a.bumpCount || 0);
  });
}

export async function rankTasksInTier(
  taskList: schema.Task[],
  tier: number,
  prebuiltContext?: string,
): Promise<string[]> {
  if (taskList.length <= 1) return taskList.map(t => t.id);

  // Deterministic pre-sort as baseline
  const preSorted = deterministicSort(taskList);
  const allIds = new Set(preSorted.map(t => t.id));

  // Use prebuilt context if provided, otherwise build fresh
  const context = prebuiltContext ?? await buildContext(preSorted.map(t => t.title).join(' | '), 'engage');
  const currentHour = new Date().getHours();

  // Resolve project names for the LLM (Issue 7)
  const projectIds = [...new Set(preSorted.map(t => t.projectId).filter(Boolean))] as string[];
  const projects = projectIds.length > 0
    ? await db.query.projects.findMany({ where: inArray(schema.projects.id, projectIds) })
    : [];
  const projectMap = new Map(projects.map(p => [p.id, p]));

  const taskSummaries = preSorted.map(t => ({
    id: t.id,
    title: t.title,
    nextAction: t.nextAction,
    projectName: projectMap.get(t.projectId || '')?.name || 'Inbox',
    projectGoal: projectMap.get(t.projectId || '')?.goal || null,
    timeEstimateMin: t.timeEstimateMin,
    energyLevel: t.energyLevel,
    labels: JSON.parse(t.labels || '[]'),
    dueDate: t.dueDate,
    bumpCount: t.bumpCount,
  }));

  try {
    const result = await llmGenerateJSON<{ rankedTaskIds: string[] }>({
      operation: 'rank_tasks',
      system: RANK_TASKS_PROMPT,
      prompt: `Current time: ${currentHour}:00\nPriority tier: P${tier}\n\nContext:\n${context}\n\nTasks to rank:\n${JSON.stringify(taskSummaries, null, 2)}`,
    });

    const ranked = result.rankedTaskIds || [];

    // Validate: ensure ALL input tasks appear. Append any missing ones at the end.
    const seen = new Set<string>();
    const validated: string[] = [];
    for (const id of ranked) {
      if (allIds.has(id) && !seen.has(id)) {
        validated.push(id);
        seen.add(id);
      }
    }
    // Append any tasks the LLM dropped
    for (const id of allIds) {
      if (!seen.has(id)) validated.push(id);
    }

    // Persist rank so Fire victim selection is meaningful (Issue 10)
    await persistRanks(validated);
    return validated;
  } catch {
    // Fallback: use deterministic sort
    const fallback = preSorted.map(t => t.id);
    await persistRanks(fallback);
    return fallback;
  }
}

async function persistRanks(rankedIds: string[]): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < rankedIds.length; i++) {
        await tx.update(schema.tasks)
          .set({ rankWithinTier: i + 1 })
          .where(eq(schema.tasks.id, rankedIds[i]));
      }
    });
  } catch (e) {
    console.error('Failed to persist rank:', e);
  }
}

// ─── Deferred Resolution (separated from read path) ─────────

export async function resolveDeferred(): Promise<number> {
  const today = format(new Date(), 'yyyy-MM-dd');
  let resolved = 0;

  const deferredDue = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.status, 'deferred'),
      isNotNull(schema.tasks.dueDate),
      lte(schema.tasks.dueDate, today),
    ),
  });
  for (const t of deferredDue) {
    await db.update(schema.tasks)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, t.id));
    resolved++;
  }

  const deferredStuck = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.status, 'deferred'),
      isNull(schema.tasks.dueDate),
    ),
  });
  for (const t of deferredStuck) {
    await db.update(schema.tasks)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, t.id));
    resolved++;
  }

  return resolved;
}

// ─── Fast Read Path (no LLM, no writes) ─────────────────────

type EngageData = {
  fires: schema.Task[];
  mustDo: schema.Task[];
  shouldDo: schema.Task[];
  thisWeek: schema.Task[];
  backlog: schema.Task[];
  waiting: schema.Task[];
  blocked: schema.Task[];
  someday: schema.Task[];
  completed: schema.Task[];
  rankStale?: boolean;
};

let _lastRankTime = 0;
const RANK_STALE_MS = 5 * 60 * 1000; // 5 minutes

export async function buildEngageListFast(): Promise<EngageData> {
  const today = format(new Date(), 'yyyy-MM-dd');

  const allTasks = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'inbox'),
    ),
  });

  const isActiveTier = (t: schema.Task) => t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred' && t.status !== 'someday' && t.status !== 'needs_reconcile';
  const fires = allTasks.filter(t => t.priority === 0 && isActiveTier(t));
  const p1 = allTasks.filter(t => t.priority === 1 && isActiveTier(t));
  const p2 = allTasks.filter(t => t.priority === 2 && isActiveTier(t));
  const p3 = allTasks.filter(t => t.priority === 3 && isActiveTier(t));
  const p4 = allTasks.filter(t => t.priority === 4 && isActiveTier(t));
  const waiting = allTasks.filter(t => t.status === 'waiting');
  const blocked = allTasks.filter(t => t.status === 'blocked');
  const someday = allTasks.filter(t => t.status === 'someday');
  const completed = allTasks.filter(t =>
    t.status === 'completed' && t.completedAt && t.completedAt.startsWith(today)
  );

  // Deterministic multi-field sort — no LLM needed for consistent ordering
  const URGENCY_ORDER: Record<string, number> = { deadline: 0, blocking: 1, momentum: 2, routine: 3, flexible: 4 };
  const deterministicTierSort = (tasks: schema.Task[]) =>
    [...tasks].sort((a, b) => {
      // 1. Overdue tasks first
      const aOverdue = a.dueDate && a.dueDate < today ? 1 : 0;
      const bOverdue = b.dueDate && b.dueDate < today ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      // 2. Urgency class
      const aUrgency = URGENCY_ORDER[(a as any).urgencyClass || 'flexible'] ?? 4;
      const bUrgency = URGENCY_ORDER[(b as any).urgencyClass || 'flexible'] ?? 4;
      if (aUrgency !== bUrgency) return aUrgency - bUrgency;
      // 3. Due date (soonest first)
      if (a.dueDate && b.dueDate) {
        const cmp = a.dueDate.localeCompare(b.dueDate);
        if (cmp !== 0) return cmp;
      } else if (a.dueDate) return -1;
      else if (b.dueDate) return 1;
      // 4. LLM rank if available (from previous rerank)
      const aRank = a.rankWithinTier ?? 999;
      const bRank = b.rankWithinTier ?? 999;
      if (aRank !== bRank) return aRank - bRank;
      // 5. Bump count (most bumped = most overdue attention)
      if ((b.bumpCount || 0) !== (a.bumpCount || 0)) return (b.bumpCount || 0) - (a.bumpCount || 0);
      // 6. Shorter tasks first (quick wins)
      return (a.timeEstimateMin || 30) - (b.timeEstimateMin || 30);
    });

  const rankStale = _lastRankTime === 0 || (Date.now() - _lastRankTime) > RANK_STALE_MS;

  return {
    fires,
    mustDo: deterministicTierSort(p1),
    shouldDo: deterministicTierSort(p2),
    thisWeek: deterministicTierSort(p3),
    backlog: deterministicTierSort(p4),
    waiting,
    blocked,
    someday,
    completed,
    rankStale,
  };
}

// ─── Background Rerank ──────────────────────────────────────

let _rerankInFlight = false;

export async function rerankEngageTiers(): Promise<EngageData> {
  if (_rerankInFlight) {
    // Another rerank is already running — return the fast path
    return buildEngageListFast();
  }
  _rerankInFlight = true;
  try {
    const result = await buildEngageList();
    _lastRankTime = Date.now();
    return result;
  } finally {
    _rerankInFlight = false;
  }
}

// ─── Full Build (with LLM ranking — used by rerank) ─────────

export async function buildEngageList(): Promise<{
  fires: schema.Task[];
  mustDo: schema.Task[];
  shouldDo: schema.Task[];
  thisWeek: schema.Task[];
  backlog: schema.Task[];
  waiting: schema.Task[];
  blocked: schema.Task[];
  someday: schema.Task[];
  completed: schema.Task[];
}> {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Resolve deferred tasks first (writes separated from the fast-read path)
  await resolveDeferred();

  // Get all active/relevant tasks
  const allTasks = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'inbox'),
    ),
  });

  const isActiveTier = (t: schema.Task) => t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred' && t.status !== 'someday' && t.status !== 'needs_reconcile';
  const fires = allTasks.filter(t => t.priority === 0 && isActiveTier(t));
  const p1 = allTasks.filter(t => t.priority === 1 && isActiveTier(t));
  const p2 = allTasks.filter(t => t.priority === 2 && isActiveTier(t));
  const p3 = allTasks.filter(t => t.priority === 3 && isActiveTier(t));
  const p4 = allTasks.filter(t => t.priority === 4 && isActiveTier(t));
  const waiting = allTasks.filter(t => t.status === 'waiting');
  const blocked = allTasks.filter(t => t.status === 'blocked');
  const someday = allTasks.filter(t => t.status === 'someday');

  // Get today's completions
  const completed = allTasks.filter(t =>
    t.status === 'completed' && t.completedAt && t.completedAt.startsWith(today)
  );

  // Build shared context once for both tiers (one embedding call, not two)
  const t0 = Date.now();
  const allActiveTitles = [...p1, ...p2].map(t => t.title).join(' | ');
  const sharedContext = await buildContext(allActiveTitles, 'engage');

  // Rank P1 and P2 in parallel using shared context
  const [mustDoIds, shouldDoIds] = await Promise.all([
    rankTasksInTier(p1, 1, sharedContext),
    rankTasksInTier(p2, 2, sharedContext),
  ]);
  console.log(`[engage] parallel rank (P1=${p1.length}, P2=${p2.length}): ${Date.now()-t0}ms`);

  // Reorder by ranking
  const mustDo = mustDoIds.map(id => p1.find(t => t.id === id)!).filter(Boolean);
  const shouldDo = shouldDoIds.map(id => p2.find(t => t.id === id)!).filter(Boolean);

  return { fires, mustDo, shouldDo, thisWeek: p3, backlog: p4, waiting, blocked, someday, completed };
}

// ─── Fire Protocol ───────────────────────────────────────────

export async function handleFire(opts: {
  description: string;
  taskId?: string;
}): Promise<{
  fireTask: schema.Task;
  bumpedTask: schema.Task | null;
}> {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Create or promote the fire task
  let fireTask: schema.Task;
  if (opts.taskId) {
    const updated = await db.update(schema.tasks)
      .set({ priority: 0, status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, opts.taskId))
      .returning();
    fireTask = updated[0];

    // Sync priority to Todoist
    if (fireTask.todoistId) {
      try {
        await todoist.updateTask(fireTask.todoistId, {
          priority: mapToTodoistPriority(0),
        });
      } catch (e) {
        console.error('Failed to sync fire priority to Todoist:', e);
      }
    }
  } else {
    // Create in Todoist first (source of truth)
    const todoistTask = await todoist.createTask({
      content: opts.description,
      priority: mapToTodoistPriority(0),
    });

    let created;
    try {
      created = await db.insert(schema.tasks)
        .values({
          todoistId: todoistTask.id,
          originalText: opts.description,
          title: opts.description,
          priority: 0,
          status: 'active',
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
    } catch (dbError) {
      // Clean up Todoist task if local insert fails
      try { await todoist.deleteTask(todoistTask.id); } catch {}
      throw dbError;
    }
    fireTask = created[0];
  }

  // Log the fire
  await db.insert(schema.taskHistory).values({
    taskId: fireTask.id,
    action: 'fire_promoted',
    details: JSON.stringify({ description: opts.description }),
  });

  // Find lowest-ranked P2 to bump (by rank within tier, then oldest created)
  const p2Tasks = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.priority, 2),
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
    ),
    orderBy: (t, { asc, desc }) => [desc(t.rankWithinTier), asc(t.createdAt)],
  });

  let bumpedTask: schema.Task | null = null;
  if (p2Tasks.length > 0) {
    // Take first element — desc(rankWithinTier) puts worst-ranked (highest number) first
    const toBump = p2Tasks[0];
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const updated = await db.update(schema.tasks)
      .set({
        bumpCount: (toBump.bumpCount || 0) + 1,
        dueDate: tomorrow,
        status: 'deferred',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, toBump.id))
      .returning();
    bumpedTask = updated[0];

    // Sync the deferral to Todoist
    try { await syncTaskDueDate(bumpedTask); } catch {}

    await db.insert(schema.taskHistory).values({
      taskId: toBump.id,
      action: 'bumped',
      details: JSON.stringify({ reason: `Fire: ${opts.description}`, bumpedBy: fireTask.id }),
    });
  }

  return { fireTask, bumpedTask };
}

// ─── Task Actions ────────────────────────────────────────────

export async function completeTask(taskId: string): Promise<schema.Task> {
  const now = new Date().toISOString();
  const updated = await db.update(schema.tasks)
    .set({ status: 'completed', completedAt: now, updatedAt: now })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  if (!updated[0]) throw new Error('Task not found');

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'completed',
    details: JSON.stringify({ completedAt: now }),
  });

  return updated[0];
}

export async function bumpTask(taskId: string, reason?: string): Promise<schema.Task & { antiPileUp?: boolean; syncWarning?: string }> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new Error('Task not found');

  const newBumpCount = (task.bumpCount || 0) + 1;
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const updated = await db.update(schema.tasks)
    .set({
      bumpCount: newBumpCount,
      dueDate: tomorrow,
      status: 'deferred',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  // Sync due date to Todoist
  let syncWarning: string | undefined;
  try {
    await syncTaskDueDate(updated[0]);
  } catch (e) {
    syncWarning = `Failed to sync defer to Todoist: ${(e as Error).message}`;
    console.error(syncWarning);
  }

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'bumped',
    details: JSON.stringify({ reason, bumpCount: newBumpCount, deferredTo: tomorrow }),
  });

  const result = updated[0] as schema.Task & { antiPileUp?: boolean; syncWarning?: string };
  if (newBumpCount >= 3) {
    result.antiPileUp = true;
  }
  if (syncWarning) result.syncWarning = syncWarning;
  return result;
}

export async function blockTask(taskId: string, blockerNote: string): Promise<schema.Task & { syncWarning?: string }> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new Error('Task not found');

  // Add 'blocked' label locally
  const labels: string[] = JSON.parse(task.labels || '[]');
  if (!labels.includes('blocked')) labels.push('blocked');

  const updated = await db.update(schema.tasks)
    .set({
      status: 'blocked',
      blockerNote,
      labels: JSON.stringify(labels),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  // Sync to Todoist: update labels + add blocker comment
  let syncWarning: string | undefined;
  try {
    await syncTaskLabels(updated[0]);
    if (task.todoistId) {
      await addTodoistComment(task.todoistId, `🚫 **Blocked:** ${blockerNote}`);
    }
  } catch (e) {
    syncWarning = `Failed to sync block to Todoist: ${(e as Error).message}`;
    console.error(syncWarning);
  }

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'blocked',
    details: JSON.stringify({ blocker: blockerNote }),
  });

  const result = updated[0] as schema.Task & { syncWarning?: string };
  if (syncWarning) result.syncWarning = syncWarning;
  return result;
}

export async function waitTask(taskId: string, waitingFor: string): Promise<schema.Task> {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task) throw new Error('Task not found');

  // Add 'waiting-for' label locally
  const labels: string[] = JSON.parse(task.labels || '[]');
  if (!labels.includes('waiting-for')) labels.push('waiting-for');

  const updated = await db.update(schema.tasks)
    .set({
      status: 'waiting',
      blockerNote: waitingFor,
      labels: JSON.stringify(labels),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  // Sync to Todoist: update labels + add waiting comment
  try {
    await syncTaskLabels(updated[0]);
    if (task.todoistId) {
      await addTodoistComment(task.todoistId, `⏳ **Waiting for:** ${waitingFor}`);
    }
  } catch (e) {
    console.error('Failed to sync wait to Todoist:', e);
  }

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'waiting',
    details: JSON.stringify({ waitingFor }),
  });

  return updated[0];
}
