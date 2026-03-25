'use server';

import { syncInbox, syncProjects, syncAllTasks } from '@/lib/todoist/sync';
import { db, schema } from '@/lib/db/client';
import { revalidatePath } from 'next/cache';

export async function fullSync() {
  await syncProjects();
  const tasks = await syncAllTasks();
  revalidatePath('/inbox');
  revalidatePath('/engage');
  revalidatePath('/organize');
  return { synced: tasks.length };
}

export async function inboxSync() {
  await syncProjects();
  const tasks = await syncInbox();
  revalidatePath('/inbox');
  return { synced: tasks.length };
}

export async function getSyncState() {
  return db.query.syncState.findFirst();
}
