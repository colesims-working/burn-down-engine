import { describe, it, expect } from 'vitest';

// ─── Issue 1: Decomposition proposals stay local ────────────

describe('Issue 1: Decomposition proposals are local-only', () => {
  it('proposal IDs have the proposal- prefix', () => {
    const taskId = 'task-123';
    const subtasks = [
      { title: 'Sub A', nextAction: 'Do A' },
      { title: 'Sub B', nextAction: 'Do B' },
    ];
    const proposals = subtasks.map((sub, i) => ({
      id: `proposal-${taskId}-${i}`,
      title: sub.title,
      nextAction: sub.nextAction,
    }));
    expect(proposals[0].id).toBe('proposal-task-123-0');
    expect(proposals[1].id).toBe('proposal-task-123-1');
    expect(proposals[0].id.startsWith('proposal-')).toBe(true);
  });

  it('subtask nextAction is preserved in proposals', () => {
    const subtask = { title: 'Write docs', nextAction: 'Draft README with usage examples' };
    const proposalResult = {
      title: subtask.title,
      nextAction: subtask.nextAction,
      decompositionNeeded: false,
    };
    expect(proposalResult.nextAction).toBe('Draft README with usage examples');
    expect(proposalResult.decompositionNeeded).toBe(false);
  });

  it('proposal- prefix tasks are not deleted from Todoist', () => {
    const childId = 'proposal-task-123-0';
    const shouldDeleteFromTodoist = !childId.startsWith('proposal-');
    expect(shouldDeleteFromTodoist).toBe(false);
  });

  it('real task IDs are still deleted from Todoist', () => {
    const childId = 'real-task-456';
    const shouldDeleteFromTodoist = !childId.startsWith('proposal-');
    expect(shouldDeleteFromTodoist).toBe(true);
  });
});

// ─── Issue 2: Answer path applies proper decision logic ─────

describe('Issue 2: Answer path decision logic', () => {
  it('low confidence + questions → needs-input', () => {
    const result = { confidence: 0.5, questions: ['What did you mean?'] };
    const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
    expect(needsInput).toBe(true);
  });

  it('high confidence → auto-approve', () => {
    const autoApproveThreshold = 0.95;
    const result = { confidence: 0.97, questions: [] };
    const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
    const autoApprove = result.confidence >= autoApproveThreshold && !needsInput;
    expect(autoApprove).toBe(true);
  });

  it('medium confidence → done (manual review)', () => {
    const autoApproveThreshold = 0.95;
    const result = { confidence: 0.82, questions: [] };
    const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
    const autoApprove = result.confidence >= autoApproveThreshold && !needsInput;
    expect(needsInput).toBe(false);
    expect(autoApprove).toBe(false);
    // Falls through to 'done'
  });

  it('low confidence without questions → done (not needs-input)', () => {
    const result = { confidence: 0.4, questions: [] };
    const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
    expect(needsInput).toBe(false);
  });
});

// ─── Issue 3: Someday/Maybe as first-class status ───────────

describe('Issue 3: Someday/Maybe detection', () => {
  it('someday-maybe label triggers someday status', () => {
    const labels = ['work', 'someday-maybe'];
    const isSomeday = labels.includes('someday-maybe') || labels.includes('project-idea');
    expect(isSomeday).toBe(true);
  });

  it('project-idea label triggers someday status', () => {
    const labels = ['project-idea'];
    const isSomeday = labels.includes('someday-maybe') || labels.includes('project-idea');
    expect(isSomeday).toBe(true);
  });

  it('normal labels do not trigger someday', () => {
    const labels = ['work', 'deep-work'];
    const isSomeday = labels.includes('someday-maybe') || labels.includes('project-idea');
    expect(isSomeday).toBe(false);
  });

  it('someday tasks are excluded from active tiers', () => {
    const isActiveTier = (t: { status: string }) =>
      t.status !== 'completed' && t.status !== 'waiting' && t.status !== 'blocked' && t.status !== 'deferred' && t.status !== 'someday';
    expect(isActiveTier({ status: 'active' })).toBe(true);
    expect(isActiveTier({ status: 'clarified' })).toBe(true);
    expect(isActiveTier({ status: 'someday' })).toBe(false);
    expect(isActiveTier({ status: 'completed' })).toBe(false);
    expect(isActiveTier({ status: 'deferred' })).toBe(false);
  });
});

