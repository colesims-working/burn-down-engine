/**
 * Knowledge System — Consolidation Engine
 *
 * Brain-inspired memory consolidation that compresses the knowledge graph
 * without deleting anything. Runs as weekly review pre-step, on active
 * budget threshold, or manually from Settings.
 *
 * Operations (in order):
 * 1. Dormancy — fade low-salience active objects
 * 2. Deduplication — merge near-identical objects via LLM evaluation
 * 3. Synthesis — cluster observations into higher-order insights
 * 4. Reference cleanup — purge old reference records
 *
 * CRITICAL: Every operation is transactional. No partial absorptions.
 * CRITICAL: Never auto-delete. Only transition to absorbed/dormant.
 */

import { knowledgeDb, schema } from './db';
import { eq, and, ne, sql, inArray } from 'drizzle-orm';
import { computeSalience } from './scoring';
import { generateQueryEmbedding } from './embedding';
import { KNOWLEDGE_CONFIG, AUTO_PIN_SUBTYPES } from './config';
import { llmGenerateJSON } from '@/lib/llm/router';
import type { ConsolidationResult } from './types';

// ─── Types ──────────────────────────────────────────────────

interface ConsolidationOptions {
  scope?: 'full' | 'active_only';
  dryRun?: boolean;
}

// ─── Main Entry Point ───────────────────────────────────────

/**
 * Run a full consolidation cycle. Concurrency-safe: checks for running runs.
 */
export async function runConsolidation(
  options: ConsolidationOptions = {},
): Promise<ConsolidationResult> {
  const scope = options.scope ?? 'full';

  // Concurrency guard
  const existing = await knowledgeDb.query.consolidationRuns.findFirst({
    where: eq(schema.consolidationRuns.status, 'running'),
  });
  if (existing) {
    return {
      runId: existing.id,
      dormancyTransitions: 0, reactivations: 0, mergesPerformed: 0,
      synthesesCreated: 0, objectsAbsorbed: 0, referencesPurged: 0,
      errors: ['Consolidation already running'],
    };
  }

  // Create run record
  const run = await knowledgeDb.insert(schema.consolidationRuns).values({
    scope,
    status: 'running',
  }).returning();
  const runId = run[0].id;
  const sourceContext = `consolidation:${runId}`;

  const result: ConsolidationResult = {
    runId,
    dormancyTransitions: 0, reactivations: 0, mergesPerformed: 0,
    synthesesCreated: 0, objectsAbsorbed: 0, referencesPurged: 0,
    errors: [],
  };

  try {
    // Step 1: Dormancy
    if (!options.dryRun) {
      const dormancy = await runDormancy(runId, sourceContext);
      result.dormancyTransitions = dormancy.transitions;
      result.errors.push(...dormancy.errors);
    }

    // Step 2: Deduplication
    if (!options.dryRun) {
      const dedup = await runDeduplication(runId, sourceContext);
      result.mergesPerformed = dedup.merges;
      result.objectsAbsorbed += dedup.absorbed;
      result.errors.push(...dedup.errors);
    }

    // Step 3: Synthesis
    if (!options.dryRun) {
      const synth = await runSynthesis(runId, sourceContext);
      result.synthesesCreated = synth.created;
      result.objectsAbsorbed += synth.absorbed;
      result.errors.push(...synth.errors);
    }

    // Step 4: Reference cleanup
    if (!options.dryRun) {
      const cleanup = await runReferenceCleanup();
      result.referencesPurged = cleanup.purged;
    }

    // Mark complete
    await knowledgeDb.update(schema.consolidationRuns).set({
      status: 'completed',
      completedAt: new Date().toISOString(),
      dormancyTransitions: result.dormancyTransitions,
      mergesPerformed: result.mergesPerformed,
      synthesesCreated: result.synthesesCreated,
      objectsAbsorbed: result.objectsAbsorbed,
      referencesPurged: result.referencesPurged,
      errorLog: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
    }).where(eq(schema.consolidationRuns.id, runId));

  } catch (error) {
    const msg = (error as Error).message;
    result.errors.push(`Fatal: ${msg}`);
    await knowledgeDb.update(schema.consolidationRuns).set({
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorLog: JSON.stringify(result.errors),
    }).where(eq(schema.consolidationRuns.id, runId));
  }

  return result;
}

// ─── Step 1: Dormancy ───────────────────────────────────────

