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

  // Upsert tasks currently in Todoist inbox — batch writes in parallel
  const upsertPromises = todoistTasks.map(async (tt) => {
    const existing = existingByTodoistId.get(tt.id);

    if (existing) {
      const updated = await db.update(schema.tasks)
        .set({
          title: tt.content,
          description: tt.description || null,
          dueDate: tt.due?.date || null,
          labels: JSON.stringify(tt.labels),
          isRecurring: tt.due?.is_recurring || false,
          recurrenceRule: tt.due?.string || null,
          status: 'inbox',
          todoistSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, existing.id))
        .returning();
      return updated[0];
    } else {
      const created = await db.insert(schema.tasks)
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
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
      return created[0];
    }
  });
  const synced = await Promise.all(upsertPromises);

  // Reconcile: local tasks marked 'inbox' that are no longer in Todoist inbox
  const localInbox = await db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
  });

  // Batch reconciliation — group by target status to minimize updates
  const toClarified: string[] = [];
  const toActive: string[] = [];
  for (const local of localInbox) {
    if (!local.todoistId) continue;
    if (todoistInboxIds.has(local.todoistId)) continue;
    if (local.clarifyConfidence) {
      toClarified.push(local.id);
    } else {
      toActive.push(local.id);
    }
  }
  const now = new Date().toISOString();
  if (toClarified.length > 0) {
    await db.update(schema.tasks)
      .set({ status: 'clarified', updatedAt: now })
      .where(inArray(schema.tasks.id, toClarified));
  }
  if (toActive.length > 0) {
    await db.update(schema.tasks)
      .set({ status: 'active', updatedAt: now })
      .where(inArray(schema.tasks.id, toActive));
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

  for (const tp of todoistProjects) {
    if (tp.inbox_project) continue; // Skip inbox pseudo-project

    const existing = await db.query.projects.findFirst({
      where: eq(schema.projects.todoistId, tp.id),
    });

    if (existing) {
      const updated = await db.update(schema.projects)
        .set({
          name: tp.name,
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
          status: 'active',
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
      synced.push(created[0]);
    }
  }

  return synced;
}

export async function syncAllTasks(): Promise<schema.Task[]> {
  const allTasks = await todoist.getTasks();
  const projects = await todoist.getProjects();
  const inboxId = projects.find(p => p.inbox_project)?.id;
  const synced: schema.Task[] = [];

  for (const tt of allTasks) {
    const isInbox = tt.project_id === inboxId;
    const existing = await db.query.tasks.findFirst({
      where: eq(schema.tasks.todoistId, tt.id),
    });

    // Find local project
    let localProjectId: string | null = null;
    if (!isInbox) {
      const localProject = await db.query.projects.findFirst({
        where: eq(schema.projects.todoistId, tt.project_id),
      });
      localProjectId = localProject?.id || null;
    }

    if (existing) {
      const updated = await db.update(schema.tasks)
        .set({
          title: tt.content,
          description: tt.description || null,
          projectId: localProjectId,
          dueDate: tt.due?.date || null,
          labels: JSON.stringify(tt.labels),
          isRecurring: tt.due?.is_recurring || false,
          recurrenceRule: tt.due?.string || null,
          todoistSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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

  // Add context as comment if present
  if (localTask.contextNotes) {
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
  let created = 0;
  for (const sub of subtasks) {
    if (sub.todoistId) continue; // Already in Todoist

    const todoistSub = await todoist.createTask({
      content: sub.title,
      description: sub.nextAction || undefined,
      parent_id: parentTodoistId,
      priority: mapToTodoistPriority(sub.priority || 4),
      labels: JSON.parse(sub.labels || '[]'),
      project_id: todoistProjectId,
    });

    // Store the Todoist ID back on the local subtask
    await db.update(schema.tasks)
      .set({ todoistId: todoistSub.id, todoistSyncedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, sub.id));

    created++;
  }
  return created;
}

export async function completeTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.completeTask(localTask.todoistId);
}

export async function killTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.deleteTask(localTask.todoistId);
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
export async function refreshProjectCounts(): Promise<void> {
  const allProjects = await db.query.projects.findMany();

  for (const project of allProjects) {
    // Count open (non-completed, non-killed) tasks in this project
    const openTasks = await db.query.tasks.findMany({
      where: and(
        eq(schema.tasks.projectId, project.id),
        ne(schema.tasks.status, 'completed'),
        ne(schema.tasks.status, 'killed'),
      ),
    });

    // Find most recent activity (any task update in this project)
    const allProjectTasks = await db.query.tasks.findMany({
      where: eq(schema.tasks.projectId, project.id),
    });

    let lastActivity: string | null = project.lastActivityAt;
    for (const t of allProjectTasks) {
      const taskDate = t.completedAt || t.updatedAt || t.createdAt;
      if (taskDate && (!lastActivity || taskDate > lastActivity)) {
        lastActivity = taskDate;
      }
    }

    await db.update(schema.projects)
      .set({
        openActionCount: openTasks.length,
        lastActivityAt: lastActivity,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.projects.id, project.id));
  }
}
