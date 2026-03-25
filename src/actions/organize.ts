'use server';

import { db, schema } from '@/lib/db/client';
import { llmGenerateJSON, llmGenerate } from '@/lib/llm/router';
import { buildContext } from '@/lib/llm/context';
import { PROJECT_AUDIT_PROMPT, FILING_SUGGESTIONS_PROMPT, ORGANIZE_CONVERSATION_PROMPT } from '@/lib/llm/prompts/organize';
import { processInlineKnowledge } from '@/lib/llm/extraction';
import { todoist } from '@/lib/todoist/client';
import { eq, ne, and, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getProjects(status?: string) {
  if (status) {
    return db.query.projects.findMany({
      where: eq(schema.projects.status, status as any),
      orderBy: (p, { desc }) => [desc(p.lastActivityAt)],
    });
  }
  return db.query.projects.findMany({
    orderBy: (p, { desc }) => [desc(p.lastActivityAt)],
  });
}

export async function getProjectWithTasks(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });

  const tasks = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.projectId, projectId),
      ne(schema.tasks.status, 'killed'),
    ),
  });

  return { project, tasks };
}

export async function runProjectAudit() {
  const allProjects = await db.query.projects.findMany();
  const allTasks = await db.query.tasks.findMany({
    where: ne(schema.tasks.status, 'killed'),
  });

  const context = await buildContext('', 'organize');

  const projectSummaries = allProjects.map(p => {
    const projectTasks = allTasks.filter(t => t.projectId === p.id);
    const activeTasks = projectTasks.filter(t => t.status !== 'completed');
    return {
      name: p.name,
      category: p.category,
      status: p.status,
      goal: p.goal,
      openTasks: activeTasks.length,
      totalTasks: projectTasks.length,
      lastActivity: p.lastActivityAt,
      notes: p.notes,
    };
  });

  const result = await llmGenerateJSON<any>({
    operation: 'project_audit',
    system: PROJECT_AUDIT_PROMPT,
    prompt: `## Context\n${context}\n\n## Project Registry\n${JSON.stringify(projectSummaries, null, 2)}\n\n## All Tasks\n${JSON.stringify(allTasks.map(t => ({ title: t.title, project: t.projectId, status: t.status, priority: t.priority })), null, 2)}`,
  });

  // Process any knowledge extracted
  if (result.knowledgeExtracted) {
    processInlineKnowledge(result.knowledgeExtracted, 'organize');
  }

  return result;
}

export async function archiveProject(projectId: string) {
  // Push archive to Todoist (rename with prefix since REST API has no archive)
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (project?.todoistId) {
    try {
      await todoist.updateProject(project.todoistId, {
        name: `[Archived] ${project.name}`,
      });
    } catch (e) {
      console.error('Failed to push archive to Todoist:', e);
    }
  }

  await db.update(schema.projects)
    .set({ status: 'archived', updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));

  revalidatePath('/organize');
}

export async function createProject(data: { name: string; category?: string; goal?: string }) {
  // Create in Todoist
  const todoistProject = await todoist.createProject({ name: data.name });

  // Create locally
  const created = await db.insert(schema.projects)
    .values({
      todoistId: todoistProject.id,
      name: data.name,
      category: data.category as any,
      goal: data.goal,
      status: 'active',
      todoistSyncedAt: new Date().toISOString(),
    })
    .returning();

  revalidatePath('/organize');
  return created[0];
}

export async function updateProject(projectId: string, data: Partial<schema.NewProject>) {
  // Push name/rename to Todoist if linked
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (project?.todoistId) {
    const todoistData: Record<string, string> = {};
    if (data.name) todoistData.name = data.name;
    if (Object.keys(todoistData).length > 0) {
      try {
        await todoist.updateProject(project.todoistId, todoistData);
      } catch (e) {
        console.error('Failed to push project update to Todoist:', e);
      }
    }
  }

  const updated = await db.update(schema.projects)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId))
    .returning();

  revalidatePath('/organize');
  return updated[0];
}

export async function getFilingSuggestions() {
  const unfiled = await db.query.tasks.findMany({
    where: and(
      isNull(schema.tasks.projectId),
      ne(schema.tasks.status, 'inbox'),
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
    ),
  });

  if (unfiled.length === 0) return { suggestions: [] };

  const context = await buildContext('', 'organize');

  return llmGenerateJSON<any>({
    operation: 'file_suggestions',
    system: FILING_SUGGESTIONS_PROMPT,
    prompt: `## Context\n${context}\n\n## Unfiled Tasks\n${JSON.stringify(unfiled.map(t => ({ id: t.id, title: t.title, nextAction: t.nextAction, labels: t.labels })), null, 2)}`,
  });
}

export async function organizeConversation(message: string) {
  const context = await buildContext(message, 'organize');

  const response = await llmGenerate({
    operation: 'organize_conversation',
    system: ORGANIZE_CONVERSATION_PROMPT,
    prompt: `## Context\n${context}\n\n## User Message\n${message}`,
  });

  return response;
}
