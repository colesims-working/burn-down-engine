import { db, schema } from '@/lib/db/client';
import { eq, and, ne, sql, asc, lte, isNotNull, isNull } from 'drizzle-orm';
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
  tier: number
): Promise<string[]> {
  if (taskList.length <= 1) return taskList.map(t => t.id);

  // Deterministic pre-sort as baseline
  const preSorted = deterministicSort(taskList);
  const allIds = new Set(preSorted.map(t => t.id));

  const context = await buildContext('', 'engage');
  const currentHour = new Date().getHours();

  const taskSummaries = preSorted.map(t => ({
    id: t.id,
    title: t.title,
    nextAction: t.nextAction,
    projectId: t.projectId,
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

    return validated;
  } catch {
    // Fallback: use deterministic sort
    return preSorted.map(t => t.id);
  }
}

// ─── Build Today's Ranked List ───────────────────────────────

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

  // Auto-resolve deferred tasks whose due date has arrived
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
  }

  // Rescue deferred tasks stuck without a due date
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
  }

  // Get all active/relevant tasks
  const allTasks = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'inbox'),
    ),
  });

  const fires = allTasks.filter(t => t.priority === 0 && t.status !== 'completed' && t.status !== 'deferred');
  const p1 = allTasks.filter(t => t.priority === 1 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred');
  const p2 = allTasks.filter(t => t.priority === 2 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred');
  const p3 = allTasks.filter(t => t.priority === 3 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred');
  const p4 = allTasks.filter(t => t.priority === 4 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred');
  const waiting = allTasks.filter(t => t.status === 'waiting');
  const blocked = allTasks.filter(t => t.status === 'blocked');
  const someday = allTasks.filter(t => t.status === 'someday');

  // Get today's completions
  const completed = allTasks.filter(t =>
    t.status === 'completed' && t.completedAt && t.completedAt.startsWith(today)
  );

  // Rank within each tier
  const mustDoIds = await rankTasksInTier(p1, 1);
  const shouldDoIds = await rankTasksInTier(p2, 2);

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

    const created = await db.insert(schema.tasks)
      .values({
        todoistId: todoistTask.id,
        originalText: opts.description,
        title: opts.description,
        priority: 0,
        status: 'active',
        todoistSyncedAt: new Date().toISOString(),
      })
      .returning();
    fireTask = created[0];
  }

  // Log the fire
  await db.insert(schema.taskHistory).values({
    taskId: fireTask.id,
    action: 'fire_promoted',
    details: JSON.stringify({ description: opts.description }),
  });

  // Find lowest P2 to bump
  const p2Tasks = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.priority, 2),
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
    ),
  });

  let bumpedTask: schema.Task | null = null;
  if (p2Tasks.length > 0) {
    const toBump = p2Tasks[p2Tasks.length - 1];
    const updated = await db.update(schema.tasks)
      .set({
        bumpCount: (toBump.bumpCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.tasks.id, toBump.id))
      .returning();
    bumpedTask = updated[0];

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
