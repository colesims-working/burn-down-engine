'use server';

import { db, schema } from '@/lib/db/client';
import { syncInbox, syncProjects } from '@/lib/todoist/sync';
import { todoist } from '@/lib/todoist/client';
import { processVoiceDump } from '@/lib/voice/whisper';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function syncInboxAction() {
  await syncProjects();
  const tasks = await syncInbox();
  revalidatePath('/inbox');
  return tasks;
}

export async function getInboxTasks() {
  return db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
    orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
  });
}

export async function quickAddTask(content: string) {
  // Create in Todoist
  const todoistTask = await todoist.createTask({ content });

  // Create locally
  const task = await db.insert(schema.tasks)
    .values({
      todoistId: todoistTask.id,
      originalText: content,
      title: content,
      status: 'inbox',
      todoistSyncedAt: new Date().toISOString(),
    })
    .returning();

  revalidatePath('/inbox');
  return task[0];
}

export async function processVoiceDumpAction(formData: FormData) {
  const audioFile = formData.get('audio') as File;
  if (!audioFile) throw new Error('No audio file provided');

  const buffer = Buffer.from(await audioFile.arrayBuffer());
  const result = await processVoiceDump(buffer, audioFile.type);

  return result;
}

export async function addVoiceTasksToInbox(tasks: { text: string }[]) {
  const created = [];
  for (const task of tasks) {
    const todoistTask = await todoist.createTask({ content: task.text });
    const local = await db.insert(schema.tasks)
      .values({
        todoistId: todoistTask.id,
        originalText: task.text,
        title: task.text,
        status: 'inbox',
        todoistSyncedAt: new Date().toISOString(),
      })
      .returning();
    created.push(local[0]);
  }

  revalidatePath('/inbox');
  return created;
}

export async function getInboxCount() {
  const tasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
  });
  return tasks.length;
}
