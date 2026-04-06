/**
 * Knowledge System — TypeScript Types & Zod Schemas
 *
 * Canonical type definitions for the knowledge graph.
 * All code in src/lib/knowledge/ must use these types.
 *
 * Spec: KNOWLEDGE_SYSTEM_SPEC_v1.2.md
 */

import { z } from 'zod';

// =============================================================================
// ENUMS
// =============================================================================

export const ObjectTypeEnum = z.enum(['person', 'project', 'organization', 'concept', 'event']);
export type ObjectType = z.infer<typeof ObjectTypeEnum>;

export const StatusEnum = z.enum(['active', 'dormant', 'absorbed', 'deleted']);
export type Status = z.infer<typeof StatusEnum>;

export const SourceEnum = z.enum(['seed', 'manual', 'extracted', 'consolidated', 'migrated']);
export type Source = z.infer<typeof SourceEnum>;

export const SensitivityEnum = z.enum(['normal', 'sensitive']);
export type Sensitivity = z.infer<typeof SensitivityEnum>;

export const LinkTypeEnum = z.enum([
  'works_at', 'reports_to', 'collaborates_on', 'owns',
  'applies_to', 'about', 'involves', 'relates_to',
  'depends_on', 'part_of', 'supersedes', 'contradicts',
  'absorbed_into', 'associated',
]);
export type LinkType = z.infer<typeof LinkTypeEnum>;

export const ConceptSubtypeEnum = z.enum([
  'identity', 'priority', 'preference', 'pattern', 'schedule',
  'decision', 'fact', 'workflow', 'observation',
]);
export type ConceptSubtype = z.infer<typeof ConceptSubtypeEnum>;

export const ReferenceOutcomeEnum = z.enum(['pending', 'positive', 'negative', 'neutral']);
export type ReferenceOutcome = z.infer<typeof ReferenceOutcomeEnum>;

export const SourceContextEnum = z.enum([
  'clarify', 'organize', 'reflect', 'engage',
  'capture', 'complete', 'review', 'buffer_flush',
]);
export type SourceContext = z.infer<typeof SourceContextEnum>;

export const PageContextEnum = z.enum(['clarify', 'organize', 'engage', 'reflect']);
export type PageContext = z.infer<typeof PageContextEnum>;

export const ReviewTypeEnum = z.enum([
  'protected_update', 'conflict', 'merge_candidate', 'synthesis_candidate',
]);
export type ReviewType = z.infer<typeof ReviewTypeEnum>;

export const EvidenceTypeEnum = z.enum([
  'extraction', 'manual_edit', 'migration', 'consolidation',
]);
export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;

// =============================================================================
// TYPE-SPECIFIC PROPERTY SCHEMAS
// =============================================================================

export const PersonProperties = z.object({
  role: z.string().optional(),
  contextNotes: z.string().optional(),
  relatedProjects: z.array(z.string()).optional(),
});
export type PersonPropertiesType = z.infer<typeof PersonProperties>;

export const ProjectProperties = z.object({
  todoistId: z.string().optional(),
  goal: z.string().optional(),
  notes: z.string().optional(),
});
export type ProjectPropertiesType = z.infer<typeof ProjectProperties>;

export const OrganizationProperties = z.object({
  domain: z.string().optional(),
  notes: z.string().optional(),
});
export type OrganizationPropertiesType = z.infer<typeof OrganizationProperties>;

export const ConceptProperties = z.object({
  key: z.string().optional(),
  value: z.string(),
  synthesis_sources: z.number().optional(),
  legacy_reference_count: z.number().optional(),
});
export type ConceptPropertiesType = z.infer<typeof ConceptProperties>;

export const EventProperties = z.object({
  date: z.string().optional(),
  notes: z.string().optional(),
});
export type EventPropertiesType = z.infer<typeof EventProperties>;

// =============================================================================
// CORE ENTITY INTERFACES
// =============================================================================

