/**
 * Knowledge System — Inline Micro-Extraction & Buffer
 *
 * Every qualifying LLM interaction becomes a learning opportunity.
 * Non-LLM events (complete, bump, etc.) go to the extraction buffer
 * for batch processing during review sessions.
 *
 * CRITICAL: extraction must NEVER block the primary LLM response.
 * All extraction work is fire-and-forget with error swallowing.
 */

import { knowledgeDb, schema } from './db';
import { eq, and, sql, lte } from 'drizzle-orm';
import { upsertKnowledge } from './upsert';
import { KNOWLEDGE_CONFIG } from './config';
import { llmGenerateJSON, type LLMOperation } from '@/lib/llm/router';
import type { ExtractedKnowledge, ExtractedKnowledgeSchema, UpsertResult, SourceContext } from './types';

// ─── Extraction Prompt ──────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction agent for a personal GTD system. Given an interaction between the user and the system, extract reusable knowledge.

## Rules
- Every person mentioned by name MUST be extracted as a person object.
- Extract genuinely reusable facts — not task-specific details that won't matter next week.
- Single-interaction behavioral inferences MUST use subtype "observation", never "pattern". Patterns require repeated evidence across multiple interactions.
- Prefer updating existing entities over creating new ones.
- Max 5 objects, 8 links per extraction.
- Each object MUST be a structured JSON object — never a bare string.

## Object Types
- person: People the user works with. Subtype: manager, peer, collaborator, report, stakeholder, external
- project: Workstreams. Subtype: active, paused, completed
- organization: Companies, teams, groups
- concept: Knowledge atoms. Subtype: identity, priority, preference, observation, fact, decision, workflow, schedule
- event: Time-anchored occurrences. Subtype: meeting, deadline, trip, milestone

## Link Types
works_at, reports_to, collaborates_on, owns, applies_to, about, involves, relates_to, depends_on, part_of, associated

## Output Format
Return a JSON object with this EXACT structure. Every element in "objects" must be a full object, not a string:

{
  "objects": [
    {
      "type": "person",
      "name": "Paula",
      "subtype": "manager",
      "properties": {"role": "Engineering Manager"},
      "confidence": 0.9
    },
    {
      "type": "concept",
      "name": "morning_deep_work",
      "subtype": "observation",
      "properties": {"value": "Prefers deep work before noon"},
      "confidence": 0.7
    }
  ],
  "links": [
    {
      "sourceName": "Paula",
      "sourceType": "person",
      "targetName": "Microsoft",
      "targetType": "organization",
      "linkType": "works_at",
      "confidence": 0.9
    }
  ]
}

Return {"objects": [], "links": []} if nothing worth extracting.`;

// Operations that qualify for inline extraction
const EXTRACTION_ELIGIBLE_OPERATIONS: LLMOperation[] = [
  'clarify_task',
  'file_suggestions',
  'daily_observations',
  'project_audit',
  'weekly_review',
  'organize_conversation',
  'priority_recalibration',
];

// ─── Inline Extraction ──────────────────────────────────────

/**
 * Build the extraction prompt block to append to an LLM call.
 * Includes known entity names so the LLM prefers existing entities.
 */
export async function buildExtractionPromptBlock(): Promise<string> {
  let entityNames: string[] = [];
  try {
    const entities = await knowledgeDb
      .select({ name: schema.objects.name, type: schema.objects.type })
      .from(schema.objects)
      .where(eq(schema.objects.status, 'active'))
      .limit(100);
    entityNames = entities.map(e => `${e.name} (${e.type})`);
  } catch {}

  const entityBlock = entityNames.length > 0
    ? `\n\nKnown entities (prefer referencing these by exact name over creating duplicates):\n${entityNames.join(', ')}`
    : '';

  return `\n\n---
## Knowledge Extraction
After completing the primary task above, also extract reusable knowledge into an "extracted_knowledge" field in your JSON response.

IMPORTANT RULES:
- Every person mentioned by name MUST be extracted as a person object.
- Each object must be a structured JSON object with type, name, properties, and confidence — NOT a string.
- If nothing worth extracting, set extracted_knowledge to {"objects": [], "links": []}.
${entityBlock}

The "extracted_knowledge" field must have this EXACT structure:

