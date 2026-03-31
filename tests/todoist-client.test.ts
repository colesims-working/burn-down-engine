import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must set env before importing client
vi.stubEnv('TODOIST_API_TOKEN', 'test-token-123');

// Dynamic import after env setup
const { todoist } = await import('@/lib/todoist/client');

function jsonResponse(data: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('TodoistClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('updateTask', () => {
    it('sends POST to /tasks/:id without project_id', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 'task-1', content: 'Updated' }));

      await todoist.updateTask('task-1', {
        content: 'Updated Content',
        description: 'New description',
        priority: 3,
        labels: ['work'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.todoist.com/api/v1/tasks/task-1',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        content: 'Updated Content',
        description: 'New description',
        priority: 3,
        labels: ['work'],
      });
      // CRITICAL: project_id must NOT be in update payload
      expect(body).not.toHaveProperty('project_id');
    });
  });

  describe('moveTask', () => {
    it('sends POST to /tasks/:id/move with project_id', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 'task-1' }));

      await todoist.moveTask('task-1', { project_id: 'proj-1' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.todoist.com/api/v1/tasks/task-1/move',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ project_id: 'proj-1' });
    });

    it('supports section_id and parent_id', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 'task-1' }));

      await todoist.moveTask('task-1', { section_id: 'sec-1' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ section_id: 'sec-1' });
    });
  });

  describe('createProject', () => {
    it('sends POST to /projects', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 'proj-new', name: 'Test' }));

      const result = await todoist.createProject({ name: 'Test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.todoist.com/api/v1/projects',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result).toEqual({ id: 'proj-new', name: 'Test' });
    });
  });

  describe('findProjectByName', () => {
    it('finds project by case-insensitive name match', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        results: [
          { id: 'p1', name: 'Claude', inbox_project: false },
          { id: 'p2', name: 'Work', inbox_project: false },
        ],
        next_cursor: null,
      }));

      const result = await todoist.findProjectByName('claude');
      expect(result).toEqual(expect.objectContaining({ id: 'p1', name: 'Claude' }));
    });

    it('returns null when no project matches', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        results: [
          { id: 'p1', name: 'Work', inbox_project: false },
        ],
        next_cursor: null,
      }));

      const result = await todoist.findProjectByName('Nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('addComment', () => {
    it('sends POST to /comments', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 'comment-1', content: 'Note' }));

      await todoist.addComment({ task_id: 'task-1', content: 'Note' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ task_id: 'task-1', content: 'Note' });
    });
  });

  describe('authorization', () => {
    it('includes Bearer token in all requests', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        results: [],
        next_cursor: null,
      }));

      await todoist.getProjects();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-token-123');
    });
  });

  describe('error handling', () => {
    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(todoist.getProjects()).rejects.toThrow('Todoist API error (403): Forbidden');
    });
  });

  describe('pagination', () => {
    it('follows next_cursor to fetch all pages', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          results: [{ id: 'p1', name: 'Project 1' }],
          next_cursor: 'cursor-abc',
        }))
        .mockResolvedValueOnce(jsonResponse({
          results: [{ id: 'p2', name: 'Project 2' }],
          next_cursor: null,
        }));

      const projects = await todoist.getProjects();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('Project 1');
      expect(projects[1].name).toBe('Project 2');
    });
  });
});
