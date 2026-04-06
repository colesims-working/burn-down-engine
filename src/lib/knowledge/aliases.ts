/**
 * Knowledge System — Alias Resolution & Name Canonicalization
 *
 * Dedup keys use canonical forms. Aliases map variant names to objects.
 * Never use `name` for uniqueness — always `UNIQUE(type, dedup_key)`.
 */

import { knowledgeDb, schema } from './db';
import { eq } from 'drizzle-orm';
import type { ExtractedObject, ObjectType } from './types';

// ─── Canonicalization ───────────────────────────────────────

/**
 * Canonicalize a string for use in dedup keys.
 * Lowercase, trim, replace whitespace/underscores with hyphens, strip non-alphanumeric.
 */
export function canonicalize(s: string): string {
  return s.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Build a canonical name for display lookups.
 * Lowercase and whitespace-normalized, but preserves more characters than canonicalize.
 */
export function buildCanonicalName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── Dedup Key Construction ─────────────────────────────────

/**
 * Build a stable dedup key for an object.
 * Used for UNIQUE(type, dedup_key) constraint.
 */
export function buildDedupKey(type: ObjectType, obj: {
  name: string;
  subtype?: string;
  properties: Record<string, unknown>;
}): string {
  switch (type) {
    case 'person':
      return `person:${canonicalize(obj.name)}:${canonicalize((obj.properties.organization as string) || 'unknown')}`;
    case 'concept':
      return `concept:${obj.subtype || 'other'}:${canonicalize((obj.properties.key as string) || obj.name)}`;
    case 'project':
      return (obj.properties.todoistId as string)
        ? `project:todoist:${obj.properties.todoistId}`
        : `project:${canonicalize(obj.name)}`;
    case 'event':
      return `event:${canonicalize(obj.name)}:${(obj.properties.date as string) || 'undated'}`;
    case 'organization':
      return `org:${canonicalize(obj.name)}`;
    default:
      return `${type}:${canonicalize(obj.name)}`;
  }
}

// ─── Alias Resolution ───────────────────────────────────────

/**
 * Look up an object ID by canonical alias.
 * Returns the object ID if an alias match is found, null otherwise.
 */
export async function resolveAlias(alias: string): Promise<string | null> {
  const canonical = canonicalize(alias);
  const match = await knowledgeDb.query.objectAliases.findFirst({
    where: eq(schema.objectAliases.canonicalAlias, canonical),
  });
  return match?.objectId ?? null;
}

/**
 * Create an alias for an object if it doesn't already exist.
 */
export async function createAlias(objectId: string, alias: string): Promise<void> {
  const canonical = canonicalize(alias);
  try {
    await knowledgeDb.insert(schema.objectAliases).values({
      objectId,
      alias,
      canonicalAlias: canonical,
    });
  } catch {
    // UNIQUE constraint violation — alias already exists, skip
  }
}
