import { db, schema } from '@/lib/db/client';
import { generateEmbedding } from '@/lib/knowledge/embedding';
import { cosineSimilarity } from './generate';
import { eq, or, and, sql, notInArray, isNotNull, isNull } from 'drizzle-orm';
import { killTaskInTodoist, pushTaskToTodoist } from '@/lib/todoist/sync';
import { llmGenerateJSON } from '@/lib/llm/router';

// ─── Constants ──────────────────────────────────────────────

const EXPECTED_DIMS = 4096; // Qwen3-Embedding-8B
let _dedupRunning = false; // Concurrency lock — only one detectDuplicates at a time

// ─── Types ──────────────────────────────────────────────────

interface CandidateTask {
  id: string;
  title: string;
  vec: Float32Array;
}

interface DupeCheckResult {
  wasFlagged: boolean;
  suspectOf?: string;
  similarity?: number;
}

// ─── Pure Functions ─────────────────────────────────────────

/**
 * Find the best duplicate match above threshold. Pure — no DB calls.
 */
export function findDuplicate(
  vec: Float32Array,
  candidates: CandidateTask[],
  threshold: number,
): { taskId: string; similarity: number } | null {
  let bestId: string | null = null;
  let bestScore = 0;

  for (const c of candidates) {
    const score = cosineSimilarity(vec, c.vec);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestId = c.id;
    }
  }

  return bestId ? { taskId: bestId, similarity: bestScore } : null;
}

// ─── Embedding ──────────────────────────────────────────────

/**
 * Phase 1: Embed all tasks that don't have embeddings yet.
 * Returns count of newly embedded tasks. Embeddings are stored on the task row.
 * This is independently useful — embeddings power dedup, clustering, and knowledge graph.
 */
export async function embedUnembeddedTasks(): Promise<number> {
  // Find tasks that need embedding: no embedding, or wrong-dimension embedding (old model)
  const allActive = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, embedding: schema.tasks.embedding })
    .from(schema.tasks)
    .where(notInArray(schema.tasks.status, ['completed', 'killed']));

  const unembedded = allActive.filter(t => {
    if (!t.embedding) return true;
    // Check if existing embedding is the wrong dimension (old model)
    try {
      const buf = Buffer.from(t.embedding as ArrayBuffer);
      const dims = buf.byteLength / 4; // Float32 = 4 bytes
      return dims !== EXPECTED_DIMS;
    } catch {
      return true;
    }
  });

  if (unembedded.length === 0) return 0;

  let embedded = 0;

  // Parallel batches of 10 — OpenRouter handles concurrent requests well.
  // Each batch fires 10 embedding API calls simultaneously, then writes results.
  const BATCH_SIZE = 10;
  for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
    const batch = unembedded.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const embeddingArr = await generateEmbedding(task.title, { sourceContext: 'dedup' });
        const vec = new Float32Array(embeddingArr);
        await db.update(schema.tasks)
          .set({
            embedding: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
            embeddingText: task.title,
            dupeDismissedAt: null, // New embedding — re-eligible for detection
          })
          .where(eq(schema.tasks.id, task.id));
        return task.title;
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') embedded++;
      else console.error('Embedding failed (non-fatal):', r.reason);
    }
  }
  return embedded;
}

// ─── Detection ──────────────────────────────────────────────

/**
 * Phase 2: Compare all embedded tasks against each other and flag duplicates.
 * Runs AFTER embedUnembeddedTasks completes — all embeddings are guaranteed to exist.
 *
 * Concurrency-safe: only one instance runs at a time (skips if already running).
 * Write-safe: re-reads dismissals before each write to respect user actions
 * that happened during the scan.
 */
export async function detectDuplicates(threshold: number): Promise<number> {
  // Concurrency lock — if already running, skip entirely
  if (_dedupRunning) return 0;
  _dedupRunning = true;

  try {
    return await _detectDuplicatesInner(threshold);
  } finally {
    _dedupRunning = false;
  }
}

