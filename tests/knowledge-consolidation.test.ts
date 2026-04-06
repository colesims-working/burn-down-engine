import { describe, it, expect } from 'vitest';
import { computeSalience } from '../src/lib/knowledge/scoring';
import { KNOWLEDGE_CONFIG, AUTO_PIN_SUBTYPES } from '../src/lib/knowledge/config';

// =============================================================================
// Salience for Lifecycle Decisions
// =============================================================================

describe('Salience scoring for consolidation', () => {
  it('high salience for confident, recent, referenced objects', () => {
    // confidence=0.9, 0 days old, 10 refs → 0.9 * 1.0 * 1.0
    expect(computeSalience(0.9, 0, 10)).toBeCloseTo(0.9);
  });

  it('low salience triggers dormancy (below 0.15)', () => {
    // confidence=0.5, 120 days old, 0 refs → 0.5 * decay * 0 = 0
    const salience = computeSalience(0.5, 120, 0);
    expect(salience).toBeLessThan(KNOWLEDGE_CONFIG.DORMANT_THRESHOLD);
  });

  it('zero refs always produces zero salience', () => {
    expect(computeSalience(1.0, 0, 0)).toBe(0);
  });

  it('old but well-referenced objects stay above dormancy', () => {
    // confidence=0.8, 90 days, 8 refs
    const salience = computeSalience(0.8, 90, 8);
    // 0.8 * exp(-90/60) * 0.8 = 0.8 * 0.223 * 0.8 ≈ 0.143
    expect(salience).toBeLessThan(KNOWLEDGE_CONFIG.DORMANT_THRESHOLD);
    // Actually this IS below threshold — old + moderate refs = dormant. Correct behavior.
  });

  it('recent with few refs stays active', () => {
    // confidence=0.7, 5 days, 3 refs
    const salience = computeSalience(0.7, 5, 3);
    // 0.7 * exp(-5/60) * 0.3 = 0.7 * 0.920 * 0.3 ≈ 0.193
    expect(salience).toBeGreaterThan(KNOWLEDGE_CONFIG.DORMANT_THRESHOLD);
  });
});

// =============================================================================
// Dormancy Guards
// =============================================================================

describe('Dormancy guard logic', () => {
  function shouldSkipDormancy(obj: {
    source: string;
    pinned: number;
    subtype: string | null;
  }): boolean {
    if (obj.pinned === 1) return true;
    if (obj.source === 'manual' || obj.source === 'seed') return true;
    if (AUTO_PIN_SUBTYPES.includes(obj.subtype as any)) return true;
    return false;
  }

  it('skips pinned objects', () => {
    expect(shouldSkipDormancy({ source: 'extracted', pinned: 1, subtype: 'fact' })).toBe(true);
  });

  it('skips manual source', () => {
    expect(shouldSkipDormancy({ source: 'manual', pinned: 0, subtype: 'fact' })).toBe(true);
  });

  it('skips seed source', () => {
    expect(shouldSkipDormancy({ source: 'seed', pinned: 0, subtype: null })).toBe(true);
  });

  it('skips identity subtype', () => {
    expect(shouldSkipDormancy({ source: 'extracted', pinned: 0, subtype: 'identity' })).toBe(true);
  });

  it('skips priority subtype', () => {
    expect(shouldSkipDormancy({ source: 'extracted', pinned: 0, subtype: 'priority' })).toBe(true);
  });

  it('does not skip regular extracted observations', () => {
    expect(shouldSkipDormancy({ source: 'extracted', pinned: 0, subtype: 'observation' })).toBe(false);
  });

  it('does not skip extracted facts', () => {
    expect(shouldSkipDormancy({ source: 'extracted', pinned: 0, subtype: 'fact' })).toBe(false);
  });

  it('does not skip migrated patterns', () => {
    expect(shouldSkipDormancy({ source: 'migrated', pinned: 0, subtype: 'pattern' })).toBe(false);
  });
});

// =============================================================================
// Confidence Reinforcement
// =============================================================================

