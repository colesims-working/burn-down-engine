import { db, schema } from '@/lib/db/client';
import { eq } from 'drizzle-orm';
import {
  reopenTaskInTodoist,
  recreateTaskInTodoist,
  syncTaskDueDate,
  syncTaskLabels,
} from '@/lib/todoist/sync';

export interface TaskSnapshot {
  status: string | null;
  priority: number | null;
  dueDate: string | null;
  bumpCount: number | null;
  labels: string | null;
  blockerNote: string | null;
  completedAt: string | null;
  todoistId: string | null;
}

export type UndoableAction =
  | 'completed'
  | 'killed'
  | 'bumped'
  | 'blocked'
  | 'waiting'
  | 'clarify_approved'
  | 'clarify_rejected';

export function snapshotTask(task: schema.Task): TaskSnapshot {
  return {
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    bumpCount: task.bumpCount,
    labels: task.labels,
    blockerNote: task.blockerNote,
    completedAt: task.completedAt,
    todoistId: task.todoistId,
  };
}

/**
 * Revert a task to a previous state in the local DB, then reconcile with Todoist.
 */
export async function revertTask(
  taskId: string,
  snapshot: TaskSnapshot,
  action: UndoableAction,
  todoistAlreadySynced: boolean,
): Promise<schema.Task> {
  // Restore local DB state
  const updated = await db.update(schema.tasks)
    .set({
      status: snapshot.status as any,
      priority: snapshot.priority,
      dueDate: snapshot.dueDate,
      bumpCount: snapshot.bumpCount,
      labels: snapshot.labels,
      blockerNote: snapshot.blockerNote,
      completedAt: snapshot.completedAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  const task = updated[0];
  if (!task) throw new Error('Task not found for undo');

  // Reconcile with Todoist if the original action was already pushed
  if (todoistAlreadySynced) {
    try {
      switch (action) {
        case 'completed':
          // Reopen the task in Todoist
          await reopenTaskInTodoist(task);
          break;

        case 'killed': {
          // Task was deleted from Todoist — re-create it
          const newTodoistId = await recreateTaskInTodoist(task);
          if (newTodoistId) {
            await db.update(schema.tasks)
              .set({ todoistId: newTodoistId, todoistSyncedAt: new Date().toISOString() })
              .where(eq(schema.tasks.id, taskId));
          }
          break;
        }

        case 'bumped':
          // Restore the original due date in Todoist
          await syncTaskDueDate(task);
          break;

        case 'blocked':
        case 'waiting':
          // Restore original labels in Todoist (comment cannot be removed)
          await syncTaskLabels(task);
          break;
      }
    } catch (e) {
      console.error(`Undo Todoist reconciliation failed for ${action}:`, e);
      // Local state was already reverted — Todoist will catch up on next sync
    }
  }

  // Log the undo accurately in task history
  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'undone',
    details: JSON.stringify({ type: 'undo', undoneAction: action, restoredTo: snapshot }),
  });

  return task;
}
