/**
 * Knowledge System — Unified Write Path
 *
 * upsertKnowledge() is the single entry point for all knowledge writes.
 * It handles dedup, alias resolution, protected source guarding,
 * embedding generation, evidence logging, and link resolution.
 *
 * See SKILL.md "upsertKnowledge() behavior" for the full algorithm.
 */

import { knowledgeDb, schema } from './db';
import { eq, and } from 'drizzle-orm';
import { canonicalize, buildCanonicalName, buildDedupKey, resolveAlias, createAlias } from './aliases';
import { createEvidence } from './evidence';
import { invalidateRetrievalCaches } from './retrieval';
import { generateEmbedding, buildEmbeddingText } from './embedding';
import { AUTO_PIN_SUBTYPES, KNOWLEDGE_CONFIG } from './config';
import type {
  ExtractedObject, ExtractedLink, ExtractedKnowledge,
  UpsertResult, ObjectType, Source, SourceContext,
} from './types';

interface UpsertOptions {
  sourceContext: string;
  interactionId?: string;
  taskId?: string;
  /** Skip embedding generation (for migration — backfill separately) */
  skipEmbedding?: boolean;
}

/**
 * Upsert extracted knowledge into the graph.
 * Handles objects and links in one call.
 */
export async function upsertKnowledge(
  extracted: ExtractedKnowledge,
  source: Source,
  options: UpsertOptions,
): Promise<UpsertResult> {
  const result: UpsertResult = {
    objectsCreated: 0,
    objectsUpdated: 0,
    objectsSkipped: 0,
    linksCreated: 0,
    linksSkipped: 0,
    stubsCreated: 0,
    reviewQueueItems: 0,
    errors: [],
  };

  // Phase 1: Upsert objects
  const objectIdMap = new Map<string, string>(); // name -> object ID (for link resolution)

  for (const obj of extracted.objects) {
    try {
      const objectId = await upsertObject(obj, source, options, result);
      if (objectId) {
        objectIdMap.set(buildCanonicalName(obj.name), objectId);
      }
    } catch (error) {
      result.errors.push(`Object "${obj.name}": ${(error as Error).message}`);
    }
  }

  // Phase 2: Resolve and create links
  for (const link of extracted.links) {
    try {
      await upsertLink(link, source, objectIdMap, result);
    } catch (error) {
      result.errors.push(`Link "${link.sourceName}" → "${link.targetName}": ${(error as Error).message}`);
    }
  }

  // Invalidate retrieval caches after any knowledge write
  if (result.objectsCreated > 0 || result.objectsUpdated > 0 || result.linksCreated > 0) {
    invalidateRetrievalCaches();
  }

  return result;
}

// ─── Object Upsert ──────────────────────────────────────────

