import { db, schema } from '@/lib/db/client';
import { generateEmbedding } from '@/lib/knowledge/embedding';
import { eq } from 'drizzle-orm';

/**
 * Embed a task using Qwen3-Embedding-8B (4096 dims).
 * Uses title + nextAction + contextNotes for richer semantic content.
 * Called after clarification to re-embed with the enriched text.
 */
export async function embedTask(task: schema.Task): Promise<void> {
  const parts = [
    task.title,
    task.nextAction,
    task.contextNotes,
  ].filter(Boolean);

  if (parts.length === 0) return;

  const embeddingText = parts.join(' | ');

  try {
    const embeddingArr = await generateEmbedding(embeddingText, { sourceContext: 'clarify' });
    const vec = new Float32Array(embeddingArr);
    await db.update(schema.tasks)
      .set({
        embedding: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        embeddingText,
      })
      .where(eq(schema.tasks.id, task.id));
  } catch (error) {
    console.error('Task embedding error:', error);
  }
}

/** @deprecated Use knowledge graph embedding system instead */
export async function embedKnowledgeEntry(entry: schema.KnowledgeEntry): Promise<void> {
  const embeddingText = `${entry.category}: ${entry.key} — ${entry.value}`;

  try {
    const embeddingArr = await generateEmbedding(embeddingText, { sourceContext: 'knowledge' });
    const vec = new Float32Array(embeddingArr);
    await db.update(schema.knowledgeEntries)
      .set({
        embedding: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        embeddingText,
      })
      .where(eq(schema.knowledgeEntries.id, entry.id));
  } catch (error) {
    console.error('Knowledge embedding error:', error);
  }
}

// Cosine similarity for future vector search (v2)
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