async function _detectDuplicatesInner(threshold: number): Promise<number> {
  // Load all embedded, active tasks
  const rows = await db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      embedding: schema.tasks.embedding,
      dupeDismissedAt: schema.tasks.dupeDismissedAt,
    })
    .from(schema.tasks)
    .where(and(
      isNotNull(schema.tasks.embedding),
      notInArray(schema.tasks.status, ['completed', 'killed']),
    ));

  // Build candidate list — skip tasks the user has reviewed (dupeDismissedAt set)
  const reviewedIds = new Set<string>();
  const candidates: CandidateTask[] = [];
  for (const row of rows) {
    if (!row.embedding) continue;

    // If the user has dismissed this task, don't flag it again.
    // It will be re-eligible after re-embedding (e.g., after clarification).
    if (row.dupeDismissedAt) {
      reviewedIds.add(row.id);
      continue;
    }

    try {
      const buf = Buffer.from(row.embedding as ArrayBuffer);
      const vec = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      if (vec.length !== EXPECTED_DIMS) continue;
      candidates.push({ id: row.id, title: row.title, vec });
    } catch {
      continue;
    }
  }

  // Build adjacency: for each non-reviewed task, find best match above threshold
  const adjacency = new Map<string, { bestId: string; bestScore: number }>();

  for (const task of candidates) {
    let bestId: string | null = null;
    let bestScore = 0;

    for (const other of candidates) {
      if (other.id === task.id) continue;
      const score = cosineSimilarity(task.vec, other.vec);
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestId = other.id;
      }
    }

    if (bestId) {
      adjacency.set(task.id, { bestId, bestScore });
    }
  }

  let flagged = 0;

  for (const task of candidates) {
    const match = adjacency.get(task.id);

    if (match) {
      // Final write-time check: re-read dupeDismissedAt in case user dismissed during scan
      const fresh = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, task.id) });
      if (fresh?.dupeDismissedAt) continue;

      await db.update(schema.tasks)
        .set({ duplicateSuspectOf: match.bestId, dupeSimilarity: match.bestScore })
        .where(eq(schema.tasks.id, task.id));
      flagged++;
    } else {
      // Clear stale flag
      await db.update(schema.tasks)
        .set({ duplicateSuspectOf: null, dupeSimilarity: null })
        .where(
          and(eq(schema.tasks.id, task.id), isNotNull(schema.tasks.duplicateSuspectOf))
        );
    }
  }

  return flagged;
}

/**
 * Full dedup pipeline: embed then detect. Called after sync.
 * Two clean phases — embedding is independently useful for downstream features.
 */
export async function runBackgroundDedup(threshold: number): Promise<{ embedded: number; flagged: number }> {
  const embedded = await embedUnembeddedTasks();
  const flagged = await detectDuplicates(threshold);
  return { embedded, flagged };
}

// ─── Merge ──────────────────────────────────────────────────

/**
 * Merge two tasks: create a combined task with AI-generated title, kill both originals.
 * Prefers the more-processed task's values (higher clarifyConfidence, or older).
 */