async function upsertObject(
  obj: ExtractedObject,
  source: Source,
  options: UpsertOptions,
  result: UpsertResult,
): Promise<string | null> {
  const type = obj.type;
  const canonicalName = buildCanonicalName(obj.name);
  const dedupKey = buildDedupKey(type, obj);

  // Check alias resolution first
  const aliasObjectId = await resolveAlias(obj.name);

  // Check dedup key match
  const existing = await knowledgeDb.query.objects.findFirst({
    where: and(
      eq(schema.objects.type, type),
      eq(schema.objects.dedupKey, dedupKey),
    ),
  });

  // Detect alias/dedup conflict — dedup key wins per spec
  if (aliasObjectId && existing && aliasObjectId !== existing.id) {
    console.warn(`Alias/dedup mismatch for "${obj.name}": alias→${aliasObjectId}, dedup→${existing.id}. Using dedup key match.`);
  }

  if (existing) {
    // Existing object found — decide: update, skip, or queue for review
    return handleExistingObject(existing, obj, source, options, result);
  }

  if (aliasObjectId && !existing) {
    // Alias matched but no dedup match — this is a known entity with a variant name
    // Skip insert, just add evidence
    await createEvidence({
      objectId: aliasObjectId,
      interactionId: options.interactionId,
      taskId: options.taskId,
      sourceContext: options.sourceContext,
      evidenceType: 'extraction',
      snippet: `Re-observed via alias: ${obj.name}`,
      confidence: obj.confidence,
    });
    result.objectsSkipped++;
    return aliasObjectId;
  }

  // No match — INSERT new object
  const shouldPin = type === 'concept' && AUTO_PIN_SUBTYPES.includes(obj.subtype as any);
  const now = new Date().toISOString();

  let embedding: number[] | undefined;
  let embeddingText: string | undefined;
  if (!options.skipEmbedding) {
    try {
      embeddingText = buildEmbeddingText({ type, name: obj.name, properties: obj.properties });
      embedding = await generateEmbedding(embeddingText, { sourceContext: options.sourceContext });
    } catch {
      // Embedding failure never blocks insertion
    }
  }

  const inserted = await knowledgeDb.insert(schema.objects).values({
    type,
    subtype: obj.subtype || null,
    name: obj.name,
    canonicalName,
    dedupKey,
    properties: JSON.stringify(obj.properties),
    status: 'active',
    pinned: shouldPin ? 1 : 0,
    pinnedAt: shouldPin ? now : null,
    confidence: obj.confidence,
    source,
    sourceContext: options.sourceContext,
    sensitivity: obj.sensitivity || 'normal',
    embedding: embedding || null,
    embeddingModel: embedding ? KNOWLEDGE_CONFIG.EMBEDDING_MODEL : null,
    embeddingText: embeddingText || null,
  }).returning();

  const newId = inserted[0].id;

  // Create alias for the name
  await createAlias(newId, obj.name);

  // Log evidence
  await createEvidence({
    objectId: newId,
    interactionId: options.interactionId,
    taskId: options.taskId,
    sourceContext: options.sourceContext,
    evidenceType: source === 'migrated' ? 'migration' : 'extraction',
    snippet: `Created: ${obj.name}`,
    confidence: obj.confidence,
  });

  result.objectsCreated++;
  return newId;
}

async function handleExistingObject(
  existing: typeof schema.objects.$inferSelect,
  obj: ExtractedObject,
  source: Source,
  options: UpsertOptions,
  result: UpsertResult,
): Promise<string> {
  // Protected sources: manual/seed objects cannot be auto-overwritten
  if (existing.source === 'manual' || existing.source === 'seed') {
    // Check for existing pending review before creating a new one
    const existingReview = await knowledgeDb.query.reviewQueue.findFirst({
      where: and(
        eq(schema.reviewQueue.objectId, existing.id),
        eq(schema.reviewQueue.reviewType, 'protected_update'),
        eq(schema.reviewQueue.status, 'pending'),
      ),
    });
    if (!existingReview) {
      await knowledgeDb.insert(schema.reviewQueue).values({
        objectId: existing.id,
        reviewType: 'protected_update',
        proposedData: JSON.stringify({
          name: obj.name,
          properties: obj.properties,
          confidence: obj.confidence,
          source,
        }),
        reason: `Extracted update for ${existing.source}-created object "${existing.name}"`,
      });
      result.reviewQueueItems++;
    }
    result.objectsSkipped++;

    // Still log evidence
    await createEvidence({
      objectId: existing.id,
      interactionId: options.interactionId,
      taskId: options.taskId,
      sourceContext: options.sourceContext,
      evidenceType: 'extraction',
      snippet: `Update queued for review: ${obj.name}`,
      confidence: obj.confidence,
    });

    return existing.id;
  }

  // Extracted/consolidated: merge if richer, skip if equal
  const existingProps = JSON.parse(existing.properties || '{}');
  const newProps = obj.properties;
  const newPropsStr = JSON.stringify(newProps);
  const existingPropsStr = JSON.stringify(existingProps);

  if (newPropsStr === existingPropsStr && obj.confidence <= (existing.confidence ?? 0)) {
    // Equal or lower quality — skip
    result.objectsSkipped++;

    // Still log evidence (re-observation strengthens confidence)
    await createEvidence({
      objectId: existing.id,
      interactionId: options.interactionId,
      taskId: options.taskId,
      sourceContext: options.sourceContext,
      evidenceType: 'extraction',
      snippet: `Re-observed: ${obj.name}`,
      confidence: obj.confidence,
    });

    // Confidence reinforcement
    const step = KNOWLEDGE_CONFIG.REINFORCEMENT_STEP;
    const newConfidence = Math.min(1.0, (existing.confidence ?? 0.7) + step * (1.0 - (existing.confidence ?? 0.7)));
    await knowledgeDb.update(schema.objects)
      .set({ confidence: newConfidence, updatedAt: new Date().toISOString() })
      .where(eq(schema.objects.id, existing.id));

    return existing.id;
  }

  // Richer data — merge: update properties, confidence, and re-embed
  const mergedProps = { ...existingProps, ...newProps };
  const mergedConfidence = Math.max(obj.confidence, existing.confidence ?? 0.7);

  // Regenerate embedding to reflect merged content
  let mergedEmbedding: number[] | undefined;
  let mergedEmbeddingText: string | undefined;
  if (!options.skipEmbedding) {
    try {
      mergedEmbeddingText = buildEmbeddingText({ type: existing.type, name: obj.name, properties: mergedProps });
      mergedEmbedding = await generateEmbedding(mergedEmbeddingText, { sourceContext: options.sourceContext });
    } catch {}
  }

  await knowledgeDb.update(schema.objects)
    .set({
      properties: JSON.stringify(mergedProps),
      confidence: mergedConfidence,
      updatedAt: new Date().toISOString(),
      ...(mergedEmbedding ? {
        embedding: mergedEmbedding,
        embeddingModel: KNOWLEDGE_CONFIG.EMBEDDING_MODEL,
        embeddingText: mergedEmbeddingText,
      } : {}),
    })
    .where(eq(schema.objects.id, existing.id));

  await createEvidence({
    objectId: existing.id,
    interactionId: options.interactionId,
    taskId: options.taskId,
    sourceContext: options.sourceContext,
    evidenceType: 'extraction',
    snippet: `Updated: ${obj.name}`,
    confidence: obj.confidence,
  });

  // Add alias if the name is different
  if (buildCanonicalName(obj.name) !== existing.canonicalName) {
    await createAlias(existing.id, obj.name);
  }

  result.objectsUpdated++;
  return existing.id;
}

