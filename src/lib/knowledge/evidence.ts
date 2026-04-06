/**
 * Knowledge System — Provenance Logging
 *
 * Every knowledge modification gets an evidence record.
 * Evidence is append-only and never deleted by automation.
 */

import { knowledgeDb, schema } from './db';
import type { EvidenceType, SourceContext } from './types';

/**
 * Create an evidence record for a knowledge object modification.
 */
export async function createEvidence(data: {
  objectId: string;
  interactionId?: string;
  taskId?: string;
  sourceContext: string;
  evidenceType: EvidenceType;
  snippet?: string;
  confidence?: number;
}): Promise<void> {
  try {
    await knowledgeDb.insert(schema.objectEvidence).values({
      objectId: data.objectId,
      interactionId: data.interactionId,
      taskId: data.taskId,
      sourceContext: data.sourceContext,
      evidenceType: data.evidenceType,
      snippet: data.snippet?.slice(0, 500),
      confidence: data.confidence,
    });
  } catch (error) {
    console.error('Failed to create evidence record:', error);
  }
}