async function runDormancy(
  runId: string,
  sourceContext: string,
): Promise<{ transitions: number; errors: string[] }> {
  const errors: string[] = [];
  let transitions = 0;

  const activeObjects = await knowledgeDb.query.objects.findMany({
    where: and(
      eq(schema.objects.status, 'active'),
      eq(schema.objects.pinned, 0),
    ),
  });

  // Compute salience for each and collect dormancy candidates
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const toDormant: string[] = [];

  for (const obj of activeObjects) {
    // Skip protected sources and subtypes
    if (obj.source === 'manual' || obj.source === 'seed') continue;
    if (AUTO_PIN_SUBTYPES.includes(obj.subtype as any)) continue;

    // Compute days since last activity
    const lastActivity = obj.updatedAt || obj.createdAt;
    const days = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);

    // Get reference count for last 90 days
    const refResult = await knowledgeDb
      .select({ count: sql<number>`count(*)` })
      .from(schema.objectReferences)
      .where(and(
        eq(schema.objectReferences.objectId, obj.id),
        sql`${schema.objectReferences.referencedAt} >= ${ninetyDaysAgo}`,
      ));
    const refs = refResult[0]?.count ?? 0;

    const salience = computeSalience(obj.confidence ?? 0.7, days, refs);
    if (salience < KNOWLEDGE_CONFIG.DORMANT_THRESHOLD) {
      toDormant.push(obj.id);
    }
  }

  // Batch dormancy transition in a transaction
  if (toDormant.length > 0) {
    try {
      await knowledgeDb.transaction(async (tx) => {
        for (const id of toDormant) {
          await tx.update(schema.objects).set({
            status: 'dormant',
            sourceContext,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.objects.id, id));
        }
      });
      transitions = toDormant.length;
    } catch (error) {
      errors.push(`Dormancy batch failed: ${(error as Error).message}`);
    }
  }

  return { transitions, errors };
}

// ─── Step 2: Deduplication ──────────────────────────────────

async function runDeduplication(
  runId: string,
  sourceContext: string,
): Promise<{ merges: number; absorbed: number; errors: string[] }> {
  const errors: string[] = [];
  let merges = 0;
  let absorbed = 0;
  const alreadyMerged = new Set<string>();

  // Get active objects with embeddings
  const candidates = await knowledgeDb.query.objects.findMany({
    where: and(
      eq(schema.objects.status, 'active'),
      sql`${schema.objects.embedding} IS NOT NULL`,
    ),
  });

  for (const obj of candidates) {
    if (alreadyMerged.has(obj.id)) continue;

    // Per-object vector_top_k — NOT cross-join (per spec)
    try {
      const similar = await knowledgeDb.all<any>(sql`
        SELECT o.id, o.name, o.type, o.subtype, o.properties, o.confidence,
               (1.0 - vector_distance_cos(o.embedding, (SELECT embedding FROM objects WHERE id = ${obj.id}))) AS similarity
        FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects WHERE id = ${obj.id}), 5) AS v
        JOIN objects o ON o.rowid = v.id
        WHERE o.id != ${obj.id}
          AND o.status = 'active'
          AND o.type = ${obj.type}
      `);

      for (const match of similar) {
        if (alreadyMerged.has(match.id)) continue;
        if ((match.similarity ?? 0) < KNOWLEDGE_CONFIG.DEDUP_SIMILARITY_THRESHOLD) continue;

        // LLM merge evaluation
        try {
          const evaluation = await llmGenerateJSON<{ shouldMerge: boolean; survivorName: string; mergedProperties: Record<string, unknown>; reason: string }>({
            system: `You are evaluating whether two knowledge objects are duplicates that should be merged. Return JSON with shouldMerge (boolean), survivorName (the better name to keep), mergedProperties (combined properties), and reason.`,
            prompt: `Object A: ${obj.name} — ${obj.properties}\nObject B: ${match.name} — ${match.properties}\n\nAre these duplicates? If so, which name is better and how should properties be combined?`,
            operation: 'extract_knowledge',
          });

          if (!evaluation.shouldMerge) continue;

          // Merge in transaction
          await knowledgeDb.transaction(async (tx) => {
            const survivor = obj;
            const retired = match;

            // Update survivor with merged properties
            await tx.update(schema.objects).set({
              properties: JSON.stringify(evaluation.mergedProperties),
              name: evaluation.survivorName || survivor.name,
              confidence: Math.max(survivor.confidence ?? 0.7, retired.confidence ?? 0.7),
              sourceContext,
              updatedAt: new Date().toISOString(),
            }).where(eq(schema.objects.id, survivor.id));

            // Mark retired as absorbed
            await tx.update(schema.objects).set({
              status: 'absorbed',
              supersededBy: survivor.id,
              sourceContext,
              updatedAt: new Date().toISOString(),
            }).where(eq(schema.objects.id, retired.id));

            // Create absorbed_into link
            await tx.insert(schema.links).values({
              sourceId: retired.id,
              targetId: survivor.id,
              linkType: 'absorbed_into',
              confidence: 1.0,
              source: 'consolidated',
            });

            // Re-point all links from retired to survivor
            await tx.update(schema.links).set({
              sourceId: survivor.id,
            }).where(and(
              eq(schema.links.sourceId, retired.id),
              ne(schema.links.linkType, 'absorbed_into'),
            ));
            await tx.update(schema.links).set({
              targetId: survivor.id,
            }).where(and(
              eq(schema.links.targetId, retired.id),
              ne(schema.links.linkType, 'absorbed_into'),
            ));
          });

          alreadyMerged.add(match.id);
          merges++;
          absorbed++;
        } catch (error) {
          errors.push(`Merge eval "${obj.name}" ↔ "${match.name}": ${(error as Error).message}`);
        }
      }
    } catch (error) {
      errors.push(`Dedup scan "${obj.name}": ${(error as Error).message}`);
    }
  }

  return { merges, absorbed, errors };
}

