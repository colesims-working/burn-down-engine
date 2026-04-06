/**
 * Offline capture queue — stores quick-adds in localStorage when offline.
 * Flushes automatically when the app comes back online.
 */

const QUEUE_KEY = 'burn-down-offline-queue';

interface QueuedCapture {
  content: string;
  priority?: number;
  dueDate?: string;
  labels?: string[];
  queuedAt: string;
}

export function queueOfflineCapture(capture: Omit<QueuedCapture, 'queuedAt'>): void {
  const queue = getOfflineQueue();
  queue.push({ ...capture, queuedAt: new Date().toISOString() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getOfflineQueue(): QueuedCapture[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearOfflineQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

/**
 * Flush queued captures to the server. Call on page load or online event.
 * Returns number of items successfully flushed.
 */
export async function flushOfflineQueue(): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let flushed = 0;
  const remaining: QueuedCapture[] = [];

  for (const capture of queue) {
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quick-add',
          content: capture.content,
          ...(capture.priority ? { priority: capture.priority } : {}),
          ...(capture.dueDate ? { due_date: capture.dueDate } : {}),
          ...(capture.labels ? { labels: capture.labels } : {}),
        }),
      });
      if (res.ok) flushed++;
      else remaining.push(capture);
    } catch {
      remaining.push(capture);
    }
  }

  if (remaining.length > 0) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } else {
    clearOfflineQueue();
  }

  return flushed;
}
