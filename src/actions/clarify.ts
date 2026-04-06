'use server';

import { db, schema } from '@/lib/db/client';
import { llmGenerateJSON } from '@/lib/llm/router';
import { buildContext } from '@/lib/llm/context';
import { CLARIFY_SYSTEM_PROMPT } from '@/lib/llm/prompts/clarify';
import { extractAndStoreKnowledge, processInlineKnowledge } from '@/lib/llm/extraction';
import { embedTask } from '@/lib/embeddings/generate';
import { pushTaskToTodoist, pushSubtasksToTodoist } from '@/lib/todoist/sync';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// ─── Context Cache ──────────────────────────────────────────
// Caches buildContext() results by task text. Re-instruct on the same task
// reuses the context instead of making another embedding API call.
// TTL: 5 minutes. Cleared on module reload.
const contextCache = new Map<string, { context: string; ts: number }>();
const CONTEXT_CACHE_TTL = 5 * 60 * 1000;

async function getCachedContext(input: string, page: 'inbox' | 'clarify' | 'organize' | 'engage' | 'reflect'): Promise<string> {
  const key = `${page}:${input}`;
  const cached = contextCache.get(key);
  if (cached && Date.now() - cached.ts < CONTEXT_CACHE_TTL) {
    return cached.context;
  }
  const context = await buildContext(input, page);
  contextCache.set(key, { context, ts: Date.now() });
  // Prune old entries
  if (contextCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of contextCache) {
      if (now - v.ts > CONTEXT_CACHE_TTL) contextCache.delete(k);
    }
  }
  return context;
}

interface ClarifyResult {
  title: string;
  nextAction: string;
  projectName: string;
  newProject: boolean;
  priority: number;
  priorityReasoning: string;
  labels: string[];
  dueDate: string | null;
  timeEstimateMin: number;
  energyLevel: 'high' | 'medium' | 'low';
  contextNotes: string;
  relatedPeople: string[];
  relatedLinks: string[];
  decompositionNeeded: boolean;
  subtasks: { title: string; nextAction: string }[];
  confidence: number;
  questions: string[];
  knowledgeExtracted: { category: string; key: string; value: string; confidence: number }[];
}

export async function clarifyTask(taskId: string, additionalInstructions?: string): Promise<ClarifyResult> {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) throw new Error('Task not found');

  const context = await getCachedContext(task.originalText, 'clarify');

  const instructionSuffix = additionalInstructions
    ? `\n\n## Additional User Instructions\n${additionalInstructions}`
    : '';

  // Include previous clarification result so re-instructions build on the latest state
  let previousClarification = '';
  if (task.llmNotes && additionalInstructions) {
    try {
      const prev = JSON.parse(task.llmNotes);
      previousClarification = `\n\n## Previous Clarification Result\nIMPORTANT: Start from this result. Only change the specific fields the user asked to change. Keep ALL other fields exactly as they are — do not rewrite title, nextAction, priority, labels, timeEstimate, energyLevel, contextNotes, or any other field unless the user's instruction specifically targets it.\n\n${JSON.stringify(prev, null, 2)}`;
    } catch {}
  }

  const result = await llmGenerateJSON<ClarifyResult>({
    system: CLARIFY_SYSTEM_PROMPT,
    prompt: `## Knowledge Context\n${context}\n\n## Task to Clarify\n"${task.originalText}"${previousClarification}${instructionSuffix}`,
    operation: 'clarify_task',
  });

  // Store the clarification result on the task (but don't apply yet)
  await db.update(schema.tasks)
    .set({
      clarifyConfidence: result.confidence,
      clarifyQuestions: result.questions.length > 0 ? JSON.stringify(result.questions) : null,
      llmNotes: JSON.stringify(result),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId));

  // Extract knowledge from the interaction (best-effort, non-blocking)
  void processInlineKnowledge(result.knowledgeExtracted, 'clarify').catch(() => {});

  return result;
}

