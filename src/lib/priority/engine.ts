import { db, schema } from '@/lib/db/client';
import { eq, and, ne, sql, asc } from 'drizzle-orm';
import { llmGenerateJSON } from '@/lib/llm/router';
import { buildContext } from '@/lib/llm/context';
import { RANK_TASKS_PROMPT } from '@/lib/llm/prompts/engage';
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

export async function rankTasksInTier(
  taskList: schema.Task[],
  tier: number
): Promise<string[]> {
  if (taskList.length <= 1) return taskList.map(t => t.id);

  const context = await buildContext('', 'engage');
  const currentHour = new Date().getHours();

  const taskSummaries = taskList.map(t => ({
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

    return result.rankedTaskIds || taskList.map(t => t.id);
  } catch {
    // Fallback: sort by due date, then bump count
    return taskList
      .sort((a, b) => {
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        return (b.bumpCount || 0) - (a.bumpCount || 0);
      })
      .map(t => t.id);
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
  completed: schema.Task[];
}> {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Get all active/relevant tasks
  const allTasks = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'inbox'),
    ),
  });

  const fires = allTasks.filter(t => t.priority === 0 && t.status !== 'completed');
  const p1 = allTasks.filter(t => t.priority === 1 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked');
  const p2 = allTasks.filter(t => t.priority === 2 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked');
  const p3 = allTasks.filter(t => t.priority === 3 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked');
  const p4 = allTasks.filter(t => t.priority === 4 && t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked');
  const waiting = allTasks.filter(t => t.status === 'waiting' || t.status === 'blocked');

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

  return { fires, mustDo, shouldDo, thisWeek: p3, backlog: p4, waiting, completed };
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
  } else {
    const created = await db.insert(schema.tasks)
      .values({
        originalText: opts.description,
        title: opts.description,
        priority: 0,
        status: 'active',
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

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'completed',
    details: JSON.stringify({ completedAt: now }),
  });

  return updated[0];
}

export async function bumpTask(taskId: string, reason?: string): Promise<schema.Task & { antiPileUp?: boolean }> {
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

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'bumped',
    details: JSON.stringify({ reason, bumpCount: newBumpCount, deferredTo: tomorrow }),
  });

  const result = updated[0] as schema.Task & { antiPileUp?: boolean };
  if (newBumpCount >= 3) {
    result.antiPileUp = true;
  }
  return result;
}

export async function blockTask(taskId: string, blockerNote: string): Promise<schema.Task> {
  const updated = await db.update(schema.tasks)
    .set({
      status: 'blocked',
      blockerNote,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'blocked',
    details: JSON.stringify({ blocker: blockerNote }),
  });

  return updated[0];
}
