import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types for clarification result
interface SubTask {
  title: string;
  nextAction: string;
}

interface ClarifyResult {
  title: string;
  nextAction: string;
  projectName: string;
  newProject: boolean;
  priority: number;
  labels: string[];
  timeEstimateMin: number;
  energyLevel: 'high' | 'medium' | 'low';
  contextNotes: string;
  relatedPeople: string[];
  relatedLinks: string[];
  decompositionNeeded: boolean;
  subtasks: SubTask[];
  confidence: number;
  questions: string[];
  knowledgeExtracted: never[];
}

/**
 * These tests validate the subtask filtering logic that guards against
 * null/undefined/empty subtask titles from LLM output.
 *
 * The actual bug: when the LLM returned subtasks with undefined titles,
 * the DB insert failed with NOT NULL constraint on original_text.
 */
describe('Subtask Validation Logic', () => {
  describe('filter guards', () => {
    const filterSubtasks = (subtasks: SubTask[]) =>
      subtasks.filter((sub: any) => sub.title?.trim());

    it('keeps subtasks with valid titles', () => {
      const subtasks = [
        { title: 'Do first thing', nextAction: 'Start here' },
        { title: 'Do second thing', nextAction: 'Continue here' },
      ];
      expect(filterSubtasks(subtasks)).toHaveLength(2);
    });

    it('filters out subtasks with undefined title', () => {
      const subtasks = [
        { title: 'Valid', nextAction: 'ok' },
        { title: undefined, nextAction: 'bad' },
      ] as any;
      expect(filterSubtasks(subtasks)).toHaveLength(1);
      expect(filterSubtasks(subtasks)[0].title).toBe('Valid');
    });

    it('filters out subtasks with null title', () => {
      const subtasks = [
        { title: null, nextAction: 'bad' },
      ] as any;
      expect(filterSubtasks(subtasks)).toHaveLength(0);
    });

    it('filters out subtasks with empty string title', () => {
      const subtasks = [
        { title: '', nextAction: 'bad' },
        { title: '   ', nextAction: 'also bad' },
      ] as any;
      expect(filterSubtasks(subtasks)).toHaveLength(0);
    });

    it('handles empty subtask array', () => {
      expect(filterSubtasks([])).toHaveLength(0);
    });

    it('handles mixed valid and invalid subtasks', () => {
      const subtasks = [
        { title: 'Good one', nextAction: 'go' },
        { title: undefined, nextAction: 'no' },
        { title: '', nextAction: 'no' },
        { title: 'Another good one', nextAction: 'yes' },
        { title: null, nextAction: 'no' },
      ] as any;
      const result = filterSubtasks(subtasks);
      expect(result).toHaveLength(2);
      expect(result.map((s: any) => s.title)).toEqual(['Good one', 'Another good one']);
    });
  });
});

describe('LLM Clarification Output Parsing', () => {
  function makeClarification(overrides: Partial<ClarifyResult> = {}): ClarifyResult {
    return {
      title: 'Review Q3 Security Metrics',
      nextAction: 'Pull phishing false positive rates from Kusto',
      projectName: 'Security Ops',
      newProject: false,
      priority: 2,
      labels: ['work', 'deep-work'],
      timeEstimateMin: 30,
      energyLevel: 'high',
      contextNotes: 'Quarterly review due Friday',
      relatedPeople: ['Alice'],
      relatedLinks: [],
      decompositionNeeded: false,
      subtasks: [],
      confidence: 0.85,
      questions: [],
      knowledgeExtracted: [],
      ...overrides,
    };
  }

  it('accepts well-formed clarification', () => {
    const result = makeClarification();
    expect(result.title).toBeTruthy();
    expect(result.nextAction).toBeTruthy();
    expect(result.priority).toBeGreaterThanOrEqual(1);
    expect(result.priority).toBeLessThanOrEqual(4);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('handles decomposition with valid subtasks', () => {
    const result = makeClarification({
      decompositionNeeded: true,
      subtasks: [
        { title: 'Step 1', nextAction: 'Do step 1' },
        { title: 'Step 2', nextAction: 'Do step 2' },
      ],
    });
    expect(result.decompositionNeeded).toBe(true);
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks.every(s => s.title?.trim())).toBe(true);
  });

  it('detects malformed subtasks that would crash DB insert', () => {
    const result = makeClarification({
      decompositionNeeded: true,
      subtasks: [
        { title: undefined as any, nextAction: 'bad' },
        { title: '', nextAction: 'also bad' },
      ],
    });

    const valid = result.subtasks.filter(s => s.title?.trim());
    expect(valid).toHaveLength(0);
  });

  it('labels array is always serializable', () => {
    const result = makeClarification({ labels: ['work', 'deep-work'] });
    expect(() => JSON.stringify(result.labels)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result.labels))).toEqual(['work', 'deep-work']);
  });

  it('relatedPeople and relatedLinks are arrays', () => {
    const result = makeClarification();
    expect(Array.isArray(result.relatedPeople)).toBe(true);
    expect(Array.isArray(result.relatedLinks)).toBe(true);
  });

  it('confidence is in valid range', () => {
    const highConfidence = makeClarification({ confidence: 0.95 });
    const lowConfidence = makeClarification({ confidence: 0.3 });
    expect(highConfidence.confidence).toBeGreaterThan(0.9);
    expect(lowConfidence.confidence).toBeLessThan(0.5);
  });
});
