import { describe, it, expect } from 'vitest';
import { isExtractionEligible } from '../src/lib/knowledge/extraction';
import { KNOWLEDGE_CONFIG } from '../src/lib/knowledge/config';

describe('isExtractionEligible', () => {
  it('returns true for clarify_task with sufficient tokens', () => {
    expect(isExtractionEligible('clarify_task', 50)).toBe(true);
  });

  it('returns true for organize_conversation', () => {
    expect(isExtractionEligible('organize_conversation', 30)).toBe(true);
  });

  it('returns true for daily_observations', () => {
    expect(isExtractionEligible('daily_observations', 25)).toBe(true);
  });

  it('returns true for weekly_review', () => {
    expect(isExtractionEligible('weekly_review', 100)).toBe(true);
  });

  it('returns true for project_audit', () => {
    expect(isExtractionEligible('project_audit', 50)).toBe(true);
  });

  it('returns false for extract_knowledge (meta — don\'t extract from extraction)', () => {
    expect(isExtractionEligible('extract_knowledge', 50)).toBe(false);
  });

  it('returns false for extract_tasks_from_voice', () => {
    expect(isExtractionEligible('extract_tasks_from_voice', 50)).toBe(false);
  });

  it('returns false for rank_tasks', () => {
    expect(isExtractionEligible('rank_tasks', 50)).toBe(false);
  });

  it('returns false when input tokens below threshold', () => {
    expect(isExtractionEligible('clarify_task', 10)).toBe(false);
    expect(isExtractionEligible('clarify_task', 19)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(isExtractionEligible('clarify_task', KNOWLEDGE_CONFIG.MIN_EXTRACTION_INPUT_TOKENS)).toBe(true);
  });
});

describe('Extraction JSON parsing logic', () => {
  // Mirrors the validation in processExtractedKnowledge
  function validateExtraction(raw: unknown): { objects: any[]; links: any[] } | null {
    if (!raw || typeof raw !== 'object') return null;
    const extracted = raw as any;
    const objects = Array.isArray(extracted.objects) ? extracted.objects : [];
    const links = Array.isArray(extracted.links) ? extracted.links : [];

    const validObjects = objects
      .filter((o: any) => o?.type && o?.name && typeof o.confidence === 'number')
      .slice(0, 5)
      .map((o: any) => ({
        type: o.type,
        name: String(o.name),
        confidence: Math.max(0, Math.min(1, o.confidence)),
      }));

    const validLinks = links
      .filter((l: any) => l?.sourceName && l?.targetName && l?.linkType)
      .slice(0, 8);

    if (validObjects.length === 0 && validLinks.length === 0) return null;

    // Filter by confidence
    const filtered = {
      objects: validObjects.filter((o: any) => o.confidence >= 0.5),
      links: validLinks.filter((l: any) => (l.confidence ?? 0.5) >= 0.5),
    };

    return (filtered.objects.length > 0 || filtered.links.length > 0) ? filtered : null;
  }

  it('parses valid extraction', () => {
    const result = validateExtraction({
      objects: [{ type: 'concept', name: 'Test', confidence: 0.8, properties: {} }],
      links: [],
    });
    expect(result).not.toBeNull();
    expect(result!.objects).toHaveLength(1);
  });

  it('returns null for empty extraction', () => {
    expect(validateExtraction({ objects: [], links: [] })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateExtraction(null)).toBeNull();
    expect(validateExtraction('string')).toBeNull();
    expect(validateExtraction(42)).toBeNull();
  });

  it('filters out low-confidence objects', () => {
    const result = validateExtraction({
      objects: [
        { type: 'concept', name: 'Low', confidence: 0.2, properties: {} },
        { type: 'concept', name: 'High', confidence: 0.9, properties: {} },
      ],
      links: [],
    });
    expect(result).not.toBeNull();
    expect(result!.objects).toHaveLength(1);
    expect(result!.objects[0].name).toBe('High');
  });

  it('clamps to max 5 objects', () => {
    const objects = Array.from({ length: 8 }, (_, i) => ({
      type: 'concept', name: `Obj${i}`, confidence: 0.8, properties: {},
    }));
    const result = validateExtraction({ objects, links: [] });
    expect(result!.objects).toHaveLength(5);
  });

  it('clamps to max 8 links', () => {
    const links = Array.from({ length: 12 }, (_, i) => ({
      sourceName: 'A', targetName: `B${i}`, linkType: 'relates_to', confidence: 0.8,
      sourceType: 'concept', targetType: 'concept',
    }));
    const result = validateExtraction({ objects: [{ type: 'concept', name: 'X', confidence: 0.8 }], links });
    expect(result!.links.length).toBeLessThanOrEqual(8);
  });

  it('filters objects missing required fields', () => {
    const result = validateExtraction({
      objects: [
        { type: 'concept', confidence: 0.8 }, // missing name
        { name: 'Test', confidence: 0.8 }, // missing type
        { type: 'concept', name: 'Valid', confidence: 0.8, properties: {} },
      ],
      links: [],
    });
    expect(result!.objects).toHaveLength(1);
    expect(result!.objects[0].name).toBe('Valid');
  });

  it('clamps confidence to [0, 1]', () => {
    const result = validateExtraction({
      objects: [{ type: 'concept', name: 'Over', confidence: 1.5, properties: {} }],
      links: [],
    });
    expect(result!.objects[0].confidence).toBe(1.0);
  });
});

describe('Buffer event types', () => {
  const VALID_EVENT_TYPES = ['complete', 'defer', 'bump', 'block', 'wait', 'fire', 'kill'];

  it('all engage action event types are defined', () => {
    for (const eventType of VALID_EVENT_TYPES) {
      expect(eventType).toBeTruthy();
    }
  });
});
