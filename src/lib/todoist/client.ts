const TODOIST_API_BASE = 'https://api.todoist.com/rest/v2';

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  order: number;
  priority: number; // 1=none, 2=low, 3=med, 4=high
  due: {
    date: string;
    string: string;
    recurring: boolean;
    datetime?: string;
  } | null;
  labels: string[];
  is_completed: boolean;
  created_at: string;
  url: string;
}

interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  order: number;
  is_favorite: boolean;
  is_inbox_project: boolean;
  view_style: string;
  url: string;
}

interface TodoistLabel {
  id: string;
  name: string;
  color: string;
  order: number;
  is_favorite: boolean;
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

  // ─── Tasks ──────────────────────────────────────────────────

  async getTasks(params?: {
    project_id?: string;
    filter?: string;
    label?: string;
  }): Promise<TodoistTask[]> {
    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.set('project_id', params.project_id);
    if (params?.filter) searchParams.set('filter', params.filter);
    if (params?.label) searchParams.set('label', params.label);

    const query = searchParams.toString();
    return this.request<TodoistTask[]>(`/tasks${query ? `?${query}` : ''}`);
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
    project_id?: string;
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

  async completeTask(id: string): Promise<void> {
    await this.request(`/tasks/${id}/close`, { method: 'POST' });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request(`/tasks/${id}`, { method: 'DELETE' });
  }

  // ─── Projects ───────────────────────────────────────────────

  async getProjects(): Promise<TodoistProject[]> {
    return this.request<TodoistProject[]>('/projects');
  }

  async getProject(id: string): Promise<TodoistProject> {
    return this.request<TodoistProject>(`/projects/${id}`);
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

  // ─── Labels ─────────────────────────────────────────────────

  async getLabels(): Promise<TodoistLabel[]> {
    return this.request<TodoistLabel[]>('/labels');
  }

  async createLabel(data: { name: string; color?: string }): Promise<TodoistLabel> {
    return this.request<TodoistLabel>('/labels', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ─── Comments ───────────────────────────────────────────────

  async getComments(taskId: string): Promise<TodoistComment[]> {
    return this.request<TodoistComment[]>(`/comments?task_id=${taskId}`);
  }

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

  async getInboxProject(): Promise<TodoistProject> {
    const projects = await this.getProjects();
    const inbox = projects.find(p => p.is_inbox_project);
    if (!inbox) throw new Error('Inbox project not found');
    return inbox;
  }

  async getInboxTasks(): Promise<TodoistTask[]> {
    const inbox = await this.getInboxProject();
    return this.getTasks({ project_id: inbox.id });
  }

  async getTodayTasks(): Promise<TodoistTask[]> {
    return this.getTasks({ filter: 'today | overdue' });
  }
}

export const todoist = new TodoistClient();
export type { TodoistTask, TodoistProject, TodoistLabel, TodoistComment };
