import { db, schema } from '@/lib/db/client';
import { todoist, TodoistTask, TodoistProject } from './client';
import { eq, sql } from 'drizzle-orm';

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
  const synced: schema.Task[] = [];

  for (const tt of todoistTasks) {
    const existing = await db.query.tasks.findFirst({
      where: eq(schema.tasks.todoistId, tt.id),
    });

    if (existing) {
      // Update if Todoist is newer
      const updated = await db.update(schema.tasks)
        .set({
          title: tt.content,
          description: tt.description || null,
          dueDate: tt.due?.date || null,
          labels: JSON.stringify(tt.labels),
          isRecurring: tt.due?.recurring || false,
          recurrenceRule: tt.due?.string || null,
          todoistSyncedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, existing.id))
        .returning();
      synced.push(updated[0]);
    } else {
      // Create new local task
      const created = await db.insert(schema.tasks)
        .values({
          todoistId: tt.id,
          originalText: tt.content,
          title: tt.content,
          description: tt.description || null,
          dueDate: tt.due?.date || null,
          priority: mapFromTodoistPriority(tt.priority),
          labels: JSON.stringify(tt.labels),
          isRecurring: tt.due?.recurring || false,
          recurrenceRule: tt.due?.string || null,
          status: 'inbox',
          todoistSyncedAt: new Date().toISOString(),
        })
        .returning();
      synced.push(created[0]);
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

  for (const tp of todoistProjects) {
    if (tp.is_inbox_project) continue; // Skip inbox pseudo-project

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
  const inboxId = projects.find(p => p.is_inbox_project)?.id;
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
          isRecurring: tt.due?.recurring || false,
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
          isRecurring: tt.due?.recurring || false,
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

export async function pushTaskToTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;

  // Find Todoist project ID
  let todoistProjectId: string | undefined;
  if (localTask.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, localTask.projectId),
    });
    todoistProjectId = project?.todoistId || undefined;
  }

  await todoist.updateTask(localTask.todoistId, {
    content: localTask.title,
    description: localTask.nextAction || localTask.description || undefined,
    project_id: todoistProjectId,
    priority: mapToTodoistPriority(localTask.priority || 4),
    labels: JSON.parse(localTask.labels || '[]'),
    due_date: localTask.dueDate || undefined,
  });

  // Add context as comment if present
  if (localTask.contextNotes) {
    await todoist.addComment({
      task_id: localTask.todoistId,
      content: `🔥 **Burn-Down Engine Context**\n\n${localTask.contextNotes}`,
    });
  }
}

export async function completeTaskInTodoist(localTask: schema.Task): Promise<void> {
  if (!localTask.todoistId) return;
  await todoist.completeTask(localTask.todoistId);
}
