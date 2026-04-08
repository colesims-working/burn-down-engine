import { db, schema } from '@/lib/db/client';
import { todoist, TodoistTask, TodoistProject } from './client';
import { eq, sql, ne, and, inArray } from 'drizzle-orm';

// ─── Priority Mapping ────────────────────────────────────────

export function mapFromTodoistPriority(todoistPriority: number): number {
  // Todoist: 1=none, 2=low, 3=medium, 4=high (inverted)
  // Ours: 1=must, 2=should, 3=this-week, 4=backlog
  const map: Record<number, number> = { 4: 1, 3: 2, 2: 3, 1: 4 };
  return map[todoistPriority] ?? 4;
}

export function mapToTodoistPriority(ourPriority: number): number {
  const map: Record<number, number> = { 0: 4, 1: 4, 2: 3, 3: 2, 4: 1 };
  return map[ourPriority] ?? 1;
}

// ─── Sync Operations ─────────────────────────────────────────

export async function syncInbox(): Promise<schema.Task[]> {
  const todoistTasks = await todoist.getInboxTasks();
  const todoistInboxIds = new Set(todoistTasks.map(tt => tt.id));

  // Batch-fetch all existing local tasks that match incoming Todoist IDs (eliminates N queries)
  const incomingIds = todoistTasks.map(tt => tt.id);
  const existingTasks = incomingIds.length > 0
    ? await db.query.tasks.findMany({
        where: inArray(schema.tasks.todoistId, incomingIds),
      })
    : [];
  const existingByTodoistId = new Map(existingTasks.map(t => [t.todoistId, t]));

  // Upsert tasks in small batches — Turso free tier has tight memory limits
  const BATCH_SIZE = 5;
  const synced: schema.Task[] = [];

  for (let i = 0; i < todoistTasks.length; i += BATCH_SIZE) {
    const batch = todoistTasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (tt) => {
      const existing = existingByTodoistId.get(tt.id);
      const now = new Date().toISOString();

      if (existing) {
        // Don't overwrite status if the task has been locally completed/killed
        // Never demote a task back to 'inbox' if it has progressed past it
        const preserveStatus = existing.status !== 'inbox';
        const updated = await db.update(schema.tasks)
          .set({
            title: tt.content,
            description: tt.description || null,
            priority: mapFromTodoistPriority(tt.priority),
            dueDate: tt.due?.date || null,
            labels: JSON.stringify(tt.labels),
            isRecurring: tt.due?.is_recurring || false,
            recurrenceRule: tt.due?.string || null,
            ...(preserveStatus ? {} : { status: 'inbox' as const }),
            todoistSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.tasks.id, existing.id))
          .returning();
        return updated[0];
      } else {
        // Use onConflictDoUpdate to handle race conditions with concurrent syncs
        const result = await db.insert(schema.tasks)
          .values({
            todoistId: tt.id,
            originalText: tt.content,
            title: tt.content,
            description: tt.description || null,
            dueDate: tt.due?.date || null,
            priority: mapFromTodoistPriority(tt.priority),
            labels: JSON.stringify(tt.labels),
            isRecurring: tt.due?.is_recurring || false,
            recurrenceRule: tt.due?.string || null,
            status: 'inbox',
            todoistSyncedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.tasks.todoistId,
            set: {
              title: tt.content,
              description: tt.description || null,
              priority: mapFromTodoistPriority(tt.priority),
              dueDate: tt.due?.date || null,
              labels: JSON.stringify(tt.labels),
              isRecurring: tt.due?.is_recurring || false,
              recurrenceRule: tt.due?.string || null,
              status: 'inbox',
              todoistSyncedAt: now,
              updatedAt: now,
            },
          })
          .returning();

        // Recurring enrichment reuse: if this is a recurring task, copy enrichment
        // from the most recent completed instance with the same recurrence rule
        const newTask = result[0];
        if (tt.due?.is_recurring && tt.due?.string && !newTask.clarifyConfidence) {
          try {
            const previousInstance = await db.query.tasks.findFirst({
              where: and(
                eq(schema.tasks.recurrenceRule, tt.due.string),
                eq(schema.tasks.status, 'completed'),
                sql`${schema.tasks.clarifyConfidence} IS NOT NULL`,
              ),
              orderBy: (t, { desc }) => [desc(t.completedAt)],
            });
            if (previousInstance) {
              await db.update(schema.tasks).set({
                projectId: previousInstance.projectId,
                priority: previousInstance.priority,
                labels: previousInstance.labels,
                timeEstimateMin: previousInstance.timeEstimateMin,
                energyLevel: previousInstance.energyLevel,
                contextNotes: previousInstance.contextNotes,
                definitionOfDone: previousInstance.definitionOfDone,
                nextAction: previousInstance.nextAction,
                clarifyConfidence: previousInstance.clarifyConfidence,
                status: 'clarified',
              }).where(eq(schema.tasks.id, newTask.id));
            }
          } catch {}
        }

        return result[0];
      }
    }));
    synced.push(...batchResults);
  }

  // Reconcile: local tasks marked 'inbox' that are no longer in Todoist inbox
  // Do NOT guess what happened — verify remote state for each missing task
  const localInbox = await db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
  });

  const now = new Date().toISOString();
  for (const local of localInbox) {
    if (!local.todoistId) continue;
    if (todoistInboxIds.has(local.todoistId)) continue;

    // Task left the inbox — check what actually happened remotely
    try {
      const remoteTask = await todoist.getTask(local.todoistId);
      // Task still exists in Todoist but moved out of inbox
      if (remoteTask.is_completed) {
        await db.update(schema.tasks)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(schema.tasks.id, local.id));
      } else {
        // Task is alive in a project — promote based on local enrichment state
        const newStatus = local.clarifyConfidence ? 'clarified' : 'active';
        await db.update(schema.tasks)
          .set({ status: newStatus, updatedAt: now })
          .where(eq(schema.tasks.id, local.id));
      }
    } catch (e: any) {
      // 404 = task was deleted remotely. Any other error = mark for reconciliation.
      const isNotFound = e?.message?.includes('404') || e?.status === 404;
      await db.update(schema.tasks)
        .set({
          status: isNotFound ? 'killed' : 'needs_reconcile',
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, local.id));
    }
  }

  // Update sync state
  await db.insert(schema.syncState)
    .values({ id: 'singleton', lastInboxSync: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.syncState.id,
      set: { lastInboxSync: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });

  return synced;
}