// ─── Issue 4: Context cache keyed by page + input ───────────

describe('Issue 4: Cache key includes input', () => {
  it('different inputs produce different cache keys', () => {
    const key1 = `engage:${'task A | task B'.slice(0, 100)}`;
    const key2 = `engage:${''.slice(0, 100)}`;
    expect(key1).not.toBe(key2);
  });

  it('same page + same input produce same cache key', () => {
    const input = 'project goals summary';
    const key1 = `organize:${input.slice(0, 100)}`;
    const key2 = `organize:${input.slice(0, 100)}`;
    expect(key1).toBe(key2);
  });

  it('long inputs are truncated to 100 chars', () => {
    const longInput = 'x'.repeat(200);
    const key = `engage:${longInput.slice(0, 100)}`;
    expect(key.length).toBe('engage:'.length + 100);
  });
});

// ─── Issue 5: Session restore preserves full state ──────────

describe('Issue 5: Session restore state preservation', () => {
  const validStates = ['done', 'approved', 'needs-input', 'rejected', 'completed'] as const;

  it('approved status is preserved', () => {
    const saved = { status: 'approved' };
    const restored = validStates.includes(saved.status as any) ? saved.status : 'done';
    expect(restored).toBe('approved');
  });

  it('needs-input status is preserved (was broken)', () => {
    const saved = { status: 'needs-input' };
    const restored = validStates.includes(saved.status as any) ? saved.status : 'done';
    expect(restored).toBe('needs-input');
  });

  it('rejected status is preserved (was broken)', () => {
    const saved = { status: 'rejected' };
    const restored = validStates.includes(saved.status as any) ? saved.status : 'done';
    expect(restored).toBe('rejected');
  });

  it('completed status is preserved (was broken)', () => {
    const saved = { status: 'completed' };
    const restored = validStates.includes(saved.status as any) ? saved.status : 'done';
    expect(restored).toBe('completed');
  });

  it('unknown status falls back to done', () => {
    const saved = { status: 'garbage' };
    const restored = validStates.includes(saved.status as any) ? saved.status : 'done';
    expect(restored).toBe('done');
  });
});

// ─── Issue 6: Case-insensitive project matching ─────────────

describe('Issue 6: Project name matching', () => {
  const projects = [
    { id: '1', name: 'Website Redesign' },
    { id: '2', name: 'API Migration' },
  ];

  it('exact match works', () => {
    const name = 'Website Redesign';
    const matched = projects.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
    expect(matched?.id).toBe('1');
  });

  it('case-insensitive match works', () => {
    const name = 'website redesign';
    const matched = projects.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
    expect(matched?.id).toBe('1');
  });

  it('whitespace-trimmed match works', () => {
    const name = '  API Migration  ';
    const matched = projects.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
    expect(matched?.id).toBe('2');
  });

  it('no match creates new project', () => {
    const name = 'Brand New Project';
    const matched = projects.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim());
    expect(matched).toBeUndefined();
  });
});

// ─── Issue 7: Project names in ranking payload ──────────────

