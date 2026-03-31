'use server';

import { db, schema } from '@/lib/db/client';
import {
  buildEngageList,
  completeTask as completeTaskEngine,
  bumpTask as bumpTaskEngine,
  blockTask as blockTaskEngine,
  waitTask as waitTaskEngine,
  handleFire,
} from '@/lib/priority/engine';
import { completeTaskInTodoist, killTaskInTodoist } from '@/lib/todoist/sync';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getEngageList() {
  return buildEngageList();
}

export async function completeTaskAction(taskId: string) {
  const task = await completeTaskEngine(taskId);

  // Sync completion to Todoist
  try {
    await completeTaskInTodoist(task);
  } catch (error) {
    console.error('Failed to complete in Todoist:', error);
  }

  revalidatePath('/engage');
  revalidatePath('/reflect');
  return task;
}

export async function deferTaskAction(taskId: string, reason?: string) {
  const task = await bumpTaskEngine(taskId, reason);
  revalidatePath('/engage');
  return task; // includes antiPileUp flag when bumpCount >= 3
}

export async function blockTaskAction(taskId: string, blockerNote: string) {
  const task = await blockTaskEngine(taskId, blockerNote);
  revalidatePath('/engage');
  return task;
}

export async function waitTaskAction(taskId: string, waitingFor: string) {
  const task = await waitTaskEngine(taskId, waitingFor);
  revalidatePath('/engage');
  return task;
}

export async function handleFireAction(description: string) {
  const result = await handleFire({ description });
  revalidatePath('/engage');
  return result;
}

export async function killTaskAction(taskId: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });

  const updated = await db.update(schema.tasks)
    .set({ status: 'killed', updatedAt: new Date().toISOString() })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'killed',
    details: JSON.stringify({ killedAt: new Date().toISOString() }),
  });

  // Delete from Todoist (source of truth)
  if (task) {
    try {
      await killTaskInTodoist(task);
    } catch (error) {
      console.error('Failed to delete killed task in Todoist:', error);
    }
  }

  revalidatePath('/engage');
  return updated[0];
}
