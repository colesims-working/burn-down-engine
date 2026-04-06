'use server';

import { db, schema } from '@/lib/db/client';
import { llmGenerateJSON } from '@/lib/llm/router';
import { buildContext } from '@/lib/llm/context';
import { DAILY_OBSERVATIONS_PROMPT, WEEKLY_REVIEW_PROMPT } from '@/lib/llm/prompts/engage';
import { processInlineKnowledge } from '@/lib/llm/extraction';
import { flushExtractionBuffer } from '@/lib/knowledge/extraction';
import { runConsolidation, shouldAutoConsolidate } from '@/lib/knowledge/consolidation';
import { bumpTask, blockTask } from '@/lib/priority/engine';
import { killTaskInTodoist } from '@/lib/todoist/sync';
import { format, startOfWeek, subDays } from 'date-fns';
import { eq, and, gte, lte, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getDailyReviewData(date?: string) {
  // Flush extraction buffer at daily review start (fire-and-forget)
  void flushExtractionBuffer().catch(() => {});

  const reviewDate = date || format(new Date(), 'yyyy-MM-dd');

  // Get today's completed tasks
  const completed = await db.query.tasks.findMany({
    where: and(
      eq(schema.tasks.status, 'completed'),
      gte(schema.tasks.completedAt, `${reviewDate}T00:00:00`),
      lte(schema.tasks.completedAt, `${reviewDate}T23:59:59`),
    ),
  });

  // Get incomplete active tasks (candidates for bump/block/kill)
  const incomplete = await db.query.tasks.findMany({
    where: and(
      ne(schema.tasks.status, 'completed'),
      ne(schema.tasks.status, 'killed'),
      ne(schema.tasks.status, 'inbox'),
    ),
  });

  // Filter to today's planned items (P1 and P2)
  const planned = incomplete.filter(t =>
    t.priority !== null && t.priority <= 2 && t.status !== 'waiting' && t.status !== 'blocked'
  );

  // Get today's fires (bounded to the review date)
  const fires = await db.query.taskHistory.findMany({
    where: and(
      eq(schema.taskHistory.action, 'fire_promoted'),
      gte(schema.taskHistory.timestamp, `${reviewDate} 00:00:00`),
      lte(schema.taskHistory.timestamp, `${reviewDate} 23:59:59`),
    ),
  });

  // Get bumped tasks (bounded to the review date)
  const bumps = await db.query.taskHistory.findMany({
    where: and(
      eq(schema.taskHistory.action, 'bumped'),
      gte(schema.taskHistory.timestamp, `${reviewDate} 00:00:00`),
      lte(schema.taskHistory.timestamp, `${reviewDate} 23:59:59`),
    ),
  });

  // Check for existing review
  const existingReview = await db.query.dailyReviews.findFirst({
    where: eq(schema.dailyReviews.reviewDate, reviewDate),
  });

  return {
    reviewDate,
    completed,
    planned,
    incomplete,
    fires: fires.length,
    bumps: bumps.length,
    completionRate: planned.length > 0
      ? completed.length / (completed.length + planned.length)
      : 0,
    existingReview,
  };
}

export async function generateDailyObservations(date?: string) {
  const reviewDate = date || format(new Date(), 'yyyy-MM-dd');
  const data = await getDailyReviewData(reviewDate);
  const context = await buildContext('', 'reflect');

  const result = await llmGenerateJSON<any>({
    operation: 'daily_observations',
    system: DAILY_OBSERVATIONS_PROMPT,
    prompt: `## Context\n${context}\n\n## Today's Data (${reviewDate})\nCompleted: ${data.completed.length} tasks\nPlanned remaining: ${data.planned.length}\nCompletion rate: ${Math.round(data.completionRate * 100)}%\nFires: ${data.fires}\nBumps: ${data.bumps}\n\nCompleted tasks:\n${data.completed.map(t => `- ${t.title}`).join('\n')}\n\nStill open:\n${data.planned.map(t => `- ${t.title} (P${t.priority}, bumped ${t.bumpCount}x)`).join('\n')}`,
  });

  // Store knowledge
  if (result.knowledgeExtracted) {
    processInlineKnowledge(result.knowledgeExtracted, 'reflect');
  }

  return result;
}

export async function saveDailyReview(data: {
  reviewDate: string;
  completedTaskIds: string[];
  bumpedTasks: { taskId: string; reason: string }[];
  blockedTasks: { taskId: string; blocker: string }[];
  killedTaskIds: string[];
  freeCapture: string;
  tomorrowSeed: string[];
}) {
  const completedCount = data.completedTaskIds.length;
  const plannedCount = completedCount + data.bumpedTasks.length + data.blockedTasks.length + data.killedTaskIds.length;

  // ── Mutate task statuses ──────────────────────────────────

  // Bump tasks: set due date to tomorrow, increment bump count
  for (const { taskId, reason } of data.bumpedTasks) {
    await bumpTask(taskId, reason || 'daily review close-out');
  }

  // Block tasks: set status to blocked with blocker note
  for (const { taskId, blocker } of data.blockedTasks) {
    await blockTask(taskId, blocker || 'blocked during daily review');
  }

  // Kill tasks: mark as killed + delete from Todoist
  for (const taskId of data.killedTaskIds) {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });

    await db.update(schema.tasks)
      .set({ status: 'killed', updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, taskId));

    await db.insert(schema.taskHistory).values({
      taskId,
      action: 'killed',
      details: JSON.stringify({ killedAt: new Date().toISOString(), source: 'daily_review' }),
    });

    if (task) {
      try {
        await killTaskInTodoist(task);
      } catch (e) {
        console.error('Failed to delete killed task in Todoist:', e);
      }
    }
  }

  // ── Persist the review record ─────────────────────────────

  await db.insert(schema.dailyReviews)
    .values({
      reviewDate: data.reviewDate,
      plannedCount: plannedCount,
      completedCount: completedCount,
      bumpedCount: data.bumpedTasks.length,
      fireCount: 0,
      completionRate: plannedCount > 0 ? completedCount / plannedCount : 0,
      completedTasks: JSON.stringify(data.completedTaskIds),
      bumpedTasks: JSON.stringify(data.bumpedTasks),
      blockedTasks: JSON.stringify(data.blockedTasks),
      killedTasks: JSON.stringify(data.killedTaskIds),
      freeCapture: data.freeCapture,
      tomorrowSeed: JSON.stringify(data.tomorrowSeed),
    })
    .onConflictDoUpdate({
      target: schema.dailyReviews.reviewDate,
      set: {
        completedCount: completedCount,
        bumpedCount: data.bumpedTasks.length,
        completionRate: plannedCount > 0 ? completedCount / plannedCount : 0,
        completedTasks: JSON.stringify(data.completedTaskIds),
        bumpedTasks: JSON.stringify(data.bumpedTasks),
        blockedTasks: JSON.stringify(data.blockedTasks),
        killedTasks: JSON.stringify(data.killedTaskIds),
        freeCapture: data.freeCapture,
        tomorrowSeed: JSON.stringify(data.tomorrowSeed),
      },
    });

  revalidatePath('/reflect');
  revalidatePath('/engage');
}

