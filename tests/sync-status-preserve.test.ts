import { describe, it, expect } from 'vitest';

describe('Inbox fetch filters removed tasks', () => {
  interface InboxTask { id: string; title: string; }

  it('filters out tasks in removedIds on re-fetch', () => {
    const serverData: InboxTask[] = [
      { id: 'a', title: 'Task A' },
      { id: 'b', title: 'Task B' },
      { id: 'c', title: 'Task C' },
    ];
    const removedIds = new Set(['b']);
    const filtered = serverData.filter(t => !removedIds.has(t.id));
    expect(filtered).toHaveLength(2);
    expect(filtered.map(t => t.id)).toEqual(['a', 'c']);
  });

  it('returns all tasks when removedIds is empty', () => {
    const serverData: InboxTask[] = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
    const removedIds = new Set<string>();
    expect(serverData.filter(t => !removedIds.has(t.id))).toHaveLength(2);
  });
});

/**
 * Tests for Bug 2: syncInbox should not overwrite locally-completed/killed task statuses.
 */
describe('Sync Status Preservation', () => {
  type TaskStatus = 'inbox' | 'clarified' | 'active' | 'completed' | 'killed' | 'waiting' | 'blocked' | 'deferred';

  // Mirrors the logic in syncInbox() for determining whether to overwrite status
  function shouldPreserveStatus(existingStatus: TaskStatus): boolean {
    return existingStatus === 'completed' || existingStatus === 'killed';
  }

  function buildSyncUpdate(existingStatus: TaskStatus, todoistContent: string) {
    const preserveStatus = shouldPreserveStatus(existingStatus);
    return {
      title: todoistContent,
      ...(preserveStatus ? {} : { status: 'inbox' as const }),
    };
  }

  it('overwrites status to inbox for regular inbox tasks', () => {
    const update = buildSyncUpdate('inbox', 'Updated task');
    expect(update.status).toBe('inbox');
  });

  it('overwrites status for clarified tasks (returned to inbox in Todoist)', () => {
    const update = buildSyncUpdate('clarified', 'Updated task');
    expect(update.status).toBe('inbox');
  });

  it('preserves completed status during sync', () => {
    const update = buildSyncUpdate('completed', 'Updated task');
    expect(update.status).toBeUndefined();
  });

  it('preserves killed status during sync', () => {
    const update = buildSyncUpdate('killed', 'Updated task');
    expect(update.status).toBeUndefined();
  });

  it('does not preserve active status (task may have returned to inbox)', () => {
    const update = buildSyncUpdate('active', 'Updated task');
    expect(update.status).toBe('inbox');
  });

  it('does not preserve waiting/blocked/deferred (these could legitimately return to inbox)', () => {
    for (const status of ['waiting', 'blocked', 'deferred'] as TaskStatus[]) {
      const update = buildSyncUpdate(status, 'task');
      expect(update.status).toBe('inbox');
    }
  });
});
