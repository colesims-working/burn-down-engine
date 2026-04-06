/**
 * Shared trust/integrity types used by trust-provider, health-indicator,
 * and the API route. Extracted to avoid importing from a React component.
 */

export type IntegrityLevel = 'ok' | 'warning' | 'error' | 'unknown';

export interface IntegrityIssue {
  type: 'missing_locally' | 'missing_in_todoist' | 'status_mismatch' | 'stale_inbox' | 'stale_active' | 'sync_conflict';
  taskId?: string;
  todoistId?: string;
  title: string;
  detail: string;
  resolution: { label: string; action: string };
  conflict?: {
    field: string;
    localValue: string;
    todoistValue: string;
  };
}