export async function syncProjects(): Promise<schema.Project[]> {
  const todoistProjects = await todoist.getProjects();
  const synced: schema.Project[] = [];

  // Pre-fetch all local projects into a Map (eliminates N per-row DB queries)
  const localProjects = await db.query.projects.findMany();
  const localByTodoistId = new Map(localProjects.filter(p => p.todoistId).map(p => [p.todoistId!, p]));

  for (const tp of todoistProjects) {
    if (tp.inbox_project) continue;

    const existing = localByTodoistId.get(tp.id) || null;

    if (existing) {
      const updated = await db.update(schema.projects)
        .set({
          name: tp.name,
          parentTodoistId: tp.parent_id,
          todoistSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.projects.id, existing.id))
        .returning();
      synced.push(updated[0]);
    } else {
      const created = await db.insert(schema.projects)
        .values({
          todoistId: tp.id,
          name: tp.name,
          parentTodoistId: tp.parent_id,
          status: 'active',
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
      synced.push(created[0]);
    }
  }

  // Reconcile: archive local projects whose todoistId no longer exists in Todoist
  const todoistProjectIds = new Set(todoistProjects.map(tp => tp.id));
  const activeLocalProjects = localProjects.filter(p => p.todoistId && p.status !== 'archived');
  for (const lp of activeLocalProjects) {
    if (lp.todoistId && !todoistProjectIds.has(lp.todoistId)) {
      await db.update(schema.projects)
        .set({ status: 'archived', updatedAt: new Date().toISOString() })
        .where(eq(schema.projects.id, lp.id));
    }
  }

  return synced;
}

export async function syncAllTasks(): Promise<schema.Task[]> {
  const allTasks = await todoist.getTasks();
  const projects = await todoist.getProjects();
  const inboxId = projects.find(p => p.inbox_project)?.id;
  const synced: schema.Task[] = [];

  // Pre-fetch all local data into Maps (eliminates 2N per-row DB queries)
  const localTasks = await db.query.tasks.findMany();
  const localTasksByTodoistId = new Map(localTasks.filter(t => t.todoistId).map(t => [t.todoistId!, t]));
  const localProjects = await db.query.projects.findMany();
  const localProjectsByTodoistId = new Map(localProjects.filter(p => p.todoistId).map(p => [p.todoistId!, p]));

  for (const tt of allTasks) {
    const isInbox = tt.project_id === inboxId;
    const existing = localTasksByTodoistId.get(tt.id) || null;

    // Find local project from pre-fetched Map
    let localProjectId: string | null = null;
    if (!isInbox) {
      localProjectId = localProjectsByTodoistId.get(tt.project_id)?.id || null;
    }

    if (existing) {
      // Only update fields that actually changed from Todoist
      const newTitle = tt.content;
      const newDescription = tt.description || null;
      const newPriority = mapFromTodoistPriority(tt.priority);
      const newProjectId = localProjectId ?? existing.projectId; // preserve local assignments
      const newDueDate = tt.due?.date || null;
      const newLabels = JSON.stringify(tt.labels);
      const newIsRecurring = tt.due?.is_recurring || false;
      const newRecurrenceRule = tt.due?.string || null;

      // Only bump updatedAt if something actually changed
      const changed = newTitle !== existing.title
        || newDescription !== existing.description
        || newPriority !== existing.priority
        || newProjectId !== existing.projectId
        || newDueDate !== existing.dueDate
        || newLabels !== existing.labels;

      // If task moved back to Todoist inbox, reset local status to inbox
      const movedToInbox = isInbox && existing.status !== 'inbox' && existing.status !== 'completed' && existing.status !== 'killed';

      const updated = await db.update(schema.tasks)
        .set({
          title: newTitle,
          description: newDescription,
          priority: newPriority,
          projectId: newProjectId,
          dueDate: newDueDate,
          labels: newLabels,
          isRecurring: newIsRecurring,
          recurrenceRule: newRecurrenceRule,
          todoistSyncedAt: new Date().toISOString(),
          ...(movedToInbox ? { status: 'inbox' as const, projectId: null } : {}),
          ...(changed || movedToInbox ? { updatedAt: new Date().toISOString() } : {}),
        })
        .where(eq(schema.tasks.id, existing.id))
        .returning();
      synced.push(updated[0]);
    } else {
      const created = await db.insert(schema.tasks)
        .values({
          todoistId: tt.id,
          originalText: tt.content,
          title: tt.content,
          description: tt.description || null,
          projectId: localProjectId,
          dueDate: tt.due?.date || null,
          priority: mapFromTodoistPriority(tt.priority),
          labels: JSON.stringify(tt.labels),
          isRecurring: tt.due?.is_recurring || false,
          recurrenceRule: tt.due?.string || null,
          status: isInbox ? 'inbox' : 'active',
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
      synced.push(created[0]);
    }
  }

  // Reconcile: local tasks with todoistId that no longer appear in Todoist's open list.
  // Do NOT assume completed — verify each missing task's real state.
  const todoistIds = new Set(allTasks.map(tt => tt.id));
  const localWithTodoist = await db.query.tasks.findMany({
    where: and(
      sql`${schema.tasks.todoistId} IS NOT NULL`,
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'needs_reconcile'),
    ),
  });
  const now = new Date().toISOString();
  for (const local of localWithTodoist) {
    if (!local.todoistId) continue;
    if (todoistIds.has(local.todoistId)) continue;

    // Task missing from open list — determine real state
    try {
      const remoteTask = await todoist.getTask(local.todoistId);
      if (remoteTask.is_completed) {
        await db.update(schema.tasks)
          .set({ status: 'completed', completedAt: now, updatedAt: now })
          .where(eq(schema.tasks.id, local.id));
      }
      // else: task is open but filtered out (archived project, etc.) — leave as-is
    } catch (e: any) {
      // 404 = deleted remotely. Other errors = flag for reconciliation.
      const isNotFound = e?.message?.includes('404') || e?.status === 404;
      await db.update(schema.tasks)
        .set({
          status: isNotFound ? 'killed' : 'needs_reconcile',
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, local.id));
    }
  }

  await db.insert(schema.syncState)
    .values({ id: 'singleton', lastFullSync: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.syncState.id,
      set: { lastFullSync: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });

  return synced;
}

export async function pushTaskToTodoist(localTask: schema.Task): Promise<boolean> {
  if (!localTask.todoistId) return false;

  // Resolve Todoist project — create in Todoist if it only exists locally
  let todoistProjectId: string | undefined;
  if (localTask.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, localTask.projectId),
    });

    if (project) {
      if (project.todoistId) {
        todoistProjectId = project.todoistId;
      } else {
        // Check if a Todoist project with this name already exists
        const existing = await todoist.findProjectByName(project.name);
        if (existing) {
          todoistProjectId = existing.id;
        } else {
          // Create the project in Todoist
          const created = await todoist.createProject({ name: project.name });
          todoistProjectId = created.id;
        }
        // Store the Todoist ID back on the local project
        await db.update(schema.projects)
          .set({ todoistId: todoistProjectId, todoistSyncedAt: new Date().toISOString() })
          .where(eq(schema.projects.id, project.id));
      }
    }
  }

  // Update task content, priority, labels, description (v1 update does NOT move)
  await todoist.updateTask(localTask.todoistId, {
    content: localTask.title,
    description: localTask.nextAction || localTask.description || undefined,
    priority: mapToTodoistPriority(localTask.priority || 4),
    labels: JSON.parse(localTask.labels || '[]'),
    due_date: localTask.dueDate || undefined,
  });

  // Move task to the target project (separate API call in v1)
  if (todoistProjectId) {
    await todoist.moveTask(localTask.todoistId, { project_id: todoistProjectId });
  }

  // Add context comment only on first push (when status is transitioning from inbox)
  // Prevents duplicate comments on subsequent syncs
  if (localTask.contextNotes && localTask.status === 'inbox') {
    await todoist.addComment({
      task_id: localTask.todoistId,
      content: `🔥 **Burn-Down Engine Context**\n\n${localTask.contextNotes}`,
    });
  }

  return true;
}

/**
 * Push locally-created subtasks to Todoist as children of the parent task.
 * Returns the number of subtasks successfully created.
 */
export async function pushSubtasksToTodoist(
  parentTodoistId: string,
  subtasks: schema.Task[],
  todoistProjectId?: string,
): Promise<number> {
  const pending = subtasks.filter(sub => !sub.todoistId);
  if (pending.length === 0) return 0;

  // Parallelize subtask creation (was serial — N subtasks = 2N sequential ops)
  const results = await Promise.allSettled(pending.map(async (sub) => {
    const todoistSub = await todoist.createTask({
      content: sub.title,
      description: sub.nextAction || undefined,
      parent_id: parentTodoistId,
      priority: mapToTodoistPriority(sub.priority || 4),
      labels: JSON.parse(sub.labels || '[]'),
      project_id: todoistProjectId,
    });

    await db.update(schema.tasks)
      .set({ todoistId: todoistSub.id, todoistSyncedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, sub.id));
  }));

  return results.filter(r => r.status === 'fulfilled').length;
}

export async function completeTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.completeTask(localTask.todoistId);
}