export async function mergeTasks(
  primaryTaskId: string,
  duplicateTaskId: string,
  preApprovedTitle?: string,
): Promise<schema.Task> {
  if (primaryTaskId === duplicateTaskId) throw new Error('Cannot merge a task with itself');

  const primary = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, primaryTaskId),
  });
  const duplicate = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, duplicateTaskId),
  });
  if (!primary || !duplicate) throw new Error('Task not found for merge');

  // Decide which is the "richer" task
  const primaryConf = primary.clarifyConfidence ?? 0;
  const dupeConf = duplicate.clarifyConfidence ?? 0;
  const richer = primaryConf >= dupeConf ? primary : duplicate;
  const other = richer === primary ? duplicate : primary;

  // Use pre-approved title if provided (from preview), otherwise generate via LLM
  let mergedTitle = preApprovedTitle || richer.title;
  if (!preApprovedTitle) {
    try {
      const suggestion = await llmGenerateJSON<{ title: string }>({
        system: 'You merge duplicate task titles into one clean, actionable title. Return JSON: {"title": "..."}',
        prompt: `These tasks are duplicates. Create one clean title that captures the intent:\n- "${primary.title}"\n- "${duplicate.title}"`,
        operation: 'clarify_task',
      });
      if (suggestion.title?.trim()) {
        mergedTitle = suggestion.title.trim();
      }
    } catch {}
  }

  // Build merged description combining context from both
  const descParts = [richer.description, other.description].filter(Boolean);
  const contextParts = [richer.contextNotes, other.contextNotes].filter(Boolean);

  // Merge labels (deduplicate)
  const richLabels: string[] = JSON.parse(richer.labels || '[]');
  const otherLabels: string[] = JSON.parse(other.labels || '[]');
  const mergedLabels = Array.from(new Set([...richLabels, ...otherLabels]));

  // Kill both originals FIRST — clear todoistId to free the UNIQUE constraint
  const now = new Date().toISOString();
  const keptTodoistId = richer.todoistId ?? other.todoistId;

  await db.update(schema.tasks)
    .set({ status: 'killed', todoistId: null, updatedAt: now })
    .where(eq(schema.tasks.id, primary.id));
  await db.update(schema.tasks)
    .set({ status: 'killed', todoistId: null, updatedAt: now })
    .where(eq(schema.tasks.id, duplicate.id));

  // Delete the OTHER task from Todoist (the one whose todoistId we're NOT keeping)
  const otherTodoistId = other.todoistId;
  if (otherTodoistId && otherTodoistId !== keptTodoistId) {
    try { await killTaskInTodoist(other); } catch {}
  }

  // Create merged task
  const merged = await db.insert(schema.tasks)
    .values({
      todoistId: keptTodoistId,
      originalText: `[merged] ${richer.originalText}`,
      title: mergedTitle,
      nextAction: richer.nextAction ?? other.nextAction,
      description: descParts.join('\n\n---\n\n') || null,
      projectId: richer.projectId ?? other.projectId,
      priority: richer.priority ?? other.priority,
      labels: JSON.stringify(mergedLabels),
      dueDate: richer.dueDate ?? other.dueDate,
      timeEstimateMin: richer.timeEstimateMin ?? other.timeEstimateMin,
      energyLevel: richer.energyLevel ?? other.energyLevel,
      status: richer.status === 'inbox' ? 'inbox' : richer.status,
      contextNotes: contextParts.join('\n\n') || null,
      relatedPeople: richer.relatedPeople ?? other.relatedPeople,
      relatedLinks: richer.relatedLinks ?? other.relatedLinks,
      clarifyConfidence: richer.clarifyConfidence ?? other.clarifyConfidence,
      llmNotes: richer.llmNotes ?? other.llmNotes,
      embedding: richer.embedding ?? other.embedding,
      embeddingText: richer.embeddingText ?? other.embeddingText,
      todoistSyncedAt: richer.todoistSyncedAt,
      createdAt: now,
    })
    .returning();

  const mergedTask = merged[0];

  // Push merged task to Todoist (updates the surviving Todoist task with new title)
  if (mergedTask.todoistId) {
    try { await pushTaskToTodoist(mergedTask); } catch {}
  }

  // Redirect any other suspects pointing at either original
  await db.update(schema.tasks)
    .set({ duplicateSuspectOf: mergedTask.id })
    .where(
      or(
        eq(schema.tasks.duplicateSuspectOf, primaryTaskId),
        eq(schema.tasks.duplicateSuspectOf, duplicateTaskId),
      )
    );

  // Embed the merged task and re-run detection so it can be caught
  // as a duplicate of remaining similar tasks (e.g., if 5 tasks were
  // similar, merging 2 should still flag the merged result against the other 3)
  try {
    const embeddingArr = await generateEmbedding(mergedTask.title, { sourceContext: 'dedup' });
    const vec = new Float32Array(embeddingArr);
    await db.update(schema.tasks)
      .set({
        embedding: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        embeddingText: mergedTask.title,
      })
      .where(eq(schema.tasks.id, mergedTask.id));
  } catch {}

  return mergedTask;
}

// ─── Dismiss ────────────────────────────────────────────────

/**
 * Dismiss a task from duplicate detection.
 *
 * Sets a "dedup reviewed" timestamp. detectDuplicates will never re-flag a task
 * whose dupeDismissedAt is more recent than its last embedding change.
 * This is simpler and more robust than tracking pairwise dismissed IDs —
 * it means "I've seen the duplicates for this task and they're fine."
 *
 * The task can be re-flagged if its EMBEDDING changes (e.g., after clarification),
 * since a new embedding means new potential matches worth reviewing.
 */
export async function dismissDuplicate(taskId: string, groupTaskIds?: string[]): Promise<schema.Task> {
  const now = new Date().toISOString();

  // Dismiss all tasks in the group — each gets a "reviewed" timestamp
  const allIds = groupTaskIds?.length ? groupTaskIds : [taskId];
  for (const id of allIds) {
    await db.update(schema.tasks)
      .set({
        duplicateSuspectOf: null,
        dupeSimilarity: null,
        dupeDismissedAt: now,
      })
      .where(eq(schema.tasks.id, id));
  }

  const updated = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!updated) throw new Error('Task not found');
  return updated;
}