export async function applyClarification(
  taskId: string,
  clarification: ClarifyResult
): Promise<schema.Task> {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) throw new Error('Task not found');

  // ── Step 1: Resolve or create project ──────────────────────
  let projectId: string | null = null;
  let todoistProjectId: string | undefined;
  if (clarification.projectName) {
    const existingProject = await db.query.projects.findFirst({
      where: eq(schema.projects.name, clarification.projectName),
    });

    if (existingProject) {
      projectId = existingProject.id;
      todoistProjectId = existingProject.todoistId || undefined;
    } else if (clarification.newProject) {
      // Create locally first (we'll get the todoistId in pushTaskToTodoist)
      const created = await db.insert(schema.projects)
        .values({
          name: clarification.projectName,
          status: 'active',
        })
        .returning();
      projectId = created[0].id;
    }
  }

  // ── Step 2: Store LLM enrichment on task (metadata we own) ─
  // Keep status as 'inbox' — only promote after Todoist confirms
  await db.update(schema.tasks)
    .set({
      title: clarification.title,
      nextAction: clarification.nextAction,
      projectId,
      priority: clarification.priority,
      labels: JSON.stringify(clarification.labels || []),
      dueDate: clarification.dueDate || null,
      timeEstimateMin: clarification.timeEstimateMin,
      energyLevel: clarification.energyLevel,
      contextNotes: clarification.contextNotes,
      relatedPeople: JSON.stringify(clarification.relatedPeople),
      relatedLinks: JSON.stringify(clarification.relatedLinks),
      clarifyConfidence: clarification.confidence,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId));

  // Re-fetch with enrichment applied (still status='inbox')
  const enrichedTask = (await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  }))!;

  // ── Step 3: Push to Todoist (source of truth) ──────────────
  const pushed = await pushTaskToTodoist(enrichedTask);

  if (!pushed) {
    // Todoist push failed — task stays inbox, user can retry
    // Still revalidate since task metadata (title, project, etc.) was updated in Step 2
    revalidatePath('/inbox');
    revalidatePath('/clarify');
    return enrichedTask;
  }

  // ── Step 4: Todoist confirmed — now promote locally ────────
  const updated = await db.update(schema.tasks)
    .set({
      status: 'clarified',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  const finalTask = updated[0];

  // ── Step 5: Create subtasks in DB and push to Todoist ──────
  if (clarification.decompositionNeeded && clarification.subtasks.length > 0) {
    const validSubtasks = clarification.subtasks.filter(sub => sub.title?.trim());
    const createdSubtasks: schema.Task[] = [];

    for (const sub of validSubtasks) {
      const created = await db.insert(schema.tasks).values({
        originalText: sub.title,
        title: sub.title,
        nextAction: sub.nextAction || null,
        projectId,
        priority: clarification.priority,
        parentTaskId: taskId,
        isDecomposed: true,
        status: 'clarified',
      }).returning();
      createdSubtasks.push(created[0]);
    }

    if (task.todoistId && createdSubtasks.length > 0) {
      // Look up the todoist project ID for subtask creation
      let subProjectId: string | undefined = todoistProjectId;
      if (!subProjectId && projectId) {
        const proj = await db.query.projects.findFirst({
          where: eq(schema.projects.id, projectId),
        });
        subProjectId = proj?.todoistId || undefined;
      }
      await pushSubtasksToTodoist(task.todoistId, createdSubtasks, subProjectId);
    }

    await db.update(schema.tasks)
      .set({ isDecomposed: true })
      .where(eq(schema.tasks.id, taskId));
  }

  // ── Step 6: Log history and generate embedding ─────────────
  await db.insert(schema.taskHistory).values({
    taskId,
    action: 'clarified',
    details: JSON.stringify({
      from: task.originalText,
      to: clarification.title,
      confidence: clarification.confidence,
    }),
  });

  // Generate embedding (best-effort, non-blocking)
  void embedTask(finalTask).catch(() => {});

  revalidatePath('/inbox');
  revalidatePath('/clarify');
  revalidatePath('/engage');
  return finalTask;
}

export async function getTasksForClarify() {
  return db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
    orderBy: (tasks, { asc }) => [asc(tasks.createdAt)],
  });
}

export async function answerClarifyQuestion(taskId: string, answer: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) throw new Error('Task not found');

  // Re-clarify with the additional context
  // Reuse cached context from the original task text (answer doesn't change the relevant knowledge)
  const context = await getCachedContext(task.originalText, 'clarify');

  const result = await llmGenerateJSON<ClarifyResult>({
    system: CLARIFY_SYSTEM_PROMPT,
    prompt: `## Knowledge Context\n${context}\n\n## Task to Clarify\n"${task.originalText}"\n\n## User's Answer to Previous Questions\n${answer}`,
    operation: 'clarify_task',
  });

  // Extract knowledge from the answer
  extractAndStoreKnowledge({
    input: `Task: ${task.originalText}\nAnswer: ${answer}`,
    output: JSON.stringify(result),
    page: 'clarify',
  });

  return result;
}

export async function batchApproveClarifications(
  approvals: { taskId: string; clarification: ClarifyResult }[]
) {
  const results = [];
  for (const { taskId, clarification } of approvals) {
    const result = await applyClarification(taskId, clarification);
    results.push(result);
  }
  revalidatePath('/inbox');
  revalidatePath('/clarify');
  revalidatePath('/engage');
  return results;
}