// ─── Link Upsert ────────────────────────────────────────────

async function upsertLink(
  link: ExtractedLink,
  source: Source,
  objectIdMap: Map<string, string>,
  result: UpsertResult,
): Promise<void> {
  // Resolve source and target to object IDs
  const sourceId = await resolveObjectId(link.sourceName, link.sourceType, objectIdMap, source, result);
  const targetId = await resolveObjectId(link.targetName, link.targetType, objectIdMap, source, result);

  if (!sourceId || !targetId) return;
  if (sourceId === targetId) return; // No self-links

  // Check for existing link
  const existing = await knowledgeDb.query.links.findFirst({
    where: and(
      eq(schema.links.sourceId, sourceId),
      eq(schema.links.targetId, targetId),
      eq(schema.links.linkType, link.linkType),
    ),
  });

  if (existing) {
    // Update confidence if higher
    if (link.confidence > (existing.confidence ?? 0)) {
      await knowledgeDb.update(schema.links)
        .set({ confidence: link.confidence, updatedAt: new Date().toISOString() })
        .where(eq(schema.links.id, existing.id));
    }
    result.linksSkipped++;
    return;
  }

  try {
    await knowledgeDb.insert(schema.links).values({
      sourceId,
      targetId,
      linkType: link.linkType,
      confidence: link.confidence,
      source,
    });
    result.linksCreated++;
  } catch {
    // UNIQUE constraint violation — link already exists
    result.linksSkipped++;
  }
}

async function resolveObjectId(
  name: string,
  type: ObjectType,
  objectIdMap: Map<string, string>,
  source: Source,
  result: UpsertResult,
): Promise<string | null> {
  const canonical = buildCanonicalName(name);

  // Check the in-memory map first (objects created in this batch)
  const mapped = objectIdMap.get(canonical);
  if (mapped) return mapped;

  // Check alias resolution
  const aliasId = await resolveAlias(name);
  if (aliasId) return aliasId;

  // Check by dedup key (unique per type, unlike canonical name)
  const dedupKey = buildDedupKey(type, { name, properties: {} });
  const existing = await knowledgeDb.query.objects.findFirst({
    where: and(
      eq(schema.objects.type, type),
      eq(schema.objects.dedupKey, dedupKey),
    ),
  });
  if (existing) return existing.id;

  // Create a stub object for unknown references
  try {
    const stub = await knowledgeDb.insert(schema.objects).values({
      type,
      name,
      canonicalName: canonical,
      dedupKey,
      properties: '{}',
      confidence: 0.3,
      source,
      status: 'active',
    }).returning();
    await createAlias(stub[0].id, name);
    objectIdMap.set(canonical, stub[0].id);
    result.stubsCreated++;
    return stub[0].id;
  } catch {
    // Dedup constraint — object was created concurrently
    const retry = await knowledgeDb.query.objects.findFirst({
      where: and(
        eq(schema.objects.type, type),
        eq(schema.objects.dedupKey, dedupKey),
      ),
    });
    return retry?.id ?? null;
  }
}

