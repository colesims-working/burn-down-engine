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
// ─── Retrieval Serialization ────────────────────────────────
// Only ONE retrieval pipeline runs at a time. Concurrent calls wait and share
// the result. This prevents 5 concurrent clarify calls from firing 40+ Turso
// queries simultaneously, which causes SQLITE_NOMEM on the free tier.
// Results cached for 2 minutes since the knowledge graph doesn't change mid-batch.
let _contextCache: { context: string; ts: number } | null = null;
let _contextInFlight: Promise<string> | null = null;
const CONTEXT_CACHE_TTL = 120_000;

export async function buildKnowledgeContext(
  input: string,
  page: PageContext | string,
): Promise<string> {
  // Cache hit — reuse recent context (knowledge graph doesn't change mid-batch)
  if (_contextCache && Date.now() - _contextCache.ts < CONTEXT_CACHE_TTL) {
    return _contextCache.context;
  }

  // If another retrieval is already running, wait for it instead of firing another
  if (_contextInFlight) return _contextInFlight;

  // Run the pipeline — only one at a time
  const promise = (async () => {
    try {
      const result = await buildContextFull(input, page as PageContext);
      const combined = [result.globalContext, result.retrievedContext]
        .filter(s => s.length > 0)
        .join('\n\n');
      _contextCache = { context: combined, ts: Date.now() };
      return combined;
    } finally {
      _contextInFlight = null;
    }
  })();

  _contextInFlight = promise;
  return promise;
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
  const _tGlobal = Date.now();
  const globalContext = await buildGlobalContext();
  console.log(`[retrieval] stage1 global: ${Date.now() - _tGlobal}ms`);

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
    const embStart = Date.now();
    try {
      queryEmbedding = await generateQueryEmbedding(input, 'retrieval', 'retrieval');
    } catch (error) {
      console.error('Query embedding failed, falling back to global-only:', error);
      queryEmbedding = [];
    }
    const embEnd = Date.now();
    console.log(`[retrieval] embedding: ${embEnd - embStart}ms`);

    if (queryEmbedding.length > 0) {
      const _tVec = Date.now();
      const vectorCandidates = await semanticRecall(queryEmbedding);
      console.log(`[retrieval] stage2 vector search: ${Date.now() - _tVec}ms (${vectorCandidates.length} results)`);
      allCandidates.push(...vectorCandidates);
      vectorResults = vectorCandidates.length;

      // Dormant reactivation check (reuse same embedding)
      const _tDorm = Date.now();
      const reactivated = await checkDormantReactivation(queryEmbedding);
      console.log(`[retrieval] stage2 dormant check: ${Date.now() - _tDorm}ms`);
      reactivations = reactivated;

      // ─── Stage 3: Graph Expansion ───────────────────────────
      const _tGraph = Date.now();
      const seeds = allCandidates.filter(c => c.source === 'vector').slice(0, 10);
      const expanded = await graphExpansion(seeds);
      console.log(`[retrieval] stage3 graph expansion: ${Date.now() - _tGraph}ms (${expanded.length} results)`);
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

// ─── Object Cache for Client-Side Similarity ───────────────
// Load all active objects with embeddings once, compute cosine similarity in JS.
// Eliminates the 16KB vector_top_k payload that causes Turso latency spikes.
let _objectCache: { objects: any[]; ts: number } | null = null;
const OBJECT_CACHE_TTL = 120_000; // 2 minutes

async function getActiveObjectsWithEmbeddings(): Promise<any[]> {
  if (_objectCache && Date.now() - _objectCache.ts < OBJECT_CACHE_TTL) {
    return _objectCache.objects;
  }
  const objects = await knowledgeDb.query.objects.findMany({
    where: and(eq(schema.objects.status, 'active'), sql`${schema.objects.embedding} IS NOT NULL`),
  });
  _objectCache = { objects, ts: Date.now() };
  return objects;
}

function cosineSimArrays(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function semanticRecall(queryEmbedding: number[]): Promise<ScoredObject[]> {
  // Client-side similarity: load all objects once, rank by cosine similarity in JS.
  // This avoids sending 16KB vector payloads to Turso which causes latency spikes.
  const allObjects = await getActiveObjectsWithEmbeddings();

  // Compute similarity for each object
  const scored: { obj: any; similarity: number }[] = [];
  for (const obj of allObjects) {
    if (obj.pinned || obj.supersededBy) continue;
    if (!obj.embedding) continue;

    // Decode the stored embedding
    let storedVec: number[];
    try {
      if (Array.isArray(obj.embedding)) {
        storedVec = obj.embedding;
      } else {
        const buf = Buffer.from(obj.embedding as ArrayBuffer);
        storedVec = Array.from(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
      }
    } catch { continue; }

    const similarity = cosineSimArrays(queryEmbedding, storedVec);
    scored.push({ obj, similarity });
  }

  // Sort by similarity descending, take top K
  scored.sort((a, b) => b.similarity - a.similarity);
  const topK = scored.slice(0, KNOWLEDGE_CONFIG.RETRIEVAL_TOP_K);

  const vectorResults = topK.map(s => ({
    id: s.obj.id,
    type: s.obj.type,
    subtype: s.obj.subtype,
    name: s.obj.name,
    properties: s.obj.properties,
    confidence: s.obj.confidence,
    updated_at: s.obj.updatedAt,
    status: s.obj.status,
    superseded_by: s.obj.supersededBy,
    sensitivity: s.obj.sensitivity,
    pinned: s.obj.pinned,
    similarity: s.similarity,
  }));

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
  // Client-side similarity check on dormant objects
  const dormantObjects = await knowledgeDb.query.objects.findMany({
    where: and(eq(schema.objects.status, 'dormant'), sql`${schema.objects.embedding} IS NOT NULL`),
  });

  let reactivated = 0;
  for (const obj of dormantObjects) {
    if (obj.supersededBy || !obj.embedding) continue;
    let storedVec: number[];
    try {
      storedVec = Array.isArray(obj.embedding) ? obj.embedding
        : Array.from(new Float32Array(Buffer.from(obj.embedding as ArrayBuffer).buffer));
    } catch { continue; }

    const similarity = cosineSimArrays(queryEmbedding, storedVec);
    if (similarity >= KNOWLEDGE_CONFIG.REACTIVATION_THRESHOLD) {
      await knowledgeDb.update(schema.objects)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(schema.objects.id, obj.id));
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
