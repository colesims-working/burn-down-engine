/**
 * Knowledge System — Legacy Migration
 *
 * Migrates data from the legacy knowledge_entries + people tables
 * (task DB) to the new knowledge graph (knowledge DB).
 *
 * Triggered manually from Settings. One-shot operation for small datasets.
 * Generates embeddings for all migrated objects immediately.
 */

import { db as taskDb, schema as taskSchema } from '@/lib/db/client';
import { knowledgeDb, schema } from './db';
import { sql } from 'drizzle-orm';
import { upsertKnowledge } from './upsert';
import { generateEmbedding, buildEmbeddingText } from './embedding';
import { eq, isNull } from 'drizzle-orm';
import { KNOWLEDGE_CONFIG } from './config';
import type { ExtractedKnowledge, ExtractedObject, ExtractedLink, MigrationResult, ObjectType, ConceptSubtype } from './types';

// ─── Category → Subtype Mapping ─────────────────────────────

const CATEGORY_TO_SUBTYPE: Record<string, ConceptSubtype> = {
  identity: 'identity',
  preference: 'preference',
  pattern: 'pattern',
  priority: 'priority',
  schedule: 'schedule',
  decision: 'decision',
  fact: 'fact',
  workflow: 'workflow',
  other: 'observation',
};

/**
 * Migrate all legacy knowledge_entries and people to the knowledge graph.
 * Returns a summary of the migration.
 */
export async function migrateLegacyKnowledge(): Promise<MigrationResult> {
  const result: MigrationResult = {
    objectsMigrated: 0,
    peopleMigrated: 0,
    linksMigrated: 0,
    embeddingsGenerated: 0,
    errors: [],
  };

  // Step 1: Migrate knowledge entries → concept objects
  try {
    const entries = await taskDb.query.knowledgeEntries.findMany();

    for (const entry of entries) {
      try {
        const subtype = CATEGORY_TO_SUBTYPE[entry.category] || 'observation';
        const extracted: ExtractedKnowledge = {
          objects: [{
            type: 'concept',
            name: entry.key,
            subtype,
            properties: {
              key: entry.key,
              value: entry.value,
              legacy_reference_count: entry.timesReferenced ?? 0,
            },
            confidence: entry.confidence ?? 0.7,
          }],
          links: [],
        };

        const upsertResult = await upsertKnowledge(extracted, 'migrated', {
          sourceContext: 'review',
          skipEmbedding: true, // Backfill embeddings after all objects are created
        });

        if (upsertResult.objectsCreated > 0 || upsertResult.objectsUpdated > 0) {
          result.objectsMigrated++;
        }
        result.errors.push(...upsertResult.errors);
      } catch (error) {
        result.errors.push(`Entry "${entry.key}": ${(error as Error).message}`);
      }
    }
  } catch (error) {
    result.errors.push(`Knowledge entries migration failed: ${(error as Error).message}`);
  }

  // Step 2: Migrate people → person objects + organization links
  try {
    const people = await taskDb.query.people.findMany();

    for (const person of people) {
      try {
        const objects: ExtractedObject[] = [{
          type: 'person',
          name: person.name,
          subtype: person.relationship || undefined,
          properties: {
            role: person.role || undefined,
            contextNotes: person.contextNotes || undefined,
            relatedProjects: person.relatedProjects ? JSON.parse(person.relatedProjects) : undefined,
          },
          confidence: 0.9, // Manually entered people are high-confidence
        }];

        const links: ExtractedLink[] = [];

        // Create organization object + works_at link if organization exists
        if (person.organization) {
          objects.push({
            type: 'organization',
            name: person.organization,
            properties: {},
            confidence: 0.8,
          });
          links.push({
            sourceName: person.name,
            sourceType: 'person',
            targetName: person.organization,
            targetType: 'organization',
            linkType: 'works_at',
            confidence: 0.9,
          });
        }

        // Create project links for relatedProjects
        if (person.relatedProjects) {
          try {
            const projects: string[] = JSON.parse(person.relatedProjects);
            for (const projectName of projects) {
              if (!projectName.trim()) continue;
              links.push({
                sourceName: person.name,
                sourceType: 'person',
                targetName: projectName,
                targetType: 'project',
                linkType: 'collaborates_on',
                confidence: 0.7,
              });
            }
          } catch {}
        }

        const extracted: ExtractedKnowledge = { objects, links };
        // People were manually entered — use 'manual' to preserve protected-source status
        const upsertResult = await upsertKnowledge(extracted, 'manual', {
          sourceContext: 'review',
          skipEmbedding: true,
        });

        if (upsertResult.objectsCreated > 0 || upsertResult.objectsUpdated > 0) {
          result.peopleMigrated++;
        }
        result.linksMigrated += upsertResult.linksCreated;
        result.errors.push(...upsertResult.errors);
      } catch (error) {
        result.errors.push(`Person "${person.name}": ${(error as Error).message}`);
      }
    }
  } catch (error) {
    result.errors.push(`People migration failed: ${(error as Error).message}`);
  }

  // Step 3: Backfill embeddings for all objects without one
  try {
    const unembedded = await knowledgeDb.query.objects.findMany({
      where: isNull(schema.objects.embedding),
    });

    for (const obj of unembedded) {
      try {
        const props = JSON.parse(obj.properties || '{}');
        const embeddingText = buildEmbeddingText({ type: obj.type, name: obj.name, properties: props });
        const embedding = await generateEmbedding(embeddingText, { sourceContext: 'review' });

        await knowledgeDb.update(schema.objects)
          .set({
            embedding,
            embeddingModel: KNOWLEDGE_CONFIG.EMBEDDING_MODEL,
            embeddingText,
          })
          .where(eq(schema.objects.id, obj.id));

        result.embeddingsGenerated++;
      } catch (error) {
        result.errors.push(`Embedding for "${obj.name}": ${(error as Error).message}`);
      }
    }
  } catch (error) {
    result.errors.push(`Embedding backfill failed: ${(error as Error).message}`);
  }

  return result;
}

/**
 * Create the vector index on the objects table.
 * Must be run via raw SQL — Drizzle cannot express libsql_vector_idx.
 * Safe to call multiple times (CREATE INDEX IF NOT EXISTS).
 */
export async function setupVectorIndex(): Promise<void> {
  await knowledgeDb.run(sql`
    CREATE INDEX IF NOT EXISTS objects_embedding_idx
    ON objects(libsql_vector_idx(embedding, 'metric=cosine'))
  `);
  // Partial index for pinned objects (Stage 1 global context retrieval)
  await knowledgeDb.run(sql`
    CREATE INDEX IF NOT EXISTS objects_pinned_idx
    ON objects(pinned) WHERE pinned = 1
  `);
}

/**
 * Check whether migration has already been run by checking if any
 * migrated objects exist in the knowledge DB.
 */
export async function isMigrationComplete(): Promise<boolean> {
  const migrated = await knowledgeDb.query.objects.findFirst({
    where: eq(schema.objects.source, 'migrated'),
  });
  return migrated !== undefined;
}
