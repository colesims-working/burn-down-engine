import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db
vi.mock('@/lib/db/client', () => {
  const mockDb = {
    query: {
      projects: { findFirst: vi.fn() },
      tasks: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => []),
        onConflictDoUpdate: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => []),
        })),
      })),
    })),
  };
  return { db: mockDb, schema: { projects: {}, tasks: { status: 'status', dueDate: 'dueDate', id: 'id', priority: 'priority' }, taskHistory: {}, syncState: {} } };
});

// Mock todoist client
vi.mock('@/lib/todoist/client', () => ({
  todoist: {
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    addComment: vi.fn(),
    createTask: vi.fn(),
    createProject: vi.fn(),
    findProjectByName: vi.fn(),
    getProjects: vi.fn(),
    getInboxTasks: vi.fn(),
    getInboxProject: vi.fn(),
    deleteTask: vi.fn(),
    completeTask: vi.fn(),
  },
}));

// Mock todoist sync helpers
vi.mock('@/lib/todoist/sync', () => ({
  syncTaskDueDate: vi.fn(),
  syncTaskLabels: vi.fn(),
  addTodoistComment: vi.fn(),
  mapToTodoistPriority: vi.fn((p: number) => {
    const map: Record<number, number> = { 0: 4, 1: 4, 2: 3, 3: 2, 4: 1 };
    return map[p] ?? 1;
  }),
}));

// Mock LLM (buildEngageList uses it for ranking)
vi.mock('@/lib/llm/router', () => ({
  llmGenerateJSON: vi.fn(),
}));

vi.mock('@/lib/llm/context', () => ({
  buildContext: vi.fn(() => ''),
}));

import { db } from '@/lib/db/client';
import { todoist } from '@/lib/todoist/client';
import { syncTaskDueDate, syncTaskLabels, addTodoistComment } from '@/lib/todoist/sync';
import { bumpTask, blockTask, waitTask, handleFire } from '@/lib/priority/engine';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    todoistId: 'todoist-task-1',
    originalText: 'Test',
    title: 'Test Task',
    nextAction: null,
    description: null,
    projectId: null,
    priority: 2,
    labels: '[]',
    dueDate: null,
    contextNotes: null,
    status: 'active',
    bumpCount: 0,
    blockerNote: null,
    ...overrides,
  } as any;
}

describe('bumpTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs due date to Todoist after bumping', async () => {
    const task = makeTask();
    const bumped = makeTask({ status: 'deferred', bumpCount: 1, dueDate: '2026-03-31' });

    (db.query.tasks.findFirst as any).mockResolvedValue(task);
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([bumped]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    await bumpTask('task-1', 'too busy');

    expect(syncTaskDueDate).toHaveBeenCalledWith(bumped);
  });
});

describe('blockTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs blocked label and comment to Todoist', async () => {
    const task = makeTask({ labels: '["work"]' });
    const blocked = makeTask({ status: 'blocked', labels: '["work","blocked"]', blockerNote: 'Waiting on API key' });

    (db.query.tasks.findFirst as any).mockResolvedValue(task);
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([blocked]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    await blockTask('task-1', 'Waiting on API key');

    expect(syncTaskLabels).toHaveBeenCalledWith(blocked);
    expect(addTodoistComment).toHaveBeenCalledWith('todoist-task-1', '🚫 **Blocked:** Waiting on API key');
  });
});

describe('waitTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets waiting status with waiting-for label and syncs to Todoist', async () => {
    const task = makeTask({ labels: '["work"]' });
    const waiting = makeTask({ status: 'waiting', labels: '["work","waiting-for"]', blockerNote: 'Alice to review' });

    (db.query.tasks.findFirst as any).mockResolvedValue(task);
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([waiting]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    await waitTask('task-1', 'Alice to review');

    expect(syncTaskLabels).toHaveBeenCalledWith(waiting);
    expect(addTodoistComment).toHaveBeenCalledWith('todoist-task-1', '⏳ **Waiting for:** Alice to review');
  });
});

describe('handleFire (new task)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates task in Todoist first, then locally', async () => {
    (todoist.createTask as any).mockResolvedValue({ id: 'todoist-fire-1' });

    const fireTask = makeTask({ id: 'fire-1', todoistId: 'todoist-fire-1', priority: 0, status: 'active' });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([fireTask]),
      }),
    });
    (db.query.tasks.findMany as any).mockResolvedValue([]);

    const result = await handleFire({ description: 'Server is down!' });

    expect(todoist.createTask).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Server is down!',
    }));
    expect(result.fireTask.todoistId).toBe('todoist-fire-1');
  });
});

describe('handleFire (promote existing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs priority to Todoist when promoting existing task', async () => {
    const promoted = makeTask({ priority: 0, status: 'active' });

    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([promoted]),
        }),
      }),
    });
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });
    (db.query.tasks.findMany as any).mockResolvedValue([]);

    await handleFire({ description: 'Urgent!', taskId: 'task-1' });

    expect(todoist.updateTask).toHaveBeenCalledWith('todoist-task-1', expect.objectContaining({
      priority: expect.any(Number),
    }));
  });
});
