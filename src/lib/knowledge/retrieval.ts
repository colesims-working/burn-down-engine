/**
 * Knowledge System — 4-Stage Retrieval Pipeline
 *
 * Replaces the legacy src/lib/llm/context.ts with a GraphRAG pipeline:
 *   1. Global Context — pinned objects + project summary
 *   2. Semantic Recall — vector_top_k on active objects + dormant reactivation
 *   3. Graph Expansion — 1-hop and 2-hop link traversal from seeds
 *   4. Rank & Assemble — score, deduplicate, budget-pack, log references
 *
 * CRITICAL: vector_top_k uses raw SQL. Drizzle cannot express table-valued functions.
 */

import { knowledgeDb, schema } from './db';
import { db as taskDb, schema as taskSchema } from '@/lib/db/client';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { generateQueryEmbedding } from './embedding';
import {
  computeRetrievalScore, computeRecencyWeight, computeReferenceDensity,
  computeTemporalRelevance, computeGraphScore, applyPageBoost,
  estimateTokens, formatObjectForPrompt,
} from './scoring';
import { KNOWLEDGE_CONFIG, EXPANSION_ALLOWLIST, PAGE_BOOSTS } from './config';
import type { PageContext, PromptContext } from './types';

// ─── Internal Types ─────────────────────────────────────────

interface ScoredObject {
  id: string;
  type: string;
  subtype: string | null;
  name: string;
  properties: string;
  confidence: number | null;
  updatedAt: string | null;
  status: string;
  supersededBy: string | null;
  sensitivity: string;
  score: number;
  vectorSimilarity: number;
  source: 'pinned' | 'vector' | 'graph' | 'cold_start';
}

// ─── Main Pipeline ──────────────────────────────────────────

/**
 * Build context for an LLM prompt using the 4-stage retrieval pipeline.
 *
 * Backward-compatible: returns a plain string (markdown).
 * For callers needing metadata, use buildContextFull().
 */
export async function buildKnowledgeContext(
  input: string,
  page: PageContext | string,
): Promise<string> {
  const result = await buildContextFull(input, page as PageContext);
  const combined = [result.globalContext, result.retrievedContext]
    .filter(s => s.length > 0)
    .join('\n\n');
  return combined;
}

/**
 * Full pipeline returning structured context with metadata.
 */
export async function buildContextFull(
  input: string,
  page: PageContext,
): Promise<PromptContext> {
  const interactionId = crypto.randomUUID();
  const allCandidates: ScoredObject[] = [];

  // ─── Stage 1: Global Context ────────────────────────────
  const globalContext = await buildGlobalContext();

  // ─── Check cold start ───────────────────────────────────
  const activeCount = await knowledgeDb
    .select({ count: sql<number>`count(*)` })
    .from(schema.objects)
    .where(eq(schema.objects.status, 'active'));
  const isColdStart = (activeCount[0]?.count ?? 0) < KNOWLEDGE_CONFIG.COLD_START_THRESHOLD;

  let vectorResults = 0;
  let reactivations = 0;
  let graphExpansionResults = 0;

  if (isColdStart) {
    // Cold start: include all active non-pinned objects, skip vector search
    const allActive = await knowledgeDb.query.objects.findMany({
      where: and(eq(schema.objects.status, 'active'), eq(schema.objects.pinned, 0)),
    });
    for (const obj of allActive) {
      allCandidates.push({
        ...obj,
        score: 0.5,
        vectorSimilarity: 0,
        source: 'cold_start',
      });
    }
  } else if (input.trim().length > 0) {
    // ─── Stage 2: Semantic Recall ───────────────────────────
    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateQueryEmbedding(input, 'retrieval', 'retrieval');
    } catch (error) {
      console.error('Query embedding failed, falling back to global-only:', error);
      queryEmbedding = [];
    }

    if (queryEmbedding.length > 0) {
      const vectorCandidates = await semanticRecall(queryEmbedding);
      allCandidates.push(...vectorCandidates);
      vectorResults = vectorCandidates.length;

      // Dormant reactivation check (reuse same embedding)
      const reactivated = await checkDormantReactivation(queryEmbedding);
      reactivations = reactivated;

      // ─── Stage 3: Graph Expansion ───────────────────────────
      const seeds = allCandidates.filter(c => c.source === 'vector').slice(0, 10);
      const expanded = await graphExpansion(seeds);
      const existingIds = new Set(allCandidates.map(c => c.id));
      const newExpanded = expanded.filter(e => !existingIds.has(e.id));
      allCandidates.push(...newExpanded);
      graphExpansionResults = newExpanded.length;
    }
  }

  // ─── Stage 4: Rank & Assemble ───────────────────────────
  const { assembled, referencedIds } = await rankAndAssemble(
    allCandidates, page, interactionId,
  );

  const tokenCount = estimateTokens(globalContext) + estimateTokens(assembled);

  return {
    globalContext,
    retrievedContext: assembled,
    referencedObjectIds: referencedIds,
    interactionId,
    tokenCount,
    debugInfo: {
      vectorResults,
      reactivations,
      graphExpansionResults,
      totalCandidates: allCandidates.length,
      budgetUtilization: tokenCount / (KNOWLEDGE_CONFIG.GLOBAL_CONTEXT_TOKEN_BUDGET + KNOWLEDGE_CONFIG.RETRIEVED_CONTEXT_TOKEN_BUDGET),
      coldStartMode: isColdStart,
    },
  };
}

