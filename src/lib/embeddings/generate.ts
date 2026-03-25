import { db, schema } from '@/lib/db/client';
import { geminiEmbed } from '@/lib/llm/gemini';
import { eq } from 'drizzle-orm';

export async function embedTask(task: schema.Task): Promise<void> {
  const parts = [
    task.title,
    task.nextAction,
    task.contextNotes,
  ].filter(Boolean);

  if (parts.length === 0) return;

  const embeddingText = parts.join(' | ');

  try {
    const embedding = await geminiEmbed(embeddingText);
    await db.update(schema.tasks)
      .set({
        embedding: Buffer.from(embedding.buffer),
        embeddingText,
      })
      .where(eq(schema.tasks.id, task.id));
  } catch (error) {
    console.error('Task embedding error:', error);
  }
}

export async function embedKnowledgeEntry(entry: schema.KnowledgeEntry): Promise<void> {
  const embeddingText = `${entry.category}: ${entry.key} — ${entry.value}`;

  try {
    const embedding = await geminiEmbed(embeddingText);
    await db.update(schema.knowledgeEntries)
      .set({
        embedding: Buffer.from(embedding.buffer),
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
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
