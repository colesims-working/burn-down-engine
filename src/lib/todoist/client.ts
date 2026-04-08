const TODOIST_API_BASE = 'https://api.todoist.com/api/v1';

// v1 paginated response wrapper
interface PaginatedResponse<T> {
  results: T[];
  next_cursor: string | null;
}

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  child_order: number;
  priority: number; // 1=none, 2=low, 3=med, 4=high
  due: {
    date: string;
    string: string;
    is_recurring: boolean;
    datetime?: string;
  } | null;
  labels: string[];
  checked: boolean;
  is_completed: boolean;
  added_at: string;
}

interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  child_order: number;
  is_favorite: boolean;
  inbox_project?: boolean;
  view_style: string;
}

interface TodoistComment {
  id: string;
  task_id?: string;
  project_id?: string;
  content: string;
  posted_at: string;
}

class TodoistClient {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.TODOIST_API_TOKEN || '';
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${TODOIST_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Todoist API error (${response.status}): ${error}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  /** Collect all pages from a v1 paginated endpoint into a flat array. */
  private async fetchAllPages<T>(endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let url = endpoint;

    while (url) {
      const page = await this.request<PaginatedResponse<T>>(url);
      results.push(...page.results);
      if (!page.next_cursor) break;
      // Build next URL by replacing/adding cursor param properly
      const [basePath, queryString] = endpoint.split('?');
      const params = new URLSearchParams(queryString || '');
      params.set('cursor', page.next_cursor);
      url = `${basePath}?${params.toString()}`;
    }

    return results;
  }

  // ─── Tasks ──────────────────────────────────────────────────

  async getTasks(params?: {
    project_id?: string;
    filter?: string;
    label?: string;
  }): Promise<TodoistTask[]> {
    // v1 moved filter queries to a separate endpoint
    if (params?.filter) {
      return this.fetchAllPages<TodoistTask>(
        `/tasks/filter?query=${encodeURIComponent(params.filter)}`
      );
    }

    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.set('project_id', params.project_id);
    if (params?.label) searchParams.set('label', params.label);
    searchParams.set('limit', '200');

    const query = searchParams.toString();
    return this.fetchAllPages<TodoistTask>(`/tasks?${query}`);
  }

  async getTask(id: string): Promise<TodoistTask> {
    return this.request<TodoistTask>(`/tasks/${id}`);
  }

  async createTask(data: {
    content: string;
    description?: string;
    project_id?: string;
    priority?: number;
    due_date?: string;
    due_string?: string;
    labels?: string[];
    parent_id?: string;
  }): Promise<TodoistTask> {
    return this.request<TodoistTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTask(id: string, data: {
    content?: string;
    description?: string;
    priority?: number;
    due_date?: string;
    due_string?: string;
    labels?: string[];
  }): Promise<TodoistTask> {
    return this.request<TodoistTask>(`/tasks/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async moveTask(id: string, target: {
    project_id?: string;
    section_id?: string;
    parent_id?: string;
  }): Promise<TodoistTask> {
    return this.request<TodoistTask>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify(target),
    });
  }

  async completeTask(id: string): Promise<void> {
    await this.request(`/tasks/${id}/close`, { method: 'POST' });
  }

  async reopenTask(id: string): Promise<void> {
    await this.request(`/tasks/${id}/reopen`, { method: 'POST' });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request(`/tasks/${id}`, { method: 'DELETE' });
  }

  // ─── Projects ───────────────────────────────────────────────

  async getProjects(): Promise<TodoistProject[]> {
    return this.fetchAllPages<TodoistProject>('/projects?limit=200');
  }

  async createProject(data: {
    name: string;
    parent_id?: string;
    color?: string;
    is_favorite?: boolean;
  }): Promise<TodoistProject> {
    return this.request<TodoistProject>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: string, data: {
    name?: string;
    color?: string;
    is_favorite?: boolean;
  }): Promise<TodoistProject> {
    return this.request<TodoistProject>(`/projects/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/projects/${id}`, { method: 'DELETE' });
  }

  async archiveProject(id: string): Promise<void> {
    // The REST API v1 doesn't support archive directly.
    // Use the Sync API to archive.
    const commandUuid = crypto.randomUUID();
    const res = await fetch('https://api.todoist.com/sync/v9/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: [{ type: 'project_archive', uuid: commandUuid, args: { id } }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Todoist archive failed: ${res.status} ${res.statusText}`);
    }
    // Sync API returns 200 even on command failure — check sync_status
    const data = await res.json();
    const commandStatus = data?.sync_status?.[commandUuid];
    if (commandStatus && commandStatus !== 'ok') {
      throw new Error(`Todoist archive command failed: ${JSON.stringify(commandStatus)}`);
    }
  }

  // ─── Comments ───────────────────────────────────────────────

  async addComment(data: {
    task_id: string;
    content: string;
  }): Promise<TodoistComment> {
    return this.request<TodoistComment>('/comments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ─── Helpers ────────────────────────────────────────────────

  private cachedInboxId: string | null = null;

  async getInboxProject(): Promise<TodoistProject> {
    const projects = await this.getProjects();
    const inbox = projects.find(p => p.inbox_project);
    if (!inbox) throw new Error('Inbox project not found');
    this.cachedInboxId = inbox.id;
    return inbox;
  }

  async getInboxTasks(): Promise<TodoistTask[]> {
    if (this.cachedInboxId) {
      return this.getTasks({ project_id: this.cachedInboxId });
    }
    const inbox = await this.getInboxProject();
    return this.getTasks({ project_id: inbox.id });
  }

  async findProjectByName(name: string): Promise<TodoistProject | null> {
    const projects = await this.getProjects();
    return projects.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
  }
}

export const todoist = new TodoistClient();
export type { TodoistTask, TodoistProject, TodoistComment };
