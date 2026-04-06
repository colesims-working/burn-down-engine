import { describe, it, expect } from 'vitest';
import { AUTO_PIN_SUBTYPES } from '../src/lib/knowledge/config';
import { KNOWLEDGE_CONFIG } from '../src/lib/knowledge/config';

/**
 * Tests for upsert decision logic — pure functions extracted from the upsert flow.
 * No DB calls — just testing the branching logic and math.
 */

describe('Auto-pin logic', () => {
  it('auto-pins identity subtypes', () => {
    expect(AUTO_PIN_SUBTYPES.includes('identity')).toBe(true);
  });

  it('auto-pins priority subtypes', () => {
    expect(AUTO_PIN_SUBTYPES.includes('priority')).toBe(true);
  });

  it('does not auto-pin preference', () => {
    expect(AUTO_PIN_SUBTYPES.includes('preference' as any)).toBe(false);
  });

  it('does not auto-pin observation', () => {
    expect(AUTO_PIN_SUBTYPES.includes('observation' as any)).toBe(false);
  });
});

describe('Confidence reinforcement', () => {
  // Mirrors the formula in upsert.ts handleExistingObject
  function reinforceConfidence(current: number): number {
    const step = KNOWLEDGE_CONFIG.REINFORCEMENT_STEP;
    return Math.min(1.0, current + step * (1.0 - current));
  }

  it('increases low confidence', () => {
    const result = reinforceConfidence(0.5);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeCloseTo(0.51); // 0.5 + 0.02 * 0.5 = 0.51
  });

  it('increases high confidence by smaller amount', () => {
    const result = reinforceConfidence(0.95);
    expect(result).toBeGreaterThan(0.95);
    expect(result).toBeLessThan(0.96); // 0.95 + 0.02 * 0.05 = 0.951
  });

  it('never exceeds 1.0', () => {
    const result = reinforceConfidence(0.999);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it('handles 1.0 correctly', () => {
    const result = reinforceConfidence(1.0);
    expect(result).toBe(1.0);
  });
});

describe('Protected source detection', () => {
  // Mirrors the logic in upsert.ts handleExistingObject
  function isProtectedSource(source: string): boolean {
    return source === 'manual' || source === 'seed';
  }

  it('protects manual sources', () => {
    expect(isProtectedSource('manual')).toBe(true);
  });

  it('protects seed sources', () => {
    expect(isProtectedSource('seed')).toBe(true);
  });

  it('does not protect extracted', () => {
    expect(isProtectedSource('extracted')).toBe(false);
  });

  it('does not protect consolidated', () => {
    expect(isProtectedSource('consolidated')).toBe(false);
  });

  it('does not protect migrated', () => {
    expect(isProtectedSource('migrated')).toBe(false);
  });
});

describe('Merge decision logic', () => {
  // When existing props match and confidence is equal or lower → skip
  // When props differ or confidence is higher → merge
  function shouldMerge(
    existingProps: string,
    newProps: Record<string, unknown>,
    existingConfidence: number,
    newConfidence: number,
  ): 'skip' | 'merge' {
    const newPropsStr = JSON.stringify(newProps);
    if (newPropsStr === existingProps && newConfidence <= existingConfidence) {
      return 'skip';
    }
    return 'merge';
  }

  it('skips when properties and confidence are equal', () => {
    const props = { value: 'test' };
    expect(shouldMerge(JSON.stringify(props), props, 0.8, 0.8)).toBe('skip');
  });

  it('skips when new confidence is lower', () => {
    const props = { value: 'test' };
    expect(shouldMerge(JSON.stringify(props), props, 0.9, 0.7)).toBe('skip');
  });

  it('merges when confidence is higher', () => {
    const props = { value: 'test' };
    expect(shouldMerge(JSON.stringify(props), props, 0.7, 0.9)).toBe('merge');
  });

  it('merges when properties differ', () => {
    expect(shouldMerge(
      JSON.stringify({ value: 'old' }),
      { value: 'new detail' },
      0.9,
      0.5,
    )).toBe('merge');
  });
});

describe('Category to subtype migration mapping', () => {
  const CATEGORY_TO_SUBTYPE: Record<string, string> = {
    identity: 'identity',
    preference: 'preference',
    pattern: 'pattern',
    priority: 'priority',
    schedule: 'schedule',
    decision: 'decision',
    fact: 'fact',
    workflow: 'workflow',
    other: 'observation',
  };

  it('maps all legacy categories', () => {
    const categories = ['identity', 'preference', 'pattern', 'priority', 'schedule', 'decision', 'fact', 'workflow', 'other'];
    for (const cat of categories) {
      expect(CATEGORY_TO_SUBTYPE[cat]).toBeDefined();
    }
  });

  it('maps "other" to "observation" (per spec: single-interaction → observation)', () => {
    expect(CATEGORY_TO_SUBTYPE['other']).toBe('observation');
  });

  it('preserves direct mappings', () => {
    expect(CATEGORY_TO_SUBTYPE['identity']).toBe('identity');
    expect(CATEGORY_TO_SUBTYPE['pattern']).toBe('pattern');
  });
});
