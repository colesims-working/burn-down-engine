/**
 * Knowledge System — Tunable Configuration
 *
 * All magic numbers live here. Import KNOWLEDGE_CONFIG for values.
 * See KNOWLEDGE_SYSTEM_SPEC_v1.2.md for rationale behind each parameter.
 */

import type { ConceptSubtype, PageContext } from './types';

export const KNOWLEDGE_CONFIG = {
  // Retrieval
  RETRIEVAL_TOP_K: 20,
  RETRIEVAL_K_INFLATION: 1.5,
  RETRIEVAL_HALF_LIFE_DAYS: 30,
  GLOBAL_CONTEXT_TOKEN_BUDGET: 500,
  RETRIEVED_CONTEXT_TOKEN_BUDGET: 1500,
  REACTIVATION_THRESHOLD: 0.90,
  SENSITIVE_SIMILARITY_THRESHOLD: 0.85,
  PAGE_BOOST_MULTIPLIER: 1.15,
  EXACT_MATCH_BOOST: 0.20,

  // Graph expansion
  MAX_1HOP_PER_SEED: 5,
  MAX_2HOP_PER_SEED: 3,
  MAX_GRAPH_EXPANSION_TOTAL: 50,

  // Extraction
  MIN_EXTRACTION_CONFIDENCE: 0.5,
  MIN_EXTRACTION_INPUT_TOKENS: 20,
  MAX_EXTRACTED_OBJECTS: 5,
  MAX_EXTRACTED_LINKS: 8,
  BUFFER_FLUSH_THRESHOLD: 15,
  BUFFER_FLUSH_BATCH_SIZE: 25,
  BUFFER_MAX_ATTEMPTS: 3,

  // Consolidation
  CONSOLIDATION_HALF_LIFE_DAYS: 60,
  DORMANT_THRESHOLD: 0.15,
  SYNTHESIS_THRESHOLD: 0.30,
  DEDUP_SIMILARITY_THRESHOLD: 0.92,
  SYNTHESIS_MIN_CLUSTER_SIZE: 3,
  SYNTHESIS_CLUSTER_SIMILARITY: 0.75,
  REINFORCEMENT_STEP: 0.02,
  ACTIVE_OBJECT_BUDGET: 300,
  REFERENCE_RETENTION_DAYS: 180,

  // Embedding
  EMBEDDING_MODEL: 'qwen/qwen3-embedding-8b',
  EMBEDDING_DIMENSIONS: 4096,
  EMBEDDING_BATCH_SIZE: 50,
  EMBEDDING_RATE_LIMIT_PER_MIN: 100,

  // Token counting
  TOKEN_COUNTING_METHOD: 'estimate' as const,

  // Cold start
  COLD_START_THRESHOLD: 30,
} as const;

// Page-specific subtype boosts (multiplicative)
export const PAGE_BOOSTS: Record<PageContext, ConceptSubtype[]> = {
  clarify: ['preference', 'pattern', 'decision', 'workflow'],
  organize: ['preference', 'workflow'],
  engage: ['pattern', 'schedule'],
  reflect: ['pattern', 'observation'],
};

// Concept subtypes that are auto-pinned on creation
export const AUTO_PIN_SUBTYPES: ConceptSubtype[] = ['identity', 'priority'];

// Link types traversed during retrieval graph expansion
export const EXPANSION_ALLOWLIST = [
  'works_at', 'reports_to', 'collaborates_on', 'owns',
  'applies_to', 'about', 'involves', 'relates_to',
  'depends_on', 'supersedes', 'part_of',
] as const;

// Embedding task instructions for query-side prefix
export const EMBEDDING_INSTRUCTIONS = {
  retrieval: 'Given a task description, retrieve relevant personal knowledge, preferences, and context about the user',
  deduplication: 'Identify semantically duplicate or near-duplicate knowledge entries',
  clustering: 'Group related behavioral observations and patterns for consolidation',
} as const;