export async function reopenTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.reopenTask(localTask.todoistId);
}

export async function killTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.deleteTask(localTask.todoistId);
}

/** Re-create a killed/deleted task in Todoist and return the new Todoist ID */
export async function recreateTaskInTodoist(localTask: schema.Task): Promise<string | null> {
  if (!localTask.title) return null;

  // Resolve project's Todoist ID if we have a local project reference
  let todoistProjectId: string | undefined;
  if (localTask.projectId) {
    const proj = await db.query.projects.findFirst({
      where: eq(schema.projects.id, localTask.projectId),
    });
    todoistProjectId = proj?.todoistId || undefined;
  }

  const created = await todoist.createTask({
    content: localTask.title,
    description: localTask.nextAction || undefined,
    project_id: todoistProjectId,
    priority: mapToTodoistPriority(localTask.priority || 4),
    due_date: localTask.dueDate || undefined,
    labels: JSON.parse(localTask.labels || '[]'),
  });

  return created.id;
}

export async function syncTaskDueDate(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.updateTask(localTask.todoistId, {
    due_date: localTask.dueDate || undefined,
  });
}

export async function syncTaskLabels(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.updateTask(localTask.todoistId, {
    labels: JSON.parse(localTask.labels || '[]'),
  });
}

export async function addTodoistComment(todoistTaskId: string, content: string): Promise<void> {
  await todoist.addComment({ task_id: todoistTaskId, content });
}