\`\`\`
"extracted_knowledge": {
  "objects": [
    {
      "type": "person",
      "name": "Paula",
      "subtype": "manager",
      "properties": {"role": "Engineering Manager", "contextNotes": "Manages the security team"},
      "confidence": 0.9
    },
    {
      "type": "concept",
      "name": "morning_deep_work_preference",
      "subtype": "observation",
      "properties": {"value": "User prefers deep work blocks before noon"},
      "confidence": 0.7
    }
  ],
  "links": [
    {
      "sourceName": "Paula",
      "sourceType": "person",
      "targetName": "Microsoft",
      "targetType": "organization",
      "linkType": "works_at",
      "confidence": 0.9
    }
  ]
}
\`\`\`

Object types: person, project, organization, concept, event
Concept subtypes: identity, priority, preference, observation, fact, decision, workflow, schedule (use "observation" for single-interaction inferences, never "pattern")
Link types: works_at, reports_to, collaborates_on, owns, applies_to, about, involves, relates_to, depends_on, part_of, associated`;
}

/**
 * Check if an LLM operation qualifies for inline extraction.
 */
export function isExtractionEligible(operation: LLMOperation, inputTokens: number): boolean {
  return EXTRACTION_ELIGIBLE_OPERATIONS.includes(operation) &&
    inputTokens >= KNOWLEDGE_CONFIG.MIN_EXTRACTION_INPUT_TOKENS;
}

/**
 * Parse and process extracted knowledge from an LLM response.
 * Fire-and-forget — never blocks the caller.
 *
 * Returns the upsert result for visibility (toast), or null on failure.
 */
export async function processExtractedKnowledge(
  extractedRaw: unknown,
  sourceContext: string,
  interactionId?: string,
  taskId?: string,
): Promise<UpsertResult | null> {
  try {
    if (!extractedRaw || typeof extractedRaw !== 'object') return null;

    const extracted = extractedRaw as any;
    const objects = Array.isArray(extracted.objects) ? extracted.objects : [];
    const links = Array.isArray(extracted.links) ? extracted.links : [];

    if (objects.length === 0 && links.length === 0) return null;

    // Validate and clamp to limits
    const validObjects = objects
      .filter((o: any) => o?.type && o?.name && typeof o.confidence === 'number')
      .slice(0, KNOWLEDGE_CONFIG.MAX_EXTRACTED_OBJECTS)
      .map((o: any) => ({
        type: o.type,
        name: String(o.name),
        subtype: o.subtype || undefined,
        properties: o.properties || {},
        confidence: Math.max(0, Math.min(1, o.confidence)),
        sensitivity: o.sensitivity || undefined,
      }));

    const validLinks = links
      .filter((l: any) => l?.sourceName && l?.targetName && l?.linkType)
      .slice(0, KNOWLEDGE_CONFIG.MAX_EXTRACTED_LINKS)
      .map((l: any) => ({
        sourceName: String(l.sourceName),
        sourceType: l.sourceType || 'concept',
        targetName: String(l.targetName),
        targetType: l.targetType || 'concept',
        linkType: l.linkType,
        confidence: Math.max(0, Math.min(1, l.confidence ?? 0.5)),
      }));

    if (validObjects.length === 0 && validLinks.length === 0) return null;

    // Filter low-confidence extractions
    const filtered = {
      objects: validObjects.filter((o: any) => o.confidence >= KNOWLEDGE_CONFIG.MIN_EXTRACTION_CONFIDENCE),
      links: validLinks.filter((l: any) => l.confidence >= KNOWLEDGE_CONFIG.MIN_EXTRACTION_CONFIDENCE),
    };

    if (filtered.objects.length === 0 && filtered.links.length === 0) return null;

    return await upsertKnowledge(filtered as ExtractedKnowledge, 'extracted', {
      sourceContext,
      interactionId,
      taskId,
    });
  } catch (error) {
    console.error('Knowledge extraction processing failed (non-fatal):', error);
    return null;
  }
}

/**
 * Run a standalone extraction LLM call for buffered events.
 * Used during buffer flush — this IS a dedicated LLM call (not piggybacking).
 */
export async function extractFromBufferEntry(entry: {
  eventType: string;
  taskTitle?: string | null;
  taskContext?: string | null;
}): Promise<UpsertResult | null> {
  try {
    const contextStr = entry.taskContext || '{}';
    const prompt = `Event: ${entry.eventType}\nTask: ${entry.taskTitle || 'Unknown'}\nContext: ${contextStr}`;

    let entityHint = '';
    try {
      const entities = await knowledgeDb
        .select({ name: schema.objects.name })
        .from(schema.objects)
        .where(eq(schema.objects.status, 'active'))
        .limit(50);
      entityHint = entities.length > 0
        ? `\nKnown entities: ${entities.map(e => e.name).join(', ')}`
        : '';
    } catch {}

    const result = await llmGenerateJSON<{ objects: any[]; links: any[] }>({
      system: EXTRACTION_SYSTEM_PROMPT + entityHint,
      prompt,
      operation: 'extract_knowledge',
    });

    return await processExtractedKnowledge(result, 'buffer_flush');
  } catch (error) {
    console.error('Buffer extraction failed (non-fatal):', error);
    return null;
  }
}

