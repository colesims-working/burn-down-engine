/**
 * Knowledge System — Scoring Functions
 *
 * Pure functions for retrieval ranking and salience computation.
 * No DB calls — all inputs are pre-fetched values.
 *
 * See SKILL.md "Retrieval Pipeline" and "Consolidation Engine" for formulas.
 */

import { KNOWLEDGE_CONFIG, PAGE_BOOSTS } from './config';
import type { PageContext, ConceptSubtype } from './types';

// ─── Retrieval Score ────────────────────────────────────────

export interface RetrievalScoreInputs {
  vectorSimilarity: number; // 0–1, from vector_top_k distance
  linkProximity: number;    // 0–1, based on graph hops (0 = no graph connection)
  recencyWeight: number;    // 0–1, exponential decay from updatedAt
  referenceDensity: number; // 0–1, normalized reference count
  temporalRelevance?: number; // 0–1, for events/schedules only
  isEvent: boolean;
}

/**
 * Compute the retrieval score for ranking objects in context assembly.
 *
 * Non-events: similarity(0.35) + proximity(0.25) + recency(0.20) + refs(0.20)
 * Events:     similarity(0.30) + proximity(0.20) + temporal(0.25) + recency(0.10) + refs(0.15)
 */
export function computeRetrievalScore(inputs: RetrievalScoreInputs): number {
  if (inputs.isEvent) {
    return (
      inputs.vectorSimilarity * 0.30 +
      inputs.linkProximity * 0.20 +
      (inputs.temporalRelevance ?? 0) * 0.25 +
      inputs.recencyWeight * 0.10 +
      inputs.referenceDensity * 0.15
    );
  }

  return (
    inputs.vectorSimilarity * 0.35 +
    inputs.linkProximity * 0.25 +
    inputs.recencyWeight * 0.20 +
    inputs.referenceDensity * 0.20
  );
}

// ─── Component Computations ─────────────────────────────────

/**
 * Compute recency weight using exponential decay.
 * Half-life is configurable (default 30 days).
 */
export function computeRecencyWeight(updatedAt: string | null, halfLifeDays?: number): number {
  if (!updatedAt) return 0.1;
  const days = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  const hl = halfLifeDays ?? KNOWLEDGE_CONFIG.RETRIEVAL_HALF_LIFE_DAYS;
  return Math.exp((-days * Math.LN2) / hl);
}

/**
 * Compute reference density: normalized count of references in last 90 days.
 * Capped at 1.0 (10+ references = max density).
 */
export function computeReferenceDensity(refsLast90Days: number): number {
  return Math.min(1.0, refsLast90Days / 10);
}

/**
 * Compute temporal relevance for events/schedules.
 * Peaks at event date, decays symmetrically before and after.
 */
export function computeTemporalRelevance(eventDate: string | null): number {
  if (!eventDate) return 0;
  const now = Date.now();
  const event = new Date(eventDate).getTime();
  const daysDiff = Math.abs(now - event) / (1000 * 60 * 60 * 24);

  // Peak relevance within 3 days, decays over 30 days
  if (daysDiff <= 3) return 1.0;
  if (daysDiff >= 30) return 0.05;
  return 1.0 - (daysDiff - 3) / 27 * 0.95;
}

/**
 * Compute graph-expanded object score from its seed's similarity.
 * hop_penalty: 0.85 (1-hop), 0.60 (2-hop)
 */
export function computeGraphScore(
  seedSimilarity: number,
  edgeConfidence: number,
  hops: 1 | 2,
): number {
  const penalty = hops === 1 ? 0.85 : 0.60;
  return seedSimilarity * edgeConfidence * penalty;
}

// ─── Page Boosts ────────────────────────────────────────────

/**
 * Apply multiplicative page boost if the object's subtype matches.
 */
export function applyPageBoost(
  score: number,
  subtype: string | null | undefined,
  page: PageContext,
): number {
  if (!subtype) return score;
  const boosted = PAGE_BOOSTS[page] ?? [];
  if (boosted.includes(subtype as ConceptSubtype)) {
    return score * KNOWLEDGE_CONFIG.PAGE_BOOST_MULTIPLIER;
  }
  return score;
}

// ─── Salience Score (lifecycle, not retrieval) ──────────────

/**
 * Query-independent salience score for consolidation lifecycle decisions.
 * salience = confidence * exp(-days_since_last_activity / 60) * min(1.0, refs_last_90_days / 10)
 */
export function computeSalience(
  confidence: number,
  daysSinceLastActivity: number,
  refsLast90Days: number,
): number {
  const decay = Math.exp(-daysSinceLastActivity / KNOWLEDGE_CONFIG.CONSOLIDATION_HALF_LIFE_DAYS);
  const refFactor = Math.min(1.0, refsLast90Days / 10);
  return confidence * decay * refFactor;
}

// ─── Token Estimation ───────────────────────────────────────

/**
 * Estimate token count for a string (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format a knowledge object for prompt injection.
 */
export function formatObjectForPrompt(obj: {
  type: string;
  name: string;
  subtype?: string | null;
  properties: string;
  confidence?: number | null;
}): string {
  const props = JSON.parse(obj.properties || '{}');
  const parts: string[] = [];

  // Type badge
  const badge = obj.subtype ? `[${obj.type}/${obj.subtype}]` : `[${obj.type}]`;
  parts.push(`${badge} **${obj.name}**`);

  // Key properties based on type
  if (props.value) parts.push(props.value);
  else if (props.contextNotes) parts.push(props.contextNotes);
  else if (props.goal) parts.push(`Goal: ${props.goal}`);
  else if (props.role) parts.push(`Role: ${props.role}`);
  if (props.notes) parts.push(props.notes);
  if (props.date) parts.push(`Date: ${props.date}`);

  return parts.join(' — ');
}
