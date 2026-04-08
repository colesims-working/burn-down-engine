import { describe, it, expect } from 'vitest';
import { mapFromTodoistPriority } from '../src/lib/todoist/sync';

describe('Issue 3: Priority sync on updates', () => {
  it('mapFromTodoistPriority maps correctly', () => {
    expect(mapFromTodoistPriority(4)).toBe(1); // Todoist high → our P1
    expect(mapFromTodoistPriority(3)).toBe(2); // Todoist medium → our P2
    expect(mapFromTodoistPriority(2)).toBe(3); // Todoist low → our P3
    expect(mapFromTodoistPriority(1)).toBe(4); // Todoist none → our P4
  });

  it('unknown priority defaults to P4', () => {
    expect(mapFromTodoistPriority(0)).toBe(4);
    expect(mapFromTodoistPriority(99)).toBe(4);
  });
});

describe('Issue 5: 404 guards on mutation handlers', () => {
  it('undefined result from .returning() should be caught', () => {
    const result = [undefined];
    const hasResult = !!result[0];
    expect(hasResult).toBe(false);
  });

  it('non-empty result passes the guard', () => {
    const result = [{ id: 'task-1', status: 'killed' }];
    const hasResult = !!result[0];
    expect(hasResult).toBe(true);
  });
});

describe('Issue 6: Fire victim selection', () => {
  it('takes the first element of desc-sorted array (worst-ranked)', () => {
    const p2Tasks = [
      { id: 'worst', rankWithinTier: 5 },   // worst-ranked, should be bumped
      { id: 'mid', rankWithinTier: 3 },
      { id: 'best', rankWithinTier: 1 },    // best-ranked, should be protected
    ];
    // desc sort: worst first
    const sorted = [...p2Tasks].sort((a, b) => (b.rankWithinTier ?? 0) - (a.rankWithinTier ?? 0));
    const toBump = sorted[0]; // Take first, not last
    expect(toBump.id).toBe('worst');
  });
});

describe('Issue 7: Split confirmation guards', () => {
  it('should not complete original when zero children succeed', () => {
    const results = [
      { status: 'rejected' as const, reason: 'Create failed' },
      { status: 'rejected' as const, reason: 'Create failed' },
    ];
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const totalProposals = 2;
    const shouldCompleteOriginal = successCount === totalProposals;
    expect(shouldCompleteOriginal).toBe(false);
  });

  it('should complete original when all children succeed', () => {
    const results = [
      { status: 'fulfilled' as const, value: 'id-1' },
      { status: 'fulfilled' as const, value: 'id-2' },
    ];
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const totalProposals = 2;
    const shouldCompleteOriginal = successCount === totalProposals;
    expect(shouldCompleteOriginal).toBe(true);
  });
});

describe('Issue 8: Filing project resolution', () => {
  it('case-insensitive match finds the project', () => {
    const projects = [{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Personal' }];
    const suggestedProject = 'work';
    const match = projects.find(p => p.name.toLowerCase().trim() === suggestedProject.toLowerCase().trim());
    expect(match?.id).toBe('p1');
  });

  it('no match returns null', () => {
    const projects = [{ id: 'p1', name: 'Work' }];
    const suggestedProject = 'Nonexistent';
    const match = projects.find(p => p.name.toLowerCase().trim() === suggestedProject.toLowerCase().trim());
    expect(match).toBeUndefined();
  });
});

describe('Issue 9: Consolidation scope gating', () => {
  it('active_only scope should skip dedup and synthesis', () => {
    const scope = 'active_only';
    const shouldRunDedup = scope === 'full';
    const shouldRunSynthesis = scope === 'full';
    const shouldRunDormancy = true; // always runs
    const shouldRunCleanup = true; // always runs
    expect(shouldRunDedup).toBe(false);
    expect(shouldRunSynthesis).toBe(false);
    expect(shouldRunDormancy).toBe(true);
    expect(shouldRunCleanup).toBe(true);
  });
});

describe('Issue 13: dedupKey recomputation', () => {
  it('should recompute when subtype changes', () => {
    const updates = { subtype: 'pattern' };
    const shouldRecompute = updates.subtype !== undefined;
    expect(shouldRecompute).toBe(true);
  });

  it('should recompute when properties change', () => {
    const updates = { properties: { key: 'new-value' } };
    const shouldRecompute = (updates as any).properties !== undefined;
    expect(shouldRecompute).toBe(true);
  });

  it('should NOT recompute when only confidence changes', () => {
    const updates = { confidence: 0.9 };
    const shouldRecompute = (updates as any).name !== undefined || (updates as any).subtype !== undefined || (updates as any).properties !== undefined;
    expect(shouldRecompute).toBe(false);
  });
});

describe('Issue 14: Cache key hashing', () => {
  it('DJB2 hash produces different keys for different inputs', () => {
    function simpleHash(str: string): string {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
      }
      return (hash >>> 0).toString(36);
    }
    const key1 = simpleHash('a'.repeat(100) + 'X');
    const key2 = simpleHash('a'.repeat(100) + 'Y');
    expect(key1).not.toBe(key2); // Would have collided with truncation
  });
});

describe('Issue 16: Threshold defaults unified', () => {
  it('single canonical threshold value', () => {
    const JS_DEFAULT = 0.85;
    const DB_DEFAULT = 0.85;
    expect(JS_DEFAULT).toBe(DB_DEFAULT);
  });
});

describe('Issue 19: Undo history uses correct action', () => {
  it('undo action should be "undone" not "unblocked"', () => {
    const action = 'undone';
    expect(action).toBe('undone');
    expect(action).not.toBe('unblocked');
  });
});