// ─── Extraction Buffer ──────────────────────────────────────

/**
 * Write a non-LLM event to the extraction buffer.
 * These get batch-processed during review sessions.
 */
export async function writeToExtractionBuffer(entry: {
  eventType: string;
  taskId?: string;
  taskTitle?: string;
  taskContext?: Record<string, unknown>;
}): Promise<void> {
  try {
    await knowledgeDb.insert(schema.extractionBuffer).values({
      eventType: entry.eventType,
      taskId: entry.taskId,
      taskTitle: entry.taskTitle,
      taskContext: entry.taskContext ? JSON.stringify(entry.taskContext) : null,
    });

    // Auto-flush check
    const countResult = await knowledgeDb
      .select({ count: sql<number>`count(*)` })
      .from(schema.extractionBuffer)
      .where(eq(schema.extractionBuffer.processed, 0));

    if ((countResult[0]?.count ?? 0) >= KNOWLEDGE_CONFIG.BUFFER_FLUSH_THRESHOLD) {
      // Fire and forget
      void flushExtractionBuffer().catch(() => {});
    }
  } catch (error) {
    // Silenced — Turso free tier transient errors are common and non-fatal
  }
}

/**
 * Flush the extraction buffer: process unprocessed entries in batches.
 * Triggered by: daily review start, weekly review start, buffer threshold.
 *
 * Returns summary of what was processed.
 */
export async function flushExtractionBuffer(): Promise<{
  entriesProcessed: number;
  objectsCreated: number;
  errors: string[];
}> {
  const summary = { entriesProcessed: 0, objectsCreated: 0, errors: [] as string[] };

  try {
    // Fetch unprocessed entries (with concurrency lock)
    const now = new Date().toISOString();
    const entries = await knowledgeDb.query.extractionBuffer.findMany({
      where: and(
        eq(schema.extractionBuffer.processed, 0),
        sql`(${schema.extractionBuffer.lockedAt} IS NULL OR ${schema.extractionBuffer.lockedAt} < datetime('now', '-5 minutes'))`,
        lte(schema.extractionBuffer.attemptCount, KNOWLEDGE_CONFIG.BUFFER_MAX_ATTEMPTS),
      ),
      limit: KNOWLEDGE_CONFIG.BUFFER_FLUSH_BATCH_SIZE,
    });

    if (entries.length === 0) return summary;

    // Lock entries
    const entryIds = entries.map(e => e.id);
    for (const id of entryIds) {
      await knowledgeDb.update(schema.extractionBuffer)
        .set({ lockedAt: now })
        .where(eq(schema.extractionBuffer.id, id));
    }

    // Process each entry
    for (const entry of entries) {
      try {
        const result = await extractFromBufferEntry({
          eventType: entry.eventType,
          taskTitle: entry.taskTitle,
          taskContext: entry.taskContext,
        });

        await knowledgeDb.update(schema.extractionBuffer)
          .set({
            processed: 1,
            processedAt: new Date().toISOString(),
            lockedAt: null,
          })
          .where(eq(schema.extractionBuffer.id, entry.id));

        summary.entriesProcessed++;
        if (result) summary.objectsCreated += result.objectsCreated;
      } catch (error) {
        const errMsg = (error as Error).message;
        await knowledgeDb.update(schema.extractionBuffer)
          .set({
            attemptCount: (entry.attemptCount ?? 0) + 1,
            lastError: errMsg,
            lockedAt: null,
          })
          .where(eq(schema.extractionBuffer.id, entry.id));
        summary.errors.push(`Entry ${entry.id}: ${errMsg}`);
      }
    }
  } catch (error) {
    summary.errors.push(`Flush failed: ${(error as Error).message}`);
  }

  return summary;
}

/**
 * Get the current buffer count (for UI display).
 */
export async function getBufferCount(): Promise<number> {
  try {
    const result = await knowledgeDb
      .select({ count: sql<number>`count(*)` })
      .from(schema.extractionBuffer)
      .where(eq(schema.extractionBuffer.processed, 0));
    return result[0]?.count ?? 0;
  } catch {
    return 0;
  }
}
