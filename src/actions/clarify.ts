'use server';

import { db, schema } from '@/lib/db/client';
import { geminiGenerateJSON } from '@/lib/llm/gemini';
import { buildContext } from '@/lib/llm/context';
import { CLARIFY_SYSTEM_PROMPT } from '@/lib/llm/prompts/clarify';
import { extractAndStoreKnowledge, processInlineKnowledge } from '@/lib/llm/extraction';
import { embedTask } from '@/lib/embeddings/generate';
import { pushTaskToTodoist } from '@/lib/todoist/sync';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

interface ClarifyResult {
  title: string;
  nextAction: string;
  projectName: string;
  newProject: boolean;
  priority: number;
  priorityReasoning: string;
  labels: string[];
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

export async function clarifyTask(taskId: string): Promise<ClarifyResult> {
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) throw new Error('Task not found');

  const context = await buildContext(task.originalText, 'clarify');

  const result = await geminiGenerateJSON<ClarifyResult>({
    system: CLARIFY_SYSTEM_PROMPT,
    prompt: `## Knowledge Context\n${context}\n\n## Task to Clarify\n"${task.originalText}"`,
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
  // Find or create project
  let projectId: string | null = null;
  if (clarification.projectName) {
    const existingProject = await db.query.projects.findFirst({
      where: eq(schema.projects.name, clarification.projectName),
    });

    if (existingProject) {
      projectId = existingProject.id;
    } else if (clarification.newProject) {
      const created = await db.insert(schema.projects)
        .values({
          name: clarification.projectName,
          status: 'active',
        })
        .returning();
      projectId = created[0].id;
    }
  }

  // Update the task
  const updated = await db.update(schema.tasks)
    .set({
      title: clarification.title,
      nextAction: clarification.nextAction,
      projectId,
      priority: clarification.priority,
      labels: JSON.stringify(clarification.labels),
      timeEstimateMin: clarification.timeEstimateMin,
      energyLevel: clarification.energyLevel,
      contextNotes: clarification.contextNotes,
      relatedPeople: JSON.stringify(clarification.relatedPeople),
      relatedLinks: JSON.stringify(clarification.relatedLinks),
      status: 'clarified',
      clarifyConfidence: clarification.confidence,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, taskId))
    .returning();

  const task = updated[0];

  // Create subtasks if decomposed
  if (clarification.decompositionNeeded && clarification.subtasks.length > 0) {
    for (const sub of clarification.subtasks) {
      await db.insert(schema.tasks).values({
        originalText: sub.title,
        title: sub.title,
        nextAction: sub.nextAction,
        projectId,
        priority: clarification.priority,
        parentTaskId: taskId,
        isDecomposed: true,
        status: 'clarified',
      });
    }
    await db.update(schema.tasks)
      .set({ isDecomposed: true })
      .where(eq(schema.tasks.id, taskId));
  }

  // Log to history
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
  void embedTask(task).catch(() => {});

  // Push to Todoist (best-effort, non-blocking)
  void pushTaskToTodoist(task).catch(() => {});

  revalidatePath('/clarify');
  revalidatePath('/engage');
  return task;
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
  const context = await buildContext(task.originalText + '\n\nUser clarification: ' + answer, 'clarify');

  const result = await geminiGenerateJSON<ClarifyResult>({
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
  revalidatePath('/clarify');
  revalidatePath('/engage');
  return results;
}
