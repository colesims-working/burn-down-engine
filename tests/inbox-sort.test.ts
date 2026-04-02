import { describe, it, expect } from 'vitest';

interface InboxTask {
  id: string;
  title: string;
  originalText: string;
  createdAt: string;
}

/**
 * Tests for inbox sort logic: newest-first (default) and oldest-first toggle.
 */
describe('Inbox Sort Logic', () => {
  const tasks: InboxTask[] = [
    { id: '1', title: 'First task', originalText: 'First task', createdAt: '2026-03-01T10:00:00Z' },
    { id: '2', title: 'Second task', originalText: 'Second task', createdAt: '2026-03-15T10:00:00Z' },
    { id: '3', title: 'Third task', originalText: 'Third task', createdAt: '2026-03-10T10:00:00Z' },
    { id: '4', title: 'Fourth task', originalText: 'Fourth task', createdAt: '2026-03-20T10:00:00Z' },
    { id: '5', title: 'Fifth task', originalText: 'Fifth task', createdAt: '2026-03-05T10:00:00Z' },
  ];

  function sortTasks(items: InboxTask[], newestFirst: boolean): InboxTask[] {
    return [...items].sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return newestFirst ? db - da : da - db;
    });
  }

  it('sorts newest first by default', () => {
    const sorted = sortTasks(tasks, true);
    expect(sorted[0].id).toBe('4'); // Mar 20
    expect(sorted[1].id).toBe('2'); // Mar 15
    expect(sorted[2].id).toBe('3'); // Mar 10
    expect(sorted[3].id).toBe('5'); // Mar 5
    expect(sorted[4].id).toBe('1'); // Mar 1
  });

  it('sorts oldest first when toggled', () => {
    const sorted = sortTasks(tasks, false);
    expect(sorted[0].id).toBe('1'); // Mar 1
    expect(sorted[1].id).toBe('5'); // Mar 5
    expect(sorted[2].id).toBe('3'); // Mar 10
    expect(sorted[3].id).toBe('2'); // Mar 15
    expect(sorted[4].id).toBe('4'); // Mar 20
  });

  it('handles empty task list', () => {
    expect(sortTasks([], true)).toEqual([]);
    expect(sortTasks([], false)).toEqual([]);
  });

  it('handles single task', () => {
    const single = [tasks[0]];
    expect(sortTasks(single, true)).toHaveLength(1);
    expect(sortTasks(single, false)).toHaveLength(1);
  });

  it('handles tasks with same creation time', () => {
    const sameTasks: InboxTask[] = [
      { id: 'a', title: 'A', originalText: 'A', createdAt: '2026-03-01T10:00:00Z' },
      { id: 'b', title: 'B', originalText: 'B', createdAt: '2026-03-01T10:00:00Z' },
    ];
    const sorted = sortTasks(sameTasks, true);
    expect(sorted).toHaveLength(2);
    // Both have same time, order is stable (0 - 0 = 0)
  });

  it('does not mutate original array', () => {
    const original = [...tasks];
    sortTasks(tasks, true);
    expect(tasks).toEqual(original);
  });
});