// ─── Step 3: Synthesis ──────────────────────────────────────

async function runSynthesis(
  runId: string,
  sourceContext: string,
): Promise<{ created: number; absorbed: number; errors: string[] }> {
  const errors: string[] = [];
  let created = 0;
  let absorbed = 0;

  // Get low-salience observations (primary synthesis targets)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const observations = await knowledgeDb.query.objects.findMany({
    where: and(
      eq(schema.objects.status, 'active'),
      eq(schema.objects.subtype, 'observation'),
    ),
  });

  if (observations.length < KNOWLEDGE_CONFIG.SYNTHESIS_MIN_CLUSTER_SIZE) {
    return { created, absorbed, errors };
  }

  // Get all links for these observations to find graph locality
  const obsIds = observations.map(o => o.id);

  // Build adjacency: which objects share linked projects/people?
  const linkedEntities = new Map<string, Set<string>>(); // obsId → set of linked entity IDs
  for (const obsId of obsIds) {
    const links = await knowledgeDb.query.links.findMany({
      where: sql`(${schema.links.sourceId} = ${obsId} OR ${schema.links.targetId} = ${obsId})`,
    });
    const entityIds = new Set<string>();
    for (const link of links) {
      entityIds.add(link.sourceId === obsId ? link.targetId : link.sourceId);
    }
    linkedEntities.set(obsId, entityIds);
  }

  // Cluster by graph locality: observations sharing linked entities
  const clusters: string[][] = [];
  const assigned = new Set<string>();

  for (const obs of observations) {
    if (assigned.has(obs.id)) continue;
    const myLinks = linkedEntities.get(obs.id) ?? new Set();
    if (myLinks.size === 0) continue;

    const cluster = [obs.id];
    assigned.add(obs.id);

    for (const other of observations) {
      if (assigned.has(other.id)) continue;
      const otherLinks = linkedEntities.get(other.id) ?? new Set();
      // Check for shared linked entities
      const shared = [...myLinks].some(id => otherLinks.has(id));
      if (shared) {
        cluster.push(other.id);
        assigned.add(other.id);
      }
    }

    if (cluster.length >= KNOWLEDGE_CONFIG.SYNTHESIS_MIN_CLUSTER_SIZE) {
      clusters.push(cluster);
    }
  }

  // Also cluster unlinked observations by embedding similarity
  const unassigned = observations.filter(o => !assigned.has(o.id) && o.embedding);
  if (unassigned.length >= KNOWLEDGE_CONFIG.SYNTHESIS_MIN_CLUSTER_SIZE) {
    // Simple greedy clustering by embedding similarity
    for (const seed of unassigned) {
      if (assigned.has(seed.id)) continue;

      try {
        const similar = await knowledgeDb.all<any>(sql`
          SELECT o.id,
                 (1.0 - vector_distance_cos(o.embedding, (SELECT embedding FROM objects WHERE id = ${seed.id}))) AS similarity
          FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects WHERE id = ${seed.id}), 10) AS v
          JOIN objects o ON o.rowid = v.id
          WHERE o.id != ${seed.id}
            AND o.status = 'active'
            AND o.subtype = 'observation'
        `);

        const cluster = [seed.id];
        assigned.add(seed.id);

        for (const match of similar) {
          if (assigned.has(match.id)) continue;
          if ((match.similarity ?? 0) >= KNOWLEDGE_CONFIG.SYNTHESIS_CLUSTER_SIMILARITY) {
            cluster.push(match.id);
            assigned.add(match.id);
          }
        }

        if (cluster.length >= KNOWLEDGE_CONFIG.SYNTHESIS_MIN_CLUSTER_SIZE) {
          clusters.push(cluster);
        }
      } catch {}
    }
  }

  // Synthesize each cluster
  for (const cluster of clusters) {
    try {
      const clusterObjects = observations.filter(o => cluster.includes(o.id));
      const summaries = clusterObjects.map(o => {
        const props = JSON.parse(o.properties || '{}');
        return `- ${o.name}: ${props.value || ''}`;
      }).join('\n');

      const synthesis = await llmGenerateJSON<{
        insightName: string;
        insightValue: string;
        subtype: string;
        confidence: number;
      }>({
        system: `You are synthesizing multiple behavioral observations into a single higher-order insight. The insight should capture the underlying pattern that explains all the observations. Return JSON with insightName (short key), insightValue (the synthesized insight), subtype (usually "pattern" or "preference"), and confidence (0-1).`,
        prompt: `Synthesize these ${clusterObjects.length} observations into one insight:\n${summaries}`,
        operation: 'extract_knowledge',
      });

      // Create synthesis in transaction
      await knowledgeDb.transaction(async (tx) => {
        // Create new insight
        const insight = await tx.insert(schema.objects).values({
          type: 'concept',
          subtype: synthesis.subtype || 'pattern',
          name: synthesis.insightName,
          canonicalName: synthesis.insightName.toLowerCase().trim().replace(/\s+/g, ' '),
          dedupKey: `concept:${synthesis.subtype || 'pattern'}:${synthesis.insightName.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
          properties: JSON.stringify({
            value: synthesis.insightValue,
            synthesis_sources: clusterObjects.length,
          }),
          status: 'active',
          confidence: synthesis.confidence,
          source: 'consolidated',
          sourceContext,
        }).returning();

        const insightId = insight[0].id;

        // Mark sources as absorbed
        for (const src of clusterObjects) {
          await tx.update(schema.objects).set({
            status: 'absorbed',
            supersededBy: insightId,
            sourceContext,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.objects.id, src.id));

          // Create absorbed_into link
          await tx.insert(schema.links).values({
            sourceId: src.id,
            targetId: insightId,
            linkType: 'absorbed_into',
            confidence: 1.0,
            source: 'consolidated',
          });

          // Inherit relevant links from source (not absorbed_into)
          const srcLinks = await tx.query.links.findMany({
            where: and(
              sql`(${schema.links.sourceId} = ${src.id} OR ${schema.links.targetId} = ${src.id})`,
              ne(schema.links.linkType, 'absorbed_into'),
            ),
          });
          for (const link of srcLinks) {
            const isSource = link.sourceId === src.id;
            try {
              await tx.insert(schema.links).values({
                sourceId: isSource ? insightId : link.sourceId,
                targetId: isSource ? link.targetId : insightId,
                linkType: link.linkType,
                confidence: link.confidence,
                source: 'consolidated',
              });
            } catch {
              // UNIQUE constraint — link already exists, skip
            }
          }
        }
      });

      created++;
      absorbed += clusterObjects.length;
    } catch (error) {
      errors.push(`Synthesis failed: ${(error as Error).message}`);
    }
  }

  return { created, absorbed, errors };
}

// ─── Step 4: Reference Cleanup ──────────────────────────────

async function runReferenceCleanup(): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - KNOWLEDGE_CONFIG.REFERENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result = await knowledgeDb.delete(schema.objectReferences)
    .where(sql`${schema.objectReferences.referencedAt} < ${cutoff}`);

  return { purged: (result as any).changes ?? 0 };
}

// ─── Confidence Reinforcement ───────────────────────────────

/**
 * Finalize reference outcomes for an interaction and reinforce confidence.
 * Called after LLM interactions with the outcome of knowledge usage.
 */
export async function finalizeReferenceOutcomes(
  interactionId: string,
  outcome: 'positive' | 'negative' | 'neutral',
): Promise<void> {
  try {
    // Update all pending references for this interaction
    const refs = await knowledgeDb.query.objectReferences.findMany({
      where: and(
        eq(schema.objectReferences.interactionId, interactionId),
        eq(schema.objectReferences.outcome, 'pending'),
      ),
    });

    for (const ref of refs) {
      await knowledgeDb.update(schema.objectReferences).set({
        outcome,
      }).where(eq(schema.objectReferences.id, ref.id));

      // Positive reinforcement
      if (outcome === 'positive') {
        const obj = await knowledgeDb.query.objects.findFirst({
          where: eq(schema.objects.id, ref.objectId),
        });
        if (obj) {
          const step = KNOWLEDGE_CONFIG.REINFORCEMENT_STEP;
          const newConf = Math.min(1.0, (obj.confidence ?? 0.7) + step * (1.0 - (obj.confidence ?? 0.7)));
          await knowledgeDb.update(schema.objects).set({
            confidence: newConf,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.objects.id, obj.id));
        }
      }
      // Negative: logged via the outcome update above, not penalized directly
    }
  } catch (error) {
    console.error('Failed to finalize reference outcomes:', error);
  }
}

// ─── Rollback ───────────────────────────────────────────────

/**
 * Revert a consolidation run: restore absorbed objects, delete created
 * objects/links, revert dormancy transitions. Full rollback.
 */
export async function revertConsolidationRun(runId: string): Promise<{ reverted: boolean; error?: string }> {
  const run = await knowledgeDb.query.consolidationRuns.findFirst({
    where: eq(schema.consolidationRuns.id, runId),
  });

  if (!run) return { reverted: false, error: 'Run not found' };
  if (run.status === 'reverted') return { reverted: false, error: 'Already reverted' };
  if (run.status === 'running') return { reverted: false, error: 'Cannot revert running consolidation' };

  const sourceContext = `consolidation:${runId}`;

  try {
    await knowledgeDb.transaction(async (tx) => {
      // 1. Restore absorbed objects → active
      await tx.update(schema.objects).set({
        status: 'active',
        supersededBy: null,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(schema.objects.status, 'absorbed'),
        eq(schema.objects.sourceContext, sourceContext),
      ));

      // 2. Restore dormant objects → active
      await tx.update(schema.objects).set({
        status: 'active',
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(schema.objects.status, 'dormant'),
        eq(schema.objects.sourceContext, sourceContext),
      ));

      // 3. Delete objects created by this consolidation (synthesis outputs)
      const createdObjects = await tx.query.objects.findMany({
        where: and(
          eq(schema.objects.source, 'consolidated'),
          eq(schema.objects.sourceContext, sourceContext),
        ),
      });
      const createdIds = createdObjects.map(o => o.id);

      // Delete links pointing to/from created objects first (FK constraint)
      if (createdIds.length > 0) {
        for (const id of createdIds) {
          await tx.delete(schema.links).where(
            sql`${schema.links.sourceId} = ${id} OR ${schema.links.targetId} = ${id}`
          );
          // Delete evidence for created objects
          await tx.delete(schema.objectEvidence).where(eq(schema.objectEvidence.objectId, id));
          // Delete aliases for created objects
          await tx.delete(schema.objectAliases).where(eq(schema.objectAliases.objectId, id));
          // Delete references for created objects
          await tx.delete(schema.objectReferences).where(eq(schema.objectReferences.objectId, id));
        }
        // Delete the created objects themselves
        for (const id of createdIds) {
          await tx.delete(schema.objects).where(eq(schema.objects.id, id));
        }
      }

      // 4. Delete absorbed_into links created by this run
      await tx.delete(schema.links).where(and(
        eq(schema.links.linkType, 'absorbed_into'),
        eq(schema.links.source, 'consolidated'),
      ));

      // 5. Mark run as reverted
      await tx.update(schema.consolidationRuns).set({
        status: 'reverted',
        completedAt: new Date().toISOString(),
      }).where(eq(schema.consolidationRuns.id, runId));
    });

    return { reverted: true };
  } catch (error) {
    return { reverted: false, error: (error as Error).message };
  }
}

// ─── Active Object Budget Check ─────────────────────────────

/**
 * Check if active object count exceeds budget. Used as auto-trigger.
 */
export async function shouldAutoConsolidate(): Promise<boolean> {
  const result = await knowledgeDb
    .select({ count: sql<number>`count(*)` })
    .from(schema.objects)
    .where(eq(schema.objects.status, 'active'));
  return (result[0]?.count ?? 0) > KNOWLEDGE_CONFIG.ACTIVE_OBJECT_BUDGET;
}
