import { describe, it, expect } from 'vitest';
import {
  ObjectTypeEnum, StatusEnum, SourceEnum, LinkTypeEnum,
  ConceptSubtypeEnum, SensitivityEnum, ReferenceOutcomeEnum,
  ExtractedObjectSchema, ExtractedLinkSchema, ExtractedKnowledgeSchema,
  PersonProperties, ConceptProperties, EventProperties,
} from '../src/lib/knowledge/types';
import { canonicalize, buildCanonicalName, buildDedupKey } from '../src/lib/knowledge/aliases';
import { buildEmbeddingText } from '../src/lib/knowledge/embedding';

// =============================================================================
// Zod Schema Validation
// =============================================================================

describe('Knowledge Type Enums', () => {
  it('validates object types', () => {
    expect(ObjectTypeEnum.parse('person')).toBe('person');
    expect(ObjectTypeEnum.parse('concept')).toBe('concept');
    expect(ObjectTypeEnum.parse('event')).toBe('event');
    expect(() => ObjectTypeEnum.parse('invalid')).toThrow();
  });

  it('validates statuses', () => {
    expect(StatusEnum.parse('active')).toBe('active');
    expect(StatusEnum.parse('dormant')).toBe('dormant');
    expect(StatusEnum.parse('absorbed')).toBe('absorbed');
    expect(StatusEnum.parse('deleted')).toBe('deleted');
    expect(() => StatusEnum.parse('archived')).toThrow();
  });

  it('validates sources', () => {
    expect(SourceEnum.parse('seed')).toBe('seed');
    expect(SourceEnum.parse('migrated')).toBe('migrated');
    expect(() => SourceEnum.parse('imported')).toThrow();
  });

  it('validates link types', () => {
    expect(LinkTypeEnum.parse('works_at')).toBe('works_at');
    expect(LinkTypeEnum.parse('absorbed_into')).toBe('absorbed_into');
    expect(() => LinkTypeEnum.parse('belongs_to')).toThrow();
  });

  it('validates concept subtypes', () => {
    expect(ConceptSubtypeEnum.parse('observation')).toBe('observation');
    expect(ConceptSubtypeEnum.parse('identity')).toBe('identity');
    expect(() => ConceptSubtypeEnum.parse('habit')).toThrow();
  });
});

describe('ExtractedObjectSchema', () => {
  it('accepts valid extracted object', () => {
    const obj = {
      type: 'person',
      name: 'Alice',
      properties: { role: 'Manager' },
      confidence: 0.9,
    };
    expect(ExtractedObjectSchema.parse(obj)).toMatchObject(obj);
  });

  it('rejects empty name', () => {
    expect(() => ExtractedObjectSchema.parse({
      type: 'person', name: '', properties: {}, confidence: 0.5,
    })).toThrow();
  });

  it('rejects confidence out of range', () => {
    expect(() => ExtractedObjectSchema.parse({
      type: 'concept', name: 'test', properties: {}, confidence: 1.5,
    })).toThrow();
    expect(() => ExtractedObjectSchema.parse({
      type: 'concept', name: 'test', properties: {}, confidence: -0.1,
    })).toThrow();
  });

  it('accepts optional subtype and sensitivity', () => {
    const obj = {
      type: 'concept',
      name: 'Morning work preference',
      subtype: 'preference',
      properties: { value: 'Prefers deep work before noon' },
      confidence: 0.8,
      sensitivity: 'normal',
    };
    const result = ExtractedObjectSchema.parse(obj);
    expect(result.subtype).toBe('preference');
    expect(result.sensitivity).toBe('normal');
  });
});

describe('ExtractedKnowledgeSchema', () => {
  it('enforces max 5 objects', () => {
    const sixObjects = Array.from({ length: 6 }, (_, i) => ({
      type: 'concept' as const, name: `obj${i}`, properties: {}, confidence: 0.5,
    }));
    expect(() => ExtractedKnowledgeSchema.parse({ objects: sixObjects, links: [] })).toThrow();
  });

  it('enforces max 8 links', () => {
    const nineLinks = Array.from({ length: 9 }, (_, i) => ({
      sourceName: 'a', sourceType: 'person' as const,
      targetName: `b${i}`, targetType: 'project' as const,
      linkType: 'collaborates_on' as const, confidence: 0.5,
    }));
    expect(() => ExtractedKnowledgeSchema.parse({ objects: [], links: nineLinks })).toThrow();
  });

  it('accepts valid extraction', () => {
    const extracted = {
      objects: [
        { type: 'person', name: 'Bob', properties: {}, confidence: 0.8 },
      ],
      links: [
        { sourceName: 'Bob', sourceType: 'person', targetName: 'Acme', targetType: 'organization', linkType: 'works_at', confidence: 0.7 },
      ],
    };
    const result = ExtractedKnowledgeSchema.parse(extracted);
    expect(result.objects).toHaveLength(1);
    expect(result.links).toHaveLength(1);
  });
});