export interface KnowledgeObject {
  id: string;
  type: ObjectType;
  subtype?: string;
  name: string;
  canonicalName: string;
  dedupKey: string;
  properties: Record<string, unknown>;
  status: Status;
  pinned: boolean;
  pinnedAt?: string;
  confidence: number;
  source: Source;
  sourceContext?: string;
  sensitivity: Sensitivity;
  supersededBy?: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeLink {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: LinkType;
  properties: Record<string, unknown>;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectReference {
  id: string;
  objectId: string;
  interactionId?: string;
  context: string;
  outcome: ReferenceOutcome;
  referencedAt: string;
}

export interface ObjectAlias {
  id: string;
  objectId: string;
  alias: string;
  canonicalAlias: string;
  createdAt: string;
}

export interface ObjectEvidence {
  id: string;
  objectId: string;
  interactionId?: string;
  taskId?: string;
  sourceContext: string;
  evidenceType: EvidenceType;
  snippet?: string;
  confidence?: number;
  createdAt: string;
}

export interface ReviewQueueItem {
  id: string;
  objectId?: string;
  reviewType: ReviewType;
  proposedData: Record<string, unknown>;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface ConsolidationRun {
  id: string;
  scope: 'full' | 'active_only';
  startedAt: string;
  completedAt?: string;
  dormancyTransitions: number;
  reactivations: number;
  mergesPerformed: number;
  synthesesCreated: number;
  objectsAbsorbed: number;
  referencesPurged: number;
  status: 'running' | 'completed' | 'failed' | 'reverted';
  errorLog?: string[];
}

export interface ExtractionBufferEntry {
  id: string;
  eventType: string;
  taskId?: string;
  taskTitle?: string;
  taskContext?: Record<string, unknown>;
  createdAt: string;
  processed: boolean;
  processedAt?: string;
  attemptCount: number;
  lastError?: string;
  lockedAt?: string;
}

// =============================================================================
// EXTRACTION SCHEMAS (LLM output parsing)
// =============================================================================

export const ExtractedObjectSchema = z.object({
  type: ObjectTypeEnum,
  name: z.string().min(1),
  subtype: z.string().optional(),
  properties: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
  sensitivity: SensitivityEnum.optional(),
});
export type ExtractedObject = z.infer<typeof ExtractedObjectSchema>;

export const ExtractedLinkSchema = z.object({
  sourceName: z.string().min(1),
  sourceType: ObjectTypeEnum,
  targetName: z.string().min(1),
  targetType: ObjectTypeEnum,
  linkType: LinkTypeEnum,
  confidence: z.number().min(0).max(1),
});
export type ExtractedLink = z.infer<typeof ExtractedLinkSchema>;

export const ExtractedKnowledgeSchema = z.object({
  objects: z.array(ExtractedObjectSchema).max(5),
  links: z.array(ExtractedLinkSchema).max(8),
});
export type ExtractedKnowledge = z.infer<typeof ExtractedKnowledgeSchema>;

// =============================================================================
// FUNCTION INTERFACES
// =============================================================================

export interface BuildContextQuery {
  text: string;
  page: PageContext;
  projectId?: string;
  taskId?: string;
  relatedObjectIds?: string[];
  mentionedNames?: string[];
  dueAt?: string;
  labels?: string[];
  tokenBudget?: number;
  includeGlobal?: boolean;
}

export interface PromptContext {
  globalContext: string;
  retrievedContext: string;
  referencedObjectIds: string[];
  interactionId: string;
  tokenCount: number;
  debugInfo?: {
    vectorResults: number;
    reactivations: number;
    graphExpansionResults: number;
    totalCandidates: number;
    budgetUtilization: number;
    coldStartMode: boolean;
  };
}

export interface UpsertResult {
  objectsCreated: number;
  objectsUpdated: number;
  objectsSkipped: number;
  linksCreated: number;
  linksSkipped: number;
  stubsCreated: number;
  reviewQueueItems: number;
  errors: string[];
}

export interface MigrationResult {
  objectsMigrated: number;
  peopleMigrated: number;
  linksMigrated: number;
  embeddingsGenerated: number;
  errors: string[];
}

export interface ConsolidationResult {
  runId: string;
  dormancyTransitions: number;
  reactivations: number;
  mergesPerformed: number;
  synthesesCreated: number;
  objectsAbsorbed: number;
  referencesPurged: number;
  errors: string[];
}