// ─── Stage 1: Global Context ────────────────────────────────

async function buildGlobalContext(): Promise<string> {
  const sections: string[] = [];

  // Pinned objects (identity, priorities, etc.)
  const pinned = await knowledgeDb.query.objects.findMany({
    where: and(
      eq(schema.objects.pinned, 1),
      eq(schema.objects.status, 'active'),
    ),
  });

  if (pinned.length > 0) {
    const identityObjs = pinned.filter(o => o.subtype === 'identity');
    const priorityObjs = pinned.filter(o => o.subtype === 'priority');
    const otherPinned = pinned.filter(o => o.subtype !== 'identity' && o.subtype !== 'priority');

    if (identityObjs.length > 0) {
      sections.push('## User Identity\n' + identityObjs.map(o => `- ${formatObjectForPrompt(o)}`).join('\n'));
    }
    if (priorityObjs.length > 0) {
      sections.push('## Current Priorities\n' + priorityObjs.map(o => `- ${formatObjectForPrompt(o)}`).join('\n'));
    }
    if (otherPinned.length > 0) {
      sections.push('## Pinned Knowledge\n' + otherPinned.map(o => `- ${formatObjectForPrompt(o)}`).join('\n'));
    }
  }

  // Active project summary from task DB (top 5 by recent activity to stay within token budget)
  try {
    const projects = await taskDb.query.projects.findMany({
      where: eq(taskSchema.projects.status, 'active'),
    });
    if (projects.length > 0) {
      // Sort by most recent activity, take top 5
      const sorted = [...projects]
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
        .slice(0, 5);
      const lines = sorted.map(p => {
        const parts = [`**${p.name}**`];
        if (p.category) parts.push(`[${p.category}]`);
        if (p.goal) parts.push(`— ${p.goal}`);
        parts.push(`(${p.openActionCount || 0} open tasks)`);
        return `- ${parts.join(' ')}`;
      });
      sections.push(`## Active Projects (top ${sorted.length} of ${projects.length})\n` + lines.join('\n'));
    }
  } catch {
    // Task DB unavailable — continue without project summary
  }

  if (sections.length === 0) {
    return 'No knowledge context available yet. This is a new user — learn about them from their tasks.';
  }

  return sections.join('\n\n');
}

// ─── Stage 2: Semantic Recall ───────────────────────────────

