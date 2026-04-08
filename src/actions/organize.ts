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
  // Fetch data first, then build context from real material
  const [allProjects, allTasks] = await Promise.all([
    db.query.projects.findMany(),
    db.query.tasks.findMany({ where: ne(schema.tasks.status, 'killed') }),
  ]);

  // Build context from project names + goals for semantic retrieval
  const projectSummaryInput = allProjects
    .filter(p => p.status === 'active')
    .map(p => `${p.name}${p.goal ? ': ' + p.goal : ''}`)
    .join(' | ');
  const context = await buildContext(projectSummaryInput, 'organize');

  const projectIdToName = new Map(allProjects.map(p => [p.id, p.name]));

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
    };
  });

  // Only send active tasks to reduce token usage — use project names instead of IDs
  const activeTasks = allTasks.filter(t => t.status !== 'completed');

  const result = await llmGenerateJSON<any>({
    operation: 'project_audit',
    system: PROJECT_AUDIT_PROMPT,
    prompt: `## Context\n${context}\n\n## Project Registry\n${JSON.stringify(projectSummaries)}\n\n## Active Tasks (${activeTasks.length} of ${allTasks.length} total)\n${JSON.stringify(activeTasks.map(t => ({ title: t.title, project: projectIdToName.get(t.projectId || '') || 'Inbox', status: t.status, priority: t.priority })))}`,
  });

  // Process any knowledge extracted
  if (result.knowledgeExtracted) {
    processInlineKnowledge(result.knowledgeExtracted, 'organize');
  }

  return result;
}

export async function archiveProject(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (project?.todoistId) {
    try {
      await todoist.archiveProject(project.todoistId);
    } catch (e) {
      // Fall back to rename if Sync API fails
      console.error('Archive via Sync API failed, falling back to rename:', e);
      try {
        await todoist.updateProject(project.todoistId, {
          name: `[Archived] ${project.name}`,
        });
      } catch {}
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
  // Fetch all active non-completed tasks
  const allActive = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'inbox'),
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'someday'),
    ),
  });

  // Unfiled tasks (no project)
  const unfiled = allActive.filter(t => !t.projectId);

  // Filed tasks with organizational smells
  const smelly = allActive.filter(t => {
    if (!t.projectId) return false; // already in unfiled
    const hasNoNextAction = !t.nextAction || t.nextAction.trim() === '';
    const labels = JSON.parse(t.labels || '[]');
    const hasNoLabels = labels.length === 0;
    return hasNoNextAction || hasNoLabels;
  });

  // Unfiled tasks are highest priority, fill remaining slots with smelly filed tasks
  const candidates = [...unfiled, ...smelly.slice(0, Math.max(0, 30 - unfiled.length))].slice(0, 30);
  if (candidates.length === 0) return { suggestions: [] };

  const taskInput = candidates.map(t => t.title).join(' | ');
  const context = await buildContext(taskInput, 'organize');

  const allProjects = await db.query.projects.findMany();
  const projectMap = new Map(allProjects.map(p => [p.id, p.name]));

  return llmGenerateJSON<any>({
    operation: 'file_suggestions',
    system: FILING_SUGGESTIONS_PROMPT,
    prompt: `## Context\n${context}\n\n## Tasks to Review\n${JSON.stringify(candidates.map(t => ({ id: t.id, title: t.title, nextAction: t.nextAction, labels: t.labels, currentProject: projectMap.get(t.projectId || '') || null })), null, 2)}`,
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
