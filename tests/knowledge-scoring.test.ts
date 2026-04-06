import { describe, it, expect } from 'vitest';
import {
  computeRetrievalScore,
  computeRecencyWeight,
  computeReferenceDensity,
  computeTemporalRelevance,
  computeGraphScore,
  applyPageBoost,
  computeSalience,
  estimateTokens,
  formatObjectForPrompt,
} from '../src/lib/knowledge/scoring';

// =============================================================================
// Retrieval Score
// =============================================================================

describe('computeRetrievalScore', () => {
  it('computes non-event score with correct weights', () => {
    const score = computeRetrievalScore({
      vectorSimilarity: 1.0,
      linkProximity: 1.0,
      recencyWeight: 1.0,
      referenceDensity: 1.0,
      isEvent: false,
    });
    // 0.35 + 0.25 + 0.20 + 0.20 = 1.0
    expect(score).toBeCloseTo(1.0);
  });

  it('computes event score with temporal relevance', () => {
    const score = computeRetrievalScore({
      vectorSimilarity: 1.0,
      linkProximity: 1.0,
      recencyWeight: 1.0,
      referenceDensity: 1.0,
      temporalRelevance: 1.0,
      isEvent: true,
    });
    // 0.30 + 0.20 + 0.25 + 0.10 + 0.15 = 1.0
    expect(score).toBeCloseTo(1.0);
  });

  it('returns 0 when all inputs are 0', () => {
    expect(computeRetrievalScore({
      vectorSimilarity: 0, linkProximity: 0,
      recencyWeight: 0, referenceDensity: 0, isEvent: false,
    })).toBe(0);
  });

  it('vector similarity dominates non-event scoring', () => {
    const highVec = computeRetrievalScore({
      vectorSimilarity: 1.0, linkProximity: 0,
      recencyWeight: 0, referenceDensity: 0, isEvent: false,
    });
    const highLink = computeRetrievalScore({
      vectorSimilarity: 0, linkProximity: 1.0,
      recencyWeight: 0, referenceDensity: 0, isEvent: false,
    });
    expect(highVec).toBeGreaterThan(highLink);
  });
});

// =============================================================================
// Recency Weight
// =============================================================================

describe('computeRecencyWeight', () => {
  it('returns ~1.0 for just-updated objects', () => {
    const weight = computeRecencyWeight(new Date().toISOString());
    expect(weight).toBeGreaterThan(0.99);
  });

  it('returns ~0.5 at half-life (30 days)', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const weight = computeRecencyWeight(thirtyDaysAgo);
    expect(weight).toBeCloseTo(0.5, 1);
  });

  it('returns low value for very old objects', () => {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const weight = computeRecencyWeight(yearAgo);
    expect(weight).toBeLessThan(0.01);
  });

  it('returns 0.1 for null date', () => {
    expect(computeRecencyWeight(null)).toBe(0.1);
  });

  it('respects custom half-life', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const weight = computeRecencyWeight(sixtyDaysAgo, 60);
    expect(weight).toBeCloseTo(0.5, 1);
  });
});

// =============================================================================
// Reference Density
// =============================================================================

describe('computeReferenceDensity', () => {
  it('returns 0 for no references', () => {
    expect(computeReferenceDensity(0)).toBe(0);
  });

  it('scales linearly up to 10', () => {
    expect(computeReferenceDensity(5)).toBeCloseTo(0.5);
  });

  it('caps at 1.0 for 10+ references', () => {
    expect(computeReferenceDensity(10)).toBe(1.0);
    expect(computeReferenceDensity(100)).toBe(1.0);
  });
});

// =============================================================================
// Temporal Relevance
// =============================================================================

describe('computeTemporalRelevance', () => {
  it('returns 1.0 for today', () => {
    expect(computeTemporalRelevance(new Date().toISOString())).toBe(1.0);
  });

  it('returns 1.0 within 3 days', () => {
    const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeTemporalRelevance(tomorrow)).toBe(1.0);
  });

  it('decays after 3 days', () => {
    const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const relevance = computeTemporalRelevance(tenDaysOut);
    expect(relevance).toBeGreaterThan(0.05);
    expect(relevance).toBeLessThan(1.0);
  });

  it('returns 0.05 for 30+ days away', () => {
    const farOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeTemporalRelevance(farOut)).toBe(0.05);
  });

  it('returns 0 for null date', () => {
    expect(computeTemporalRelevance(null)).toBe(0);
  });
});

