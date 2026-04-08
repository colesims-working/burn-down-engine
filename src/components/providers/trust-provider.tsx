'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from '@/hooks/use-toast';
import type { TaskSnapshot, UndoableAction } from '@/lib/undo/engine';

// ─── Undo Stack ──────────────────────────────────────────────

const UNDO_STACK_LIMIT = 20;
const TODOIST_DEFER_MS = 5000;
const DEBOUNCE_MS = 500;

interface UndoEntry {
  id: string;
  action: UndoableAction;
  taskId: string;
  taskTitle: string;
  previousSnapshot: TaskSnapshot;
  timestamp: number;
  todoistSynced: boolean;
  deferredTimer?: ReturnType<typeof setTimeout>;
  deferredFn?: () => Promise<void>;
}

// ─── Integrity (canonical types in @/lib/types/trust, re-exported here for compat)
import type { IntegrityLevel, IntegrityIssue } from '@/lib/types/trust';
export type { IntegrityLevel, IntegrityIssue };

export interface IntegrityReport {
  level: IntegrityLevel;
  issues: IntegrityIssue[];
  checkedAt: string;
}

// ─── Context Shape ───────────────────────────────────────────

interface TrustContextValue {
  // Undo
  undoStack: UndoEntry[];
  pushUndo: (entry: Omit<UndoEntry, 'id' | 'timestamp' | 'todoistSynced'>) => void;
  popUndo: () => Promise<void>;
  isActionBusy: (taskId: string) => boolean;
  markBusy: (taskId: string) => void;

  // Inbox count (shared)
  inboxCount: number;
  refreshInboxCount: () => void;

  // Sync state
  lastSyncAt: string | null;
  syncFailures: string[];
  addSyncFailure: (msg: string) => void;
  clearSyncFailures: () => void;

  // Integrity
  integrity: IntegrityReport;
  runIntegrityCheck: () => Promise<void>;
  integrityLoading: boolean;

  // Online status
  isOnline: boolean;
}

const TrustContext = createContext<TrustContextValue | null>(null);

export function useTrust() {
  const ctx = useContext(TrustContext);
  if (!ctx) throw new Error('useTrust must be used within TrustProvider');
  return ctx;
}

// Convenience hooks
export function useUndo() {
  const { undoStack, pushUndo, popUndo, isActionBusy, markBusy } = useTrust();
  return { undoStack, pushUndo, popUndo, isActionBusy, markBusy };
}

export function useInboxCount() {
  const { inboxCount, refreshInboxCount } = useTrust();
  return { inboxCount, refreshInboxCount };
}

export function useSyncHealth() {
  const { lastSyncAt, syncFailures, addSyncFailure, clearSyncFailures } = useTrust();
  return { lastSyncAt, syncFailures, addSyncFailure, clearSyncFailures };
}

export function useIntegrity() {
  const { integrity, runIntegrityCheck, integrityLoading } = useTrust();
  return { integrity, runIntegrityCheck, integrityLoading };
}

export function useOnlineStatus() {
  const { isOnline } = useTrust();
  return isOnline;
}

// ─── Provider ────────────────────────────────────────────────