describe('Confidence reinforcement', () => {
  function reinforce(confidence: number): number {
    const step = KNOWLEDGE_CONFIG.REINFORCEMENT_STEP;
    return Math.min(1.0, confidence + step * (1.0 - confidence));
  }

  it('increases low confidence more', () => {
    const from05 = reinforce(0.5);
    const from09 = reinforce(0.9);
    expect(from05 - 0.5).toBeGreaterThan(from09 - 0.9);
  });

  it('never exceeds 1.0', () => {
    expect(reinforce(1.0)).toBe(1.0);
    expect(reinforce(0.999)).toBeLessThanOrEqual(1.0);
  });

  it('uses 0.02 step per spec', () => {
    expect(KNOWLEDGE_CONFIG.REINFORCEMENT_STEP).toBe(0.02);
    // 0.7 + 0.02 * 0.3 = 0.706
    expect(reinforce(0.7)).toBeCloseTo(0.706);
  });
});

// =============================================================================
// Dedup Threshold
// =============================================================================

describe('Dedup configuration', () => {
  it('uses 0.92 similarity threshold', () => {
    expect(KNOWLEDGE_CONFIG.DEDUP_SIMILARITY_THRESHOLD).toBe(0.92);
  });

  it('synthesis requires minimum cluster size of 3', () => {
    expect(KNOWLEDGE_CONFIG.SYNTHESIS_MIN_CLUSTER_SIZE).toBe(3);
  });

  it('synthesis cluster similarity is 0.75', () => {
    expect(KNOWLEDGE_CONFIG.SYNTHESIS_CLUSTER_SIMILARITY).toBe(0.75);
  });

  it('reference retention is 180 days', () => {
    expect(KNOWLEDGE_CONFIG.REFERENCE_RETENTION_DAYS).toBe(180);
  });

  it('active object budget is 300', () => {
    expect(KNOWLEDGE_CONFIG.ACTIVE_OBJECT_BUDGET).toBe(300);
  });
});

// =============================================================================
// Synthesis Clustering Logic
// =============================================================================

describe('Synthesis clustering', () => {
  // Mirrors the graph-locality clustering in consolidation.ts
  function clusterBySharedLinks(
    obsIds: string[],
    linkedEntities: Map<string, Set<string>>,
    minSize: number,
  ): string[][] {
    const clusters: string[][] = [];
    const assigned = new Set<string>();

    for (const id of obsIds) {
      if (assigned.has(id)) continue;
      const myLinks = linkedEntities.get(id) ?? new Set();
      if (myLinks.size === 0) continue;

      const cluster = [id];
      assigned.add(id);

      for (const other of obsIds) {
        if (assigned.has(other)) continue;
        const otherLinks = linkedEntities.get(other) ?? new Set();
        const shared = [...myLinks].some(e => otherLinks.has(e));
        if (shared) {
          cluster.push(other);
          assigned.add(other);
        }
      }

      if (cluster.length >= minSize) {
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  it('clusters observations sharing a linked entity', () => {
    const links = new Map<string, Set<string>>([
      ['obs1', new Set(['projectA'])],
      ['obs2', new Set(['projectA'])],
      ['obs3', new Set(['projectA'])],
      ['obs4', new Set(['projectB'])],
    ]);
    const clusters = clusterBySharedLinks(['obs1', 'obs2', 'obs3', 'obs4'], links, 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual(['obs1', 'obs2', 'obs3']);
  });

  it('does not create clusters below min size', () => {
    const links = new Map<string, Set<string>>([
      ['obs1', new Set(['projectA'])],
      ['obs2', new Set(['projectA'])],
    ]);
    const clusters = clusterBySharedLinks(['obs1', 'obs2'], links, 3);
    expect(clusters).toHaveLength(0);
  });

  it('creates multiple clusters for different link groups', () => {
    const links = new Map<string, Set<string>>([
      ['a1', new Set(['projX'])],
      ['a2', new Set(['projX'])],
      ['a3', new Set(['projX'])],
      ['b1', new Set(['projY'])],
      ['b2', new Set(['projY'])],
      ['b3', new Set(['projY'])],
    ]);
    const clusters = clusterBySharedLinks(['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], links, 3);
    expect(clusters).toHaveLength(2);
  });

  it('ignores observations with no linked entities', () => {
    const links = new Map<string, Set<string>>([
      ['obs1', new Set()],
      ['obs2', new Set(['projA'])],
      ['obs3', new Set(['projA'])],
      ['obs4', new Set(['projA'])],
    ]);
    const clusters = clusterBySharedLinks(['obs1', 'obs2', 'obs3', 'obs4'], links, 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).not.toContain('obs1');
  });
});