// ─── Project Count Refresh ───────────────────────────────────

/**
 * Recalculates openActionCount and lastActivityAt for all projects
 * based on actual task data. Fixes the "0 tasks / Stale" display issue.
 */
/**
 * Incrementally adjust project counts when a task moves between projects.
 * Much cheaper than a full refreshProjectCounts() scan.
 */
export async function adjustProjectCounts(
  oldProjectId: string | null,
  newProjectId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  if (oldProjectId) {
    await db.update(schema.projects)
      .set({ openActionCount: sql`MAX(0, ${schema.projects.openActionCount} - 1)`, lastActivityAt: now })
      .where(eq(schema.projects.id, oldProjectId));
  }
  if (newProjectId) {
    await db.update(schema.projects)
      .set({ openActionCount: sql`${schema.projects.openActionCount} + 1`, lastActivityAt: now })
      .where(eq(schema.projects.id, newProjectId));
  }
}

export async function refreshProjectCounts(): Promise<void> {
  const allProjects = await db.query.projects.findMany();

  // Batch: get all tasks at once instead of 2N queries
  const allTasks = await db.query.tasks.findMany({
    where: sql`${schema.tasks.projectId} IS NOT NULL`,
  });

  // Group by project
  const countsByProject = new Map<string, { open: number; lastActivity: string | null }>();
  for (const t of allTasks) {
    if (!t.projectId) continue;
    const entry = countsByProject.get(t.projectId) || { open: 0, lastActivity: null };
    if (t.status !== 'completed' && t.status !== 'killed') entry.open++;
    const taskDate = t.completedAt || t.updatedAt || t.createdAt;
    if (taskDate && (!entry.lastActivity || taskDate > entry.lastActivity)) {
      entry.lastActivity = taskDate;
    }
    countsByProject.set(t.projectId, entry);
  }

  // Update all projects in parallel
  await Promise.all(allProjects.map(project => {
    const counts = countsByProject.get(project.id) || { open: 0, lastActivity: project.lastActivityAt };
    return db.update(schema.projects)
      .set({
        openActionCount: counts.open,
        lastActivityAt: counts.lastActivity,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, project.id));
  }));
}