// =============================================================================
// Graph Score
// =============================================================================

describe('computeGraphScore', () => {
  it('applies 0.85 penalty for 1-hop', () => {
    const score = computeGraphScore(1.0, 1.0, 1);
    expect(score).toBeCloseTo(0.85);
  });

  it('applies 0.60 penalty for 2-hop', () => {
    const score = computeGraphScore(1.0, 1.0, 2);
    expect(score).toBeCloseTo(0.60);
  });

  it('multiplies seed similarity × edge confidence × penalty', () => {
    const score = computeGraphScore(0.8, 0.5, 1);
    expect(score).toBeCloseTo(0.8 * 0.5 * 0.85);
  });
});

// =============================================================================
// Page Boost
// =============================================================================

describe('applyPageBoost', () => {
  it('boosts preference on clarify page', () => {
    const base = 0.5;
    const boosted = applyPageBoost(base, 'preference', 'clarify');
    expect(boosted).toBeCloseTo(0.5 * 1.15);
  });

  it('does not boost unrelated subtypes', () => {
    expect(applyPageBoost(0.5, 'identity', 'clarify')).toBe(0.5);
  });

  it('handles null subtype', () => {
    expect(applyPageBoost(0.5, null, 'clarify')).toBe(0.5);
  });

  it('boosts pattern on reflect page', () => {
    const boosted = applyPageBoost(0.5, 'pattern', 'reflect');
    expect(boosted).toBeCloseTo(0.5 * 1.15);
  });
});

// =============================================================================
// Salience
// =============================================================================

describe('computeSalience', () => {
  it('returns high salience for confident, recent, referenced objects', () => {
    const salience = computeSalience(0.9, 0, 10);
    expect(salience).toBeCloseTo(0.9); // 0.9 * 1.0 * 1.0
  });

  it('returns low salience for old, unreferenced objects', () => {
    const salience = computeSalience(0.7, 120, 0);
    expect(salience).toBeLessThan(0.15); // Below dormancy threshold
  });

  it('decays with time', () => {
    const recent = computeSalience(0.8, 0, 5);
    const old = computeSalience(0.8, 60, 5);
    expect(recent).toBeGreaterThan(old);
  });
});

// =============================================================================
// Token Estimation
// =============================================================================

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('rounds up', () => {
    expect(estimateTokens('123')).toBe(1);
  });

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

// =============================================================================
// Format Object
// =============================================================================

describe('formatObjectForPrompt', () => {
  it('formats concept with value', () => {
    const result = formatObjectForPrompt({
      type: 'concept',
      name: 'Morning preference',
      subtype: 'preference',
      properties: JSON.stringify({ value: 'Prefers deep work before noon' }),
    });
    expect(result).toContain('[concept/preference]');
    expect(result).toContain('Morning preference');
    expect(result).toContain('Prefers deep work before noon');
  });

  it('formats person with role', () => {
    const result = formatObjectForPrompt({
      type: 'person',
      name: 'Alice',
      properties: JSON.stringify({ role: 'Engineering Manager' }),
    });
    expect(result).toContain('[person]');
    expect(result).toContain('Alice');
    expect(result).toContain('Engineering Manager');
  });

  it('formats event with date', () => {
    const result = formatObjectForPrompt({
      type: 'event',
      name: 'Offsite',
      subtype: 'trip',
      properties: JSON.stringify({ date: '2026-05-01' }),
    });
    expect(result).toContain('Date: 2026-05-01');
  });

  it('handles empty properties', () => {
    const result = formatObjectForPrompt({
      type: 'organization',
      name: 'Acme',
      properties: '{}',
    });
    expect(result).toContain('[organization]');
    expect(result).toContain('Acme');
  });
});