async function semanticRecall(queryEmbedding: number[]): Promise<ScoredObject[]> {
  const inflatedK = Math.ceil(KNOWLEDGE_CONFIG.RETRIEVAL_TOP_K * KNOWLEDGE_CONFIG.RETRIEVAL_K_INFLATION);

  // Raw SQL: vector_top_k for candidate set, vector_distance_cos for similarity score.
  // vector_top_k returns only rowid; distance is computed via vector_distance_cos().
  // Note: vector_distance_cos returns cosine distance (0 = identical), so similarity = 1 - distance.
  const queryVec = JSON.stringify(queryEmbedding);
  const vectorResults = await knowledgeDb.all<any>(sql`
    SELECT o.id, o.type, o.subtype, o.name, o.properties, o.confidence,
           o.updated_at, o.status, o.superseded_by, o.sensitivity, o.pinned,
           (1.0 - vector_distance_cos(o.embedding, vector(${queryVec}))) AS similarity
    FROM vector_top_k('objects_embedding_idx', vector(${queryVec}), ${inflatedK}) AS v
    JOIN objects o ON o.rowid = v.id
    WHERE o.status = 'active'
      AND o.superseded_by IS NULL
      AND o.pinned = 0
    LIMIT ${KNOWLEDGE_CONFIG.RETRIEVAL_TOP_K}
  `);

  // Fetch reference counts for scoring
  const objectIds = vectorResults.map((r: any) => r.id);
  const refCounts = objectIds.length > 0 ? await getReferenceCounts(objectIds) : new Map<string, number>();

  return vectorResults.map((r: any) => {
    const similarity = r.similarity ?? 0;
    const refsLast90 = refCounts.get(r.id) ?? 0;
    const props = r.properties || '{}';
    const eventDate = r.type === 'event' ? (JSON.parse(props).date ?? null) : null;

    const score = computeRetrievalScore({
      vectorSimilarity: similarity,
      linkProximity: 0, // No graph data yet
      recencyWeight: computeRecencyWeight(r.updated_at),
      referenceDensity: computeReferenceDensity(refsLast90),
      temporalRelevance: r.type === 'event' || r.subtype === 'schedule'
        ? computeTemporalRelevance(eventDate) : undefined,
      isEvent: r.type === 'event' || r.subtype === 'schedule',
    });

    return {
      id: r.id,
      type: r.type,
      subtype: r.subtype,
      name: r.name,
      properties: props,
      confidence: r.confidence,
      updatedAt: r.updated_at,
      status: r.status,
      supersededBy: r.superseded_by,
      sensitivity: r.sensitivity,
      score,
      vectorSimilarity: similarity,
      source: 'vector' as const,
    };
  });
}

// ─── Dormant Reactivation ───────────────────────────────────

async function checkDormantReactivation(queryEmbedding: number[]): Promise<number> {
  const dormantVec = JSON.stringify(queryEmbedding);
  const dormantResults = await knowledgeDb.all<any>(sql`
    SELECT o.id,
           (1.0 - vector_distance_cos(o.embedding, vector(${dormantVec}))) AS similarity
    FROM vector_top_k('objects_embedding_idx', vector(${dormantVec}), 5) AS v
    JOIN objects o ON o.rowid = v.id
    WHERE o.status = 'dormant'
      AND o.superseded_by IS NULL
  `);

  let reactivated = 0;
  for (const r of dormantResults) {
    if ((r.similarity ?? 0) >= KNOWLEDGE_CONFIG.REACTIVATION_THRESHOLD) {
      await knowledgeDb.update(schema.objects)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(schema.objects.id, r.id));
      reactivated++;
    }
  }
  return reactivated;
}

// ─── Stage 3: Graph Expansion ───────────────────────────────