// ─── Shared Object Update (for manual edits + review approvals) ──

/**
 * Update a knowledge object while preserving all graph invariants:
 * canonical name, dedup key, aliases, embeddings, evidence.
 *
 * Use this instead of bare db.update() for any manual or review-approved edit.
 */
export async function updateKnowledgeObject(
  objectId: string,
  updates: {
    name?: string;
    properties?: Record<string, unknown> | string;
    confidence?: number;
    status?: string;
    pinned?: boolean;
    subtype?: string;
  },
  sourceContext: string = 'review',
): Promise<typeof schema.objects.$inferSelect | null> {
  const existing = await knowledgeDb.query.objects.findFirst({
    where: eq(schema.objects.id, objectId),
  });
  if (!existing) return null;

  const now = new Date().toISOString();
  const dbUpdates: Record<string, unknown> = { updatedAt: now };

  // Name change → recompute canonical name, add alias
  if (updates.name !== undefined && updates.name !== existing.name) {
    dbUpdates.name = updates.name;
    dbUpdates.canonicalName = buildCanonicalName(updates.name);
    await createAlias(objectId, updates.name);
  }

  // Properties change → validate JSON
  if (updates.properties !== undefined) {
    const propsStr = typeof updates.properties === 'string' ? updates.properties : JSON.stringify(updates.properties);
    try { JSON.parse(propsStr); } catch { throw new Error('Invalid properties JSON'); }
    dbUpdates.properties = propsStr;
  }

  // Recompute dedupKey whenever ANY dedup-relevant field changes (name, subtype, properties)
  if (updates.name !== undefined || updates.subtype !== undefined || updates.properties !== undefined) {
    const effectiveName = (updates.name ?? existing.name);
    const effectiveSubtype = (updates.subtype ?? existing.subtype) || undefined;
    const effectiveProps = dbUpdates.properties
      ? JSON.parse(dbUpdates.properties as string)
      : JSON.parse(existing.properties || '{}');
    dbUpdates.dedupKey = buildDedupKey(
      existing.type as ObjectType,
      { name: effectiveName, subtype: effectiveSubtype, properties: effectiveProps },
    );
  }

  if (updates.confidence !== undefined) dbUpdates.confidence = updates.confidence;
  if (updates.subtype !== undefined) dbUpdates.subtype = updates.subtype;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.pinned !== undefined) {
    dbUpdates.pinned = updates.pinned ? 1 : 0;
    dbUpdates.pinnedAt = updates.pinned ? now : null;
  }

  // Regenerate embedding if name or properties changed
  if (dbUpdates.name || dbUpdates.properties) {
    try {
      const props = dbUpdates.properties
        ? JSON.parse(dbUpdates.properties as string)
        : JSON.parse(existing.properties || '{}');
      const embeddingText = buildEmbeddingText({
        type: existing.type,
        name: (dbUpdates.name as string) || existing.name,
        properties: props,
      });
      const embedding = await generateEmbedding(embeddingText, { sourceContext });
      dbUpdates.embedding = embedding;
      dbUpdates.embeddingModel = KNOWLEDGE_CONFIG.EMBEDDING_MODEL;
      dbUpdates.embeddingText = embeddingText;
    } catch {
      // Embedding failure never blocks the update
    }
  }

  const updated = await knowledgeDb.update(schema.objects)
    .set(dbUpdates)
    .where(eq(schema.objects.id, objectId))
    .returning();

  // Log evidence
  await createEvidence({
    objectId,
    sourceContext,
    evidenceType: 'manual_edit',
    snippet: `Updated: ${updates.name || existing.name}`,
    confidence: updates.confidence ?? existing.confidence ?? 0.7,
  });

  invalidateRetrievalCaches();
  return updated[0] ?? null;
}