export async function generateWeeklyReview() {
  // Flush extraction buffer at weekly review start (fire-and-forget)
  void flushExtractionBuffer().catch(() => {});

  // Consolidation pre-step: run if budget exceeded or as weekly maintenance
  try {
    const needsConsolidation = await shouldAutoConsolidate();
    if (needsConsolidation) {
      await runConsolidation({ scope: 'full' });
    } else {
      // Lightweight: just dormancy + reference cleanup
      await runConsolidation({ scope: 'active_only' });
    }
  } catch {}

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const weekEnd = format(new Date(), 'yyyy-MM-dd');

  const dailyReviews = await db.query.dailyReviews.findMany({
    where: and(
      gte(schema.dailyReviews.reviewDate, weekStart),
      lte(schema.dailyReviews.reviewDate, weekEnd),
    ),
  });

  // Include someday/maybe tasks for review
  const somedayTasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'someday'),
  });

  const context = await buildContext('', 'reflect');

  const somedaySection = somedayTasks.length > 0
    ? `\n\nSomeday/Maybe items for review (${somedayTasks.length}):\n${somedayTasks.map(t => `- ${t.title}`).join('\n')}`
    : '';

  const result = await llmGenerateJSON<any>({
    operation: 'weekly_review',
    system: WEEKLY_REVIEW_PROMPT,
    prompt: `## Context\n${context}\n\n## Daily Reviews This Week\n${JSON.stringify(dailyReviews, null, 2)}${somedaySection}`,
  });

  if (result.knowledgeExtracted) {
    processInlineKnowledge(result.knowledgeExtracted, 'reflect');
  }

  return result;
}
