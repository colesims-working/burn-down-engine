import { db, schema } from '@/lib/db/client';
import { geminiGenerateJSON } from './gemini';
import { KNOWLEDGE_EXTRACTION_PROMPT } from './prompts/clarify';
import { eq, and, like } from 'drizzle-orm';
import { geminiEmbed } from './gemini';

interface ExtractedKnowledge {
  category: string;
  key: string;
  value: string;
  confidence: number;
}

export async function extractAndStoreKnowledge(opts: {
  input: string;
  output: string;
  page: string;
}): Promise<void> {
  try {
    const extracted = await geminiGenerateJSON<ExtractedKnowledge[]>({
      system: KNOWLEDGE_EXTRACTION_PROMPT,
      prompt: `Page: ${opts.page}\nUser input: ${opts.input}\nSystem output: ${opts.output}`,
      operation: 'extract_knowledge',
    });

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    for (const entry of extracted) {
      if (!entry.category || !entry.key || !entry.value) continue;

      // Check for existing similar entry
      const existing = await db.query.knowledgeEntries.findFirst({
        where: and(
          eq(schema.knowledgeEntries.category, entry.category as any),
          eq(schema.knowledgeEntries.key, entry.key),
        ),
      });

      if (existing) {
        // Update if new confidence is higher or value is more detailed
        if (entry.confidence >= (existing.confidence || 0) || entry.value.length > existing.value.length) {
          await db.update(schema.knowledgeEntries)
            .set({
              value: entry.value,
              confidence: entry.confidence,
              source: opts.page,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.knowledgeEntries.id, existing.id));
        }
      } else {
        // Create new entry
        const newEntry = await db.insert(schema.knowledgeEntries)
          .values({
            category: entry.category as any,
            key: entry.key,
            value: entry.value,
            confidence: entry.confidence,
            source: opts.page,
          })
          .returning();

        // Generate embedding for new entry
        if (newEntry[0]) {
          try {
            const embeddingText = `${entry.category}: ${entry.key} — ${entry.value}`;
            const embedding = await geminiEmbed(embeddingText);
            await db.update(schema.knowledgeEntries)
              .set({
                embedding: Buffer.from(embedding.buffer),
                embeddingText,
              })
              .where(eq(schema.knowledgeEntries.id, newEntry[0].id));
          } catch {
            // Embedding generation is best-effort
          }
        }
      }
    }
  } catch (error) {
    // Knowledge extraction is best-effort — never block the main flow
    console.error('Knowledge extraction error:', error);
  }
}

// Process knowledge entries that might come embedded in LLM responses
export async function processInlineKnowledge(
  knowledgeExtracted: ExtractedKnowledge[] | undefined,
  page: string
): Promise<void> {
  if (!knowledgeExtracted || knowledgeExtracted.length === 0) return;

  for (const entry of knowledgeExtracted) {
    try {
      const existing = await db.query.knowledgeEntries.findFirst({
        where: and(
          eq(schema.knowledgeEntries.category, entry.category as any),
          eq(schema.knowledgeEntries.key, entry.key),
        ),
      });

      if (!existing) {
        await db.insert(schema.knowledgeEntries).values({
          category: entry.category as any,
          key: entry.key,
          value: entry.value,
          confidence: entry.confidence,
          source: page,
        });
      }
    } catch {
      // Best-effort
    }
  }
}