async function graphExpansion(seeds: ScoredObject[]): Promise<ScoredObject[]> {
  if (seeds.length === 0) return [];

  const expanded: ScoredObject[] = [];
  const seenIds = new Set(seeds.map(s => s.id));
  const allowedTypes = EXPANSION_ALLOWLIST as readonly string[];

  // Track which seed spawned each 1-hop node (for 2-hop lineage)
  const hop1ParentSeedId = new Map<string, string>();

  // 1-hop expansion from all seeds
  for (const seed of seeds) {
    if (expanded.length >= KNOWLEDGE_CONFIG.MAX_GRAPH_EXPANSION_TOTAL) break;

    const neighborsResult = await knowledgeDb.all<any>(sql`
      SELECT o.id, o.type, o.subtype, o.name, o.properties, o.confidence,
             o.updated_at, o.status, o.superseded_by, o.sensitivity,
             l.confidence AS edge_confidence, l.link_type
      FROM links l
      JOIN objects o ON (o.id = l.target_id OR o.id = l.source_id)
      WHERE (l.source_id = ${seed.id} OR l.target_id = ${seed.id})
        AND o.id != ${seed.id}
        AND o.status = 'active'
        AND o.superseded_by IS NULL
        AND l.link_type IN (${sql.join(allowedTypes.map(t => sql`${t}`), sql`, `)})
      LIMIT ${KNOWLEDGE_CONFIG.MAX_1HOP_PER_SEED}
    `);

    for (const n of neighborsResult) {
      if (seenIds.has(n.id)) continue;
      if (expanded.length >= KNOWLEDGE_CONFIG.MAX_GRAPH_EXPANSION_TOTAL) break;
      seenIds.add(n.id);
      hop1ParentSeedId.set(n.id, seed.id);

      const graphScore = computeGraphScore(seed.vectorSimilarity, n.edge_confidence ?? 0.5, 1);

      expanded.push({
        id: n.id,
        type: n.type,
        subtype: n.subtype,
        name: n.name,
        properties: n.properties || '{}',
        confidence: n.confidence,
        updatedAt: n.updated_at,
        status: n.status,
        supersededBy: n.superseded_by,
        sensitivity: n.sensitivity,
        score: graphScore,
        vectorSimilarity: graphScore,
        source: 'graph',
      });
    }
  }

  // 2-hop expansion from person/project seeds only
  const personProjectSeedIds = new Set(
    seeds.filter(s => s.type === 'person' || s.type === 'project').map(s => s.id)
  );
  const hop1Ids = expanded.filter(e => e.source === 'graph').map(e => e.id);

  for (const secondaryId of hop1Ids) {
    if (expanded.length >= KNOWLEDGE_CONFIG.MAX_GRAPH_EXPANSION_TOTAL) break;

    // Only 2-hop if the 1-hop came from a person/project seed
    const parentId = hop1ParentSeedId.get(secondaryId);
    if (!parentId || !personProjectSeedIds.has(parentId)) continue;

    const hop2Result = await knowledgeDb.all<any>(sql`
      SELECT o.id, o.type, o.subtype, o.name, o.properties, o.confidence,
             o.updated_at, o.status, o.superseded_by, o.sensitivity,
             l.confidence AS edge_confidence
      FROM links l
      JOIN objects o ON (o.id = l.target_id OR o.id = l.source_id)
      WHERE (l.source_id = ${secondaryId} OR l.target_id = ${secondaryId})
        AND o.id != ${secondaryId}
        AND o.status = 'active'
        AND o.superseded_by IS NULL
        AND l.link_type IN (${sql.join(allowedTypes.map(t => sql`${t}`), sql`, `)})
      LIMIT ${KNOWLEDGE_CONFIG.MAX_2HOP_PER_SEED}
    `);

    for (const n of hop2Result) {
      if (seenIds.has(n.id)) continue;
      if (expanded.length >= KNOWLEDGE_CONFIG.MAX_GRAPH_EXPANSION_TOTAL) break;
      seenIds.add(n.id);

      const hop1Obj = expanded.find(e => e.id === secondaryId);
      const seedSim = hop1Obj?.vectorSimilarity ?? 0.5;
      const graphScore = computeGraphScore(seedSim, n.edge_confidence ?? 0.5, 2);

      expanded.push({
        id: n.id,
        type: n.type,
        subtype: n.subtype,
        name: n.name,
        properties: n.properties || '{}',
        confidence: n.confidence,
        updatedAt: n.updated_at,
        status: n.status,
        supersededBy: n.superseded_by,
        sensitivity: n.sensitivity,
        score: graphScore,
        vectorSimilarity: graphScore,
        source: 'graph',
      });
    }
  }

  return expanded;
}

