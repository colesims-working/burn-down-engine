import { toast } from '@/hooks/use-toast';

/**
 * Standardized API mutation helper. Handles:
 * - Offline detection (shows toast, skips fetch)
 * - Error handling with user-visible feedback
 * - syncWarning reporting
 * - task-changed / inbox-changed event dispatch
 *
 * Returns the parsed JSON response on success, or null on failure.
 */
export async function mutate<T = unknown>(
  action: string,
  body: Record<string, unknown>,
  opts: {
    /** If true, dispatch 'task-changed' event after success */
    taskChanged?: boolean;
    /** If true, dispatch 'inbox-changed' event after success */
    inboxChanged?: boolean;
    /** Called with syncWarning string if the server response includes one */
    onSyncWarning?: (msg: string) => void;
    /** Suppress the default error toast (caller handles errors themselves) */
    silent?: boolean;
    /** Custom error message prefix */
    errorLabel?: string;
  } = {},
): Promise<T | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (!opts.silent) {
      toast({ title: 'You\'re offline', description: 'This action requires a network connection.', duration: 4000 });
    }
    return null;
  }

  try {
    const res = await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });

    if (!res.ok) {
      if (!opts.silent) {
        const label = opts.errorLabel || 'Action failed';
        toast({ title: label, description: `Server returned ${res.status}. Try again.`, duration: 5000 });
      }
      return null;
    }

    const data = await res.json() as T & { syncWarning?: string };

    if (data.syncWarning && opts.onSyncWarning) {
      opts.onSyncWarning(data.syncWarning);
    }

    if (opts.taskChanged) {
      window.dispatchEvent(new Event('task-changed'));
    }
    if (opts.inboxChanged) {
      window.dispatchEvent(new Event('inbox-changed'));
    }

    return data;
  } catch {
    if (!opts.silent) {
      toast({ title: 'Network error', description: 'Could not connect to the server.', duration: 5000 });
    }
    return null;
  }
}

/**
 * Standardized API fetch helper for GET requests.
 * Returns parsed JSON on success, or null on failure.
 */
export async function query<T = unknown>(
  action: string,
  params?: Record<string, string>,
  opts: { silent?: boolean; errorLabel?: string } = {},
): Promise<T | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (!opts.silent) {
      toast({ title: 'You\'re offline', description: 'Cannot load data without a connection.', duration: 4000 });
    }
    return null;
  }

  const searchParams = new URLSearchParams({ action, ...params });
  try {
    const res = await fetch(`/api/todoist?${searchParams.toString()}`);
    if (!res.ok) {
      if (!opts.silent) {
        toast({ title: opts.errorLabel || 'Failed to load', description: `Server returned ${res.status}.`, duration: 5000 });
      }
      return null;
    }
    return await res.json() as T;
  } catch {
    if (!opts.silent) {
      toast({ title: 'Network error', description: 'Could not connect to the server.', duration: 5000 });
    }
    return null;
  }
}