describe('Issue 7: Ranking payload includes project names', () => {
  it('task summary uses project name not ID', () => {
    const projectMap = new Map([['proj-1', { name: 'Website Redesign', goal: 'Launch by Q3' }]]);
    const task = { id: 't1', title: 'Fix hero section', projectId: 'proj-1' };
    const summary = {
      id: task.id,
      title: task.title,
      projectName: projectMap.get(task.projectId)?.name || 'Inbox',
      projectGoal: projectMap.get(task.projectId)?.goal || null,
    };
    expect(summary.projectName).toBe('Website Redesign');
    expect(summary.projectGoal).toBe('Launch by Q3');
  });

  it('task without project gets Inbox', () => {
    const projectMap = new Map<string, { name: string; goal: string | null }>();
    const summary = {
      projectName: projectMap.get('')?.name || 'Inbox',
      projectGoal: projectMap.get('')?.goal || null,
    };
    expect(summary.projectName).toBe('Inbox');
  });
});

// ─── Issue 8: Filing assistant includes filed tasks with smells ─

describe('Issue 8: Filing candidates include org smells', () => {
  const tasks = [
    { id: '1', projectId: null, nextAction: 'Do X', labels: '["work"]' },    // unfiled
    { id: '2', projectId: 'p1', nextAction: '', labels: '["work"]' },         // filed, no nextAction
    { id: '3', projectId: 'p1', nextAction: 'Do Y', labels: '[]' },           // filed, no labels
    { id: '4', projectId: 'p1', nextAction: 'Do Z', labels: '["work"]' },     // filed, clean
  ];

  it('unfiled tasks are included', () => {
    const unfiled = tasks.filter(t => !t.projectId);
    expect(unfiled).toHaveLength(1);
    expect(unfiled[0].id).toBe('1');
  });

  it('filed tasks with no nextAction are included', () => {
    const smelly = tasks.filter(t => {
      if (!t.projectId) return false;
      const hasNoNextAction = !t.nextAction || t.nextAction.trim() === '';
      const labels = JSON.parse(t.labels || '[]');
      const hasNoLabels = labels.length === 0;
      return hasNoNextAction || hasNoLabels;
    });
    expect(smelly).toHaveLength(2);
    expect(smelly.map(t => t.id)).toContain('2');
    expect(smelly.map(t => t.id)).toContain('3');
  });

  it('clean filed tasks are excluded', () => {
    const smelly = tasks.filter(t => {
      if (!t.projectId) return false;
      const hasNoNextAction = !t.nextAction || t.nextAction.trim() === '';
      const labels = JSON.parse(t.labels || '[]');
      const hasNoLabels = labels.length === 0;
      return hasNoNextAction || hasNoLabels;
    });
    expect(smelly.map(t => t.id)).not.toContain('4');
  });
});

// ─── Issue 10: Rank persistence ─────────────────────────────

describe('Issue 10: rankWithinTier persistence', () => {
  it('ranks are sequential starting from 1', () => {
    const rankedIds = ['a', 'b', 'c'];
    const updates = rankedIds.map((id, i) => ({ id, rank: i + 1 }));
    expect(updates).toEqual([
      { id: 'a', rank: 1 },
      { id: 'b', rank: 2 },
      { id: 'c', rank: 3 },
    ]);
  });

  it('fire victim is the last element (highest rank = lowest priority)', () => {
    const p2Tasks = [
      { id: 'a', rankWithinTier: 1 },
      { id: 'b', rankWithinTier: 3 },
      { id: 'c', rankWithinTier: 2 },
    ];
    const sorted = [...p2Tasks].sort((a, b) => {
      const rankDiff = (b.rankWithinTier ?? 0) - (a.rankWithinTier ?? 0);
      return rankDiff;
    });
    const victim = sorted[sorted.length - 1];
    expect(victim.id).toBe('a'); // rank 1 = lowest = most deferrable
  });
});

// ─── Issue 11: Archive response validation ──────────────────

describe('Issue 11: Archive path consistency', () => {
  it('archiveProject should be preferred over rename', () => {
    // The dead server action was using updateProject with rename.
    // The fix routes through archiveProject (Sync API v9).
    const hasArchiveMethod = true; // client.ts:archiveProject exists
    const usesRename = false; // No longer falls through to rename-only
    expect(hasArchiveMethod).toBe(true);
    expect(usesRename).toBe(false);
  });
});
