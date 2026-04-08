import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db and schema before importing the module under test
vi.mock('@/lib/db/client', () => {
  const mockDb = {
    query: {
      projects: { findFirst: vi.fn() },
      tasks: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(), onConflictDoUpdate: vi.fn() })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn() })) })) })),
  };
  return { db: mockDb, schema: { projects: {}, tasks: {}, taskHistory: {}, syncState: {} } };
});

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

import { db } from '@/lib/db/client';
import { todoist } from '@/lib/todoist/client';
import { pushTaskToTodoist, pushSubtasksToTodoist } from '@/lib/todoist/sync';

// Helper to build a minimal task for testing
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'local-task-1',
    todoistId: 'todoist-task-1',
    originalText: 'Test task',
    title: 'Clarified Test Task',
    nextAction: 'Do the thing',
    description: null,
    projectId: 'local-proj-1',
    priority: 2,
    labels: '["work"]',
    dueDate: null,
    contextNotes: 'Some context',
    status: 'clarified',
    ...overrides,
  } as any;
}

describe('pushTaskToTodoist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips push when task has no todoistId', async () => {
    const result = await pushTaskToTodoist(makeTask({ todoistId: null }));
    expect(result).toBe(false);
    expect(todoist.updateTask).not.toHaveBeenCalled();
    expect(todoist.moveTask).not.toHaveBeenCalled();
  });

  it('updates and moves task when project has a todoistId', async () => {
    const project = { id: 'local-proj-1', todoistId: 'todoist-proj-1', name: 'Claude' };
    (db.query.projects.findFirst as any).mockResolvedValue(project);
    (todoist.updateTask as any).mockResolvedValue({});
    (todoist.moveTask as any).mockResolvedValue({});
    (todoist.addComment as any).mockResolvedValue({});

    const result = await pushTaskToTodoist(makeTask());

    expect(result).toBe(true);
    expect(todoist.updateTask).toHaveBeenCalledWith('todoist-task-1', expect.objectContaining({
      content: 'Clarified Test Task',
      description: 'Do the thing',
    }));
    expect(todoist.moveTask).toHaveBeenCalledWith('todoist-task-1', { project_id: 'todoist-proj-1' });
    // Context comment only posted when status='inbox' (first push), not on subsequent syncs
    expect(todoist.addComment).not.toHaveBeenCalled();
  });

  it('creates project in Todoist when local project has no todoistId', async () => {
    const project = { id: 'local-proj-1', todoistId: null, name: 'New Project' };
    (db.query.projects.findFirst as any).mockResolvedValue(project);
    (todoist.findProjectByName as any).mockResolvedValue(null);
    (todoist.createProject as any).mockResolvedValue({ id: 'todoist-new-proj' });
    (todoist.updateTask as any).mockResolvedValue({});
    (todoist.moveTask as any).mockResolvedValue({});
    (todoist.addComment as any).mockResolvedValue({});

    // Mock db.update for storing todoistId back
    const mockWhere = vi.fn().mockReturnValue({ returning: vi.fn() });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    (db.update as any).mockReturnValue({ set: mockSet });

    await pushTaskToTodoist(makeTask());

    expect(todoist.findProjectByName).toHaveBeenCalledWith('New Project');
    expect(todoist.createProject).toHaveBeenCalledWith({ name: 'New Project' });
    expect(todoist.moveTask).toHaveBeenCalledWith('todoist-task-1', { project_id: 'todoist-new-proj' });
  });

  it('reuses existing Todoist project found by name', async () => {
    const project = { id: 'local-proj-1', todoistId: null, name: 'Existing' };
    (db.query.projects.findFirst as any).mockResolvedValue(project);
    (todoist.findProjectByName as any).mockResolvedValue({ id: 'todoist-existing' });
    (todoist.updateTask as any).mockResolvedValue({});
    (todoist.moveTask as any).mockResolvedValue({});
    (todoist.addComment as any).mockResolvedValue({});

    const mockWhere = vi.fn().mockReturnValue({ returning: vi.fn() });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    (db.update as any).mockReturnValue({ set: mockSet });

    await pushTaskToTodoist(makeTask());

    expect(todoist.createProject).not.toHaveBeenCalled();
    expect(todoist.moveTask).toHaveBeenCalledWith('todoist-task-1', { project_id: 'todoist-existing' });
  });

  it('skips move when task has no project', async () => {
    (todoist.updateTask as any).mockResolvedValue({});
    (todoist.addComment as any).mockResolvedValue({});

    await pushTaskToTodoist(makeTask({ projectId: null, contextNotes: null }));

    expect(todoist.updateTask).toHaveBeenCalled();
    expect(todoist.moveTask).not.toHaveBeenCalled();
  });

  it('skips comment when task has no contextNotes', async () => {
    (db.query.projects.findFirst as any).mockResolvedValue({ id: 'p', todoistId: 'tp', name: 'X' });
    (todoist.updateTask as any).mockResolvedValue({});
    (todoist.moveTask as any).mockResolvedValue({});

    await pushTaskToTodoist(makeTask({ contextNotes: null }));

    expect(todoist.addComment).not.toHaveBeenCalled();
  });
});

describe('pushSubtasksToTodoist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates subtasks in Todoist with parent_id', async () => {
    (todoist.createTask as any).mockResolvedValue({ id: 'todoist-sub-1' });
    const mockWhere = vi.fn().mockReturnValue({ returning: vi.fn() });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    (db.update as any).mockReturnValue({ set: mockSet });

    const subtasks = [
      makeTask({ id: 'sub-1', todoistId: null, title: 'Subtask 1', nextAction: 'Do sub 1' }),
    ];

    const count = await pushSubtasksToTodoist('parent-todoist-id', subtasks, 'proj-todoist-id');

    expect(count).toBe(1);
    expect(todoist.createTask).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Subtask 1',
      parent_id: 'parent-todoist-id',
      project_id: 'proj-todoist-id',
    }));
  });

  it('skips subtasks that already have a todoistId', async () => {
    const subtasks = [
      makeTask({ id: 'sub-1', todoistId: 'already-in-todoist', title: 'Existing' }),
    ];

    const count = await pushSubtasksToTodoist('parent-id', subtasks);

    expect(count).toBe(0);
    expect(todoist.createTask).not.toHaveBeenCalled();
  });

  it('returns count of created subtasks', async () => {
    (todoist.createTask as any).mockResolvedValue({ id: 'new-todoist-id' });
    const mockWhere = vi.fn().mockReturnValue({ returning: vi.fn() });
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    (db.update as any).mockReturnValue({ set: mockSet });

    const subtasks = [
      makeTask({ id: 'sub-1', todoistId: null, title: 'Sub 1' }),
      makeTask({ id: 'sub-2', todoistId: 'already-exists', title: 'Sub 2' }),
      makeTask({ id: 'sub-3', todoistId: null, title: 'Sub 3' }),
    ];

    const count = await pushSubtasksToTodoist('parent-id', subtasks);

    expect(count).toBe(2);
    expect(todoist.createTask).toHaveBeenCalledTimes(2);
  });
});