// ─── Stage 4: Rank & Assemble ───────────────────────────────

async function rankAndAssemble(
  candidates: ScoredObject[],
  page: PageContext,
  interactionId: string,
): Promise<{ assembled: string; referencedIds: string[] }> {
  if (candidates.length === 0) {
    return { assembled: '', referencedIds: [] };
  }

  // Apply page boosts
  for (const c of candidates) {
    c.score = applyPageBoost(c.score, c.subtype, page);
  }

  // Conflict handling: supersedes → keep new only
  const supersededIds = new Set(
    candidates.filter(c => c.supersededBy).map(c => c.id)
  );

  // Detect contradicts links among candidates for flagging
  const candidateIds = candidates.map(c => c.id);
  const contradictPairs = new Set<string>();
  if (candidateIds.length > 0) {
    try {
      const contradicts = await knowledgeDb.all<any>(sql`
        SELECT source_id, target_id FROM links
        WHERE link_type = 'contradicts'
          AND source_id IN (${sql.join(candidateIds.map(id => sql`${id}`), sql`, `)})
          AND target_id IN (${sql.join(candidateIds.map(id => sql`${id}`), sql`, `)})
      `);
      for (const row of contradicts) {
        contradictPairs.add(row.source_id);
        contradictPairs.add(row.target_id);
      }
    } catch {}
  }

  // Sort by score descending
  const ranked = candidates
    .filter(c => !supersededIds.has(c.id))
    .sort((a, b) => b.score - a.score);

  // Budget-pack to token limit
  const budget = KNOWLEDGE_CONFIG.RETRIEVED_CONTEXT_TOKEN_BUDGET;
  let usedTokens = 0;
  const included: ScoredObject[] = [];

  for (const obj of ranked) {
    const formatted = formatObjectForPrompt(obj);
    const tokens = estimateTokens(formatted);
    if (usedTokens + tokens > budget) break;
    included.push(obj);
    usedTokens += tokens;
  }

  // Log references (best-effort, non-blocking)
  const referencedIds = included.map(o => o.id);
  logReferences(referencedIds, interactionId, page).catch(() => {});

  // Assemble markdown
  if (included.length === 0) return { assembled: '', referencedIds: [] };

  const lines = included.map(o => {
    const flag = contradictPairs.has(o.id) ? ' ⚠️ CONFLICTING' : '';
    return `- ${formatObjectForPrompt(o)}${flag}`;
  });

  // Wrap in knowledge_context tags per spec (prompt injection hygiene)
  const assembled = `<knowledge_context>\n## Retrieved Knowledge\n${lines.join('\n')}\n</knowledge_context>`;

  return { assembled, referencedIds };
}

// ─── Helpers ────────────────────────────────────────────────

async function getReferenceCounts(objectIds: string[]): Promise<Map<string, number>> {
  if (objectIds.length === 0) return new Map();

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const counts = await knowledgeDb
    .select({
      objectId: schema.objectReferences.objectId,
      count: sql<number>`count(*)`,
    })
    .from(schema.objectReferences)
    .where(and(
      inArray(schema.objectReferences.objectId, objectIds),
      sql`${schema.objectReferences.referencedAt} >= ${ninetyDaysAgo}`,
    ))
    .groupBy(schema.objectReferences.objectId);

  return new Map(counts.map(c => [c.objectId, c.count]));
}

async function logReferences(
  objectIds: string[],
  interactionId: string,
  context: string,
): Promise<void> {
  if (objectIds.length === 0) return;

  for (const objectId of objectIds) {
    try {
      await knowledgeDb.insert(schema.objectReferences).values({
        objectId,
        interactionId,
        context,
        outcome: 'pending',
      });
    } catch {
      // Best-effort — constraint violations are harmless
    }
  }
}