describe('Property schemas', () => {
  it('validates person properties', () => {
    expect(PersonProperties.parse({ role: 'Engineer' })).toMatchObject({ role: 'Engineer' });
    expect(PersonProperties.parse({})).toMatchObject({});
  });

  it('validates concept properties (value required)', () => {
    expect(ConceptProperties.parse({ value: 'test' })).toMatchObject({ value: 'test' });
    expect(() => ConceptProperties.parse({})).toThrow();
  });

  it('validates event properties', () => {
    expect(EventProperties.parse({ date: '2026-04-15', notes: 'Trip' })).toMatchObject({ date: '2026-04-15' });
  });
});

// =============================================================================
// Canonicalization
// =============================================================================

describe('canonicalize', () => {
  it('lowercases', () => {
    expect(canonicalize('Alice Smith')).toBe('alice-smith');
  });

  it('replaces whitespace and underscores with hyphens', () => {
    expect(canonicalize('deep work  preference')).toBe('deep-work-preference');
    expect(canonicalize('some_key_name')).toBe('some-key-name');
  });

  it('strips special characters', () => {
    expect(canonicalize("Cole's Preference!")).toBe('coles-preference');
  });

  it('trims whitespace', () => {
    expect(canonicalize('  hello world  ')).toBe('hello-world');
  });

  it('handles empty string', () => {
    expect(canonicalize('')).toBe('');
  });
});

describe('buildCanonicalName', () => {
  it('lowercases and normalizes whitespace', () => {
    expect(buildCanonicalName('Alice  Smith ')).toBe('alice smith');
  });

  it('preserves more characters than canonicalize', () => {
    expect(buildCanonicalName("Cole's Preference")).toBe("cole's preference");
  });
});

// =============================================================================
// Dedup Key Construction
// =============================================================================

describe('buildDedupKey', () => {
  it('builds person key with org', () => {
    const key = buildDedupKey('person', { name: 'Alice', properties: { organization: 'Acme Corp' } });
    expect(key).toBe('person:alice:acme-corp');
  });

  it('builds person key without org', () => {
    const key = buildDedupKey('person', { name: 'Bob', properties: {} });
    expect(key).toBe('person:bob:unknown');
  });

  it('builds concept key with subtype', () => {
    const key = buildDedupKey('concept', { name: 'Morning focus', subtype: 'preference', properties: { key: 'Morning focus' } });
    expect(key).toBe('concept:preference:morning-focus');
  });

  it('builds concept key falling back to name', () => {
    const key = buildDedupKey('concept', { name: 'Something', subtype: 'fact', properties: {} });
    expect(key).toBe('concept:fact:something');
  });

  it('builds concept key with default subtype', () => {
    const key = buildDedupKey('concept', { name: 'test', properties: {} });
    expect(key).toBe('concept:other:test');
  });

  it('builds project key with todoistId', () => {
    const key = buildDedupKey('project', { name: 'My Project', properties: { todoistId: '12345' } });
    expect(key).toBe('project:todoist:12345');
  });

  it('builds project key without todoistId', () => {
    const key = buildDedupKey('project', { name: 'My Project', properties: {} });
    expect(key).toBe('project:my-project');
  });

  it('builds event key with date', () => {
    const key = buildDedupKey('event', { name: 'Team Offsite', properties: { date: '2026-05-01' } });
    expect(key).toBe('event:team-offsite:2026-05-01');
  });

  it('builds event key without date', () => {
    const key = buildDedupKey('event', { name: 'Someday Meeting', properties: {} });
    expect(key).toBe('event:someday-meeting:undated');
  });

  it('builds organization key', () => {
    const key = buildDedupKey('organization', { name: 'Microsoft', properties: {} });
    expect(key).toBe('org:microsoft');
  });
});

// =============================================================================
// Embedding Text Construction
// =============================================================================

describe('buildEmbeddingText', () => {
  it('includes type, name, and value', () => {
    const text = buildEmbeddingText({
      type: 'concept',
      name: 'Morning preference',
      properties: { value: 'Prefers deep work before noon' },
    });
    expect(text).toBe('concept: Morning preference — Prefers deep work before noon');
  });

  it('falls back to contextNotes', () => {
    const text = buildEmbeddingText({
      type: 'person',
      name: 'Alice',
      properties: { contextNotes: 'Works on security team' },
    });
    expect(text).toBe('person: Alice — Works on security team');
  });

  it('falls back to goal', () => {
    const text = buildEmbeddingText({
      type: 'project',
      name: 'Switchboard',
      properties: { goal: 'Build API gateway' },
    });
    expect(text).toBe('project: Switchboard — Build API gateway');
  });

  it('handles no detail gracefully', () => {
    const text = buildEmbeddingText({
      type: 'organization',
      name: 'Acme',
      properties: {},
    });
    expect(text).toBe('organization: Acme');
  });
});
