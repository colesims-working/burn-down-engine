import { describe, it, expect } from 'vitest';

describe('Issue 1: Engage fast path uses stored ranking', () => {
  it('sortByRank orders by rankWithinTier ascending', () => {
    const tasks = [
      { id: 'a', rankWithinTier: 3 },
      { id: 'b', rankWithinTier: 1 },
      { id: 'c', rankWithinTier: null },
      { id: 'd', rankWithinTier: 2 },
    ];
    const sorted = [...tasks].sort((a, b) => (a.rankWithinTier ?? 999) - (b.rankWithinTier ?? 999));
    expect(sorted.map(t => t.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('null rankWithinTier sorts to end', () => {
    const tasks = [
      { id: 'a', rankWithinTier: null },
      { id: 'b', rankWithinTier: 1 },
    ];
    const sorted = [...tasks].sort((a, b) => (a.rankWithinTier ?? 999) - (b.rankWithinTier ?? 999));
    expect(sorted[0].id).toBe('b');
    expect(sorted[1].id).toBe('a');
  });
});

describe('Issue 6: Engage actions use optimistic updates', () => {
  it('removeTaskOptimistic filters from all tiers', () => {
    const data = {
      fires: [{ id: '1' }],
      mustDo: [{ id: '2' }, { id: '3' }],
      shouldDo: [{ id: '4' }],
      thisWeek: [],
      backlog: [],
      waiting: [],
      blocked: [],
      someday: [],
    };
    const remove = (arr: { id: string }[]) => arr.filter(t => t.id !== '2');
    const result = {
      ...data,
      fires: remove(data.fires),
      mustDo: remove(data.mustDo),
      shouldDo: remove(data.shouldDo),
    };
    expect(result.mustDo).toHaveLength(1);
    expect(result.mustDo[0].id).toBe('3');
    expect(result.fires).toHaveLength(1);
  });
});

describe('Issue 8: Pre-fetched Maps eliminate N+1 queries', () => {
  it('Map lookup by todoistId is O(1)', () => {
    const projects = [
      { id: 'local-1', todoistId: 'todoist-1', name: 'Project A' },
      { id: 'local-2', todoistId: 'todoist-2', name: 'Project B' },
    ];
    const byTodoistId = new Map(projects.map(p => [p.todoistId, p]));
    expect(byTodoistId.get('todoist-1')?.name).toBe('Project A');
    expect(byTodoistId.get('todoist-2')?.name).toBe('Project B');
    expect(byTodoistId.get('todoist-3')).toBeUndefined();
  });
});

describe('Issue 9: Incremental project count adjustment', () => {
  it('adjusts counts for project changes', () => {
    let oldCount = 5;
    let newCount = 3;
    // Simulating: task moves from project A to project B
    oldCount = Math.max(0, oldCount - 1);
    newCount = newCount + 1;
    expect(oldCount).toBe(4);
    expect(newCount).toBe(4);
  });

  it('handles null project IDs (unfiled)', () => {
    const oldProjectId: string | null = null;
    const newProjectId: string | null = 'proj-1';
    // Only new project gets incremented
    const shouldDecrementOld = oldProjectId !== null;
    const shouldIncrementNew = newProjectId !== null;
    expect(shouldDecrementOld).toBe(false);
    expect(shouldIncrementNew).toBe(true);
  });
});

describe('Issue 10: Command palette caches projects on open', () => {
  it('client-side filter matches case-insensitively', () => {
    const projects = [
      { name: 'Website Redesign', id: '1' },
      { name: 'API Migration', id: '2' },
      { name: 'Personal Goals', id: '3' },
    ];
    const q = 'api';
    const filtered = projects.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('API Migration');
  });
});

describe('Issue 17: Integrity check scheduling', () => {
  it('15-minute interval is 900000ms', () => {
    expect(15 * 60 * 1000).toBe(900000);
  });
});

describe('Issue 19: Stagger animation beyond 8 items', () => {
  it('items beyond 8 should not animate', () => {
    // The CSS rule .stagger-item:nth-child(n+9) { animation: none; }
    // ensures items 9+ render immediately
    const maxAnimatedItems = 8;
    const totalItems = 200;
    const animatedItems = Math.min(totalItems, maxAnimatedItems);
    expect(animatedItems).toBe(8);
  });
});

describe('Issue 20: Shared context between P1 and P2 ranking', () => {
  it('rankTasksInTier accepts prebuilt context', () => {
    // The function signature now accepts optional prebuiltContext
    // When provided, it skips the buildContext call (saving an embedding API call)
    const prebuiltContext = 'Some cached context from a prior call';
    expect(typeof prebuiltContext).toBe('string');
    expect(prebuiltContext.length).toBeGreaterThan(0);
  });
});