export function TrustProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // === Undo Stack ===
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;
  const [busyTasks, setBusyTasks] = useState<Map<string, number>>(new Map());

  const isActionBusy = useCallback((taskId: string) => {
    const until = busyTasks.get(taskId);
    if (!until) return false;
    return Date.now() < until;
  }, [busyTasks]);

  const markBusy = useCallback((taskId: string) => {
    setBusyTasks(prev => {
      const next = new Map(prev);
      next.set(taskId, Date.now() + DEBOUNCE_MS);
      return next;
    });
  }, []);

  const performUndo = useCallback(async (entryId: string) => {
    // Read from ref to avoid stale closure
    const target = undoStackRef.current.find(u => u.id === entryId);
    if (!target) return;

    // Cancel deferred timer if not yet synced
    if (target.deferredTimer) {
      clearTimeout(target.deferredTimer);
    }

    // Call revert API first — only remove from stack on success
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'undo',
          taskId: target.taskId,
          snapshot: target.previousSnapshot,
          undoAction: target.action,
          todoistSynced: target.todoistSynced,
        }),
      });
      if (res.ok) {
        setUndoStack(prev => prev.filter(u => u.id !== entryId));
        // Dispatch with task ID so pages can clear their removal filters
        window.dispatchEvent(new CustomEvent('task-restored', { detail: { taskId: target.taskId } }));
        window.dispatchEvent(new Event('task-changed'));
        window.dispatchEvent(new Event('inbox-changed'));
      } else {
        console.error('Undo API returned error:', res.status);
      }
    } catch (e) {
      console.error('Undo failed:', e);
    }
  }, []);

  const pushUndo = useCallback((entry: Omit<UndoEntry, 'id' | 'timestamp' | 'todoistSynced'>) => {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Start deferred Todoist sync timer
    let deferredTimer: ReturnType<typeof setTimeout> | undefined;
    if (entry.deferredFn) {
      const fn = entry.deferredFn;
      deferredTimer = setTimeout(async () => {
        try {
          await fn();
        } catch (e) {
          console.error('Deferred Todoist sync failed:', e);
        }
        // Mark as synced
        setUndoStack(prev => prev.map(u =>
          u.id === id ? { ...u, todoistSynced: true, deferredTimer: undefined } : u
        ));
      }, TODOIST_DEFER_MS);
    }

    const fullEntry: UndoEntry = {
      ...entry,
      id,
      timestamp: now,
      todoistSynced: !entry.deferredFn,
      deferredTimer,
    };

    setUndoStack(prev => [fullEntry, ...prev].slice(0, UNDO_STACK_LIMIT));

    // Show toast with undo button
    toast({
      title: undoActionLabel(entry.action),
      description: entry.taskTitle,
      duration: 10000,
      onUndo: () => performUndo(id),
    });
  }, [performUndo]);

  const popUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    await performUndo(stack[0].id);
  }, [performUndo]);

  // Ctrl+Z / Cmd+Z handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (undoStackRef.current.length > 0) {
          e.preventDefault();
          popUndo();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [popUndo]);

  // === Inbox Count (shared) ===
  const [inboxCount, setInboxCount] = useState(0);

  const refreshInboxCount = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist?action=inbox-count');
      if (res.ok) {
        const data = await res.json();
        setInboxCount(data.count || 0);
      }
    } catch {}
  }, []);

  // Fetch on route change + listen for inbox-changed events
  useEffect(() => {
    refreshInboxCount();
    const handler = () => refreshInboxCount();
    window.addEventListener('inbox-changed', handler);
    return () => window.removeEventListener('inbox-changed', handler);
  }, [pathname, refreshInboxCount]);

  // === Sync State ===
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncFailures, setSyncFailures] = useState<string[]>([]);

  const addSyncFailure = useCallback((msg: string) => {
    setSyncFailures(prev => [...prev, msg].slice(-10));
  }, []);

  const clearSyncFailures = useCallback(() => setSyncFailures([]), []);

  // Fetch sync state periodically and on focus
  const fetchSyncState = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist?action=sync-state');
      if (res.ok) {
        const data = await res.json();
        setLastSyncAt(data.lastInboxSync || data.lastFullSync || null);
      }
    } catch {}
  }, []);

  // Fetch sync state once on mount (lightweight — no sync trigger, no focus handler)
  useEffect(() => {
    fetchSyncState();
  }, [fetchSyncState]);

  // === Integrity Monitor ===
  const [integrity, setIntegrity] = useState<IntegrityReport>({
    level: 'unknown',
    issues: [],
    checkedAt: '',
  });
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const integrityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runIntegrityCheck = useCallback(async () => {
    // Togglable via Settings — skip if disabled
    if (typeof window !== 'undefined' && localStorage.getItem('integrity-check-disabled') === '1') {
      setIntegrity({ level: 'ok', issues: [], checkedAt: new Date().toISOString() });
      return;
    }
    setIntegrityLoading(true);
    try {
      const res = await fetch('/api/todoist?action=integrity-check');
      if (res.ok) {
        const data = await res.json();
        setIntegrity(data);
      }
    } catch {
      // Keep previous state
    } finally {
      setIntegrityLoading(false);
    }
  }, []);

  // Run integrity check on a lazy 15-minute background timer only.
  // No mount, no focus, no task-changed triggers — integrity is background work.
  useEffect(() => {
    integrityIntervalRef.current = setInterval(runIntegrityCheck, 15 * 60 * 1000);
    return () => {
      if (integrityIntervalRef.current) clearInterval(integrityIntervalRef.current);
    };
  }, [runIntegrityCheck]);

  // === Online Status ===
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      toast({ title: 'Back online', description: 'Connection restored.', duration: 3000 });
    };
    const goOffline = () => {
      setIsOnline(false);
      toast({ title: 'You\'re offline', description: 'Actions will fail until connection is restored.', duration: 8000 });
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Integrity re-check removed from task-changed — runs on 15min timer only.

  const value: TrustContextValue = {
    undoStack,
    pushUndo,
    popUndo,
    isActionBusy,
    markBusy,
    inboxCount,
    refreshInboxCount,
    lastSyncAt,
    syncFailures,
    addSyncFailure,
    clearSyncFailures,
    integrity,
    runIntegrityCheck,
    integrityLoading,
    isOnline,
  };

  return (
    <TrustContext.Provider value={value}>
      {children}
    </TrustContext.Provider>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function undoActionLabel(action: UndoableAction): string {
  switch (action) {
    case 'completed': return 'Task completed';
    case 'killed': return 'Task killed';
    case 'bumped': return 'Task deferred';
    case 'blocked': return 'Task blocked';
    case 'waiting': return 'Task set to waiting';
    case 'clarify_approved': return 'Clarification approved';
    case 'clarify_rejected': return 'Clarification rejected';
    default: return 'Action performed';
  }
}
