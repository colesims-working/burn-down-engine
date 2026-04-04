'use client';

import React, { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldX, Loader2, RefreshCw, X, ArrowRight, Inbox, Sparkles, Check } from 'lucide-react';
import { useIntegrity, useSyncHealth } from '@/components/providers/trust-provider';
import { cn } from '@/lib/utils';
import type { IntegrityIssue } from '@/components/providers/trust-provider';

export function HealthIndicator({ compact = false }: { compact?: boolean }) {
  const { integrity, runIntegrityCheck, integrityLoading } = useIntegrity();
  const { lastSyncAt, syncFailures, clearSyncFailures } = useSyncHealth();
  const [panelOpen, setPanelOpen] = useState(false);
  const [conflictIssue, setConflictIssue] = useState<IntegrityIssue | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  const resolveConflict = async (choice: 'local' | 'todoist') => {
    if (!conflictIssue?.taskId || !conflictIssue.conflict) return;
    setResolvingConflict(true);
    try {
      if (choice === 'todoist') {
        // Accept Todoist's value — update local title
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-task',
            taskId: conflictIssue.taskId,
            data: { [conflictIssue.conflict.field]: conflictIssue.conflict.todoistValue },
          }),
        });
      }
      // If 'local', keep local value — push it to Todoist on next sync
      // In both cases, bump todoistSyncedAt to suppress the conflict
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-task',
          taskId: conflictIssue.taskId,
          data: {}, // just bumps updatedAt
        }),
      });
      setConflictIssue(null);
      await runIntegrityCheck();
    } catch (e) {
      console.error('Conflict resolution failed:', e);
    } finally {
      setResolvingConflict(false);
    }
  };

  // Close on Escape key
  React.useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panelOpen]);

  const level = syncFailures.length > 0 ? 'error' : integrity.level;
  const totalIssues = integrity.issues.length + syncFailures.length;

  const dotColor = {
    ok: 'bg-green-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400',
    unknown: 'bg-muted-foreground/40',
  }[level];

  const Icon = {
    ok: ShieldCheck,
    warning: ShieldAlert,
    error: ShieldX,
    unknown: Shield,
  }[level];

  const statusLabel = {
    ok: 'All clear',
    warning: totalIssues > 50 ? 'Attention needed' : `${totalIssues} warning${totalIssues !== 1 ? 's' : ''}`,
    error: totalIssues > 50 ? 'Attention needed' : `${totalIssues} issue${totalIssues !== 1 ? 's' : ''}`,
    unknown: 'Checking...',
  }[level];

  const handleResolve = async (issue: IntegrityIssue) => {
    switch (issue.resolution.action) {
      case 'clarify':
        if (issue.taskId) window.location.href = `/clarify?taskIds=${issue.taskId}`;
        break;
      case 'review':
        window.location.href = '/engage';
        break;
      case 'import':
        // Trigger a full sync to import the missing task
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync-all' }),
        });
        await runIntegrityCheck();
        break;
      case 'complete':
        if (issue.taskId) {
          await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'complete', taskId: issue.taskId }),
          });
          await runIntegrityCheck();
        }
        break;
      case 'retry':
        await runIntegrityCheck();
        break;
      case 'resolve_conflict':
        if (issue.taskId && issue.conflict) {
          setConflictIssue(issue);
        }
        break;
    }
  };

  const syncAgo = lastSyncAt
    ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000)
    : null;
  const syncLabel = syncAgo === null
    ? 'Never synced'
    : syncAgo < 1 ? 'Synced just now' : `Synced ${syncAgo}m ago`;

  return (
    <div className="relative">
      <button
        onClick={() => setPanelOpen(!panelOpen)}
        title={`System health: ${statusLabel}. ${syncLabel}`}
        className={cn(
          'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent',
          compact && 'p-1.5',
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', dotColor)} />
        {!compact && (
          <span className="text-muted-foreground">{statusLabel}</span>
        )}
      </button>

      {panelOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)} />

          {/* Panel */}
          <div className={cn(
            'absolute top-full z-50 mt-1 w-80 rounded-xl border border-border bg-card p-4 shadow-xl sm:w-96',
            compact ? 'right-0' : 'left-0',
          )}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4', level === 'ok' ? 'text-green-400' : level === 'warning' ? 'text-amber-400' : level === 'error' ? 'text-red-400' : 'text-muted-foreground')} />
                <span className="text-sm font-semibold">System Health</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => runIntegrityCheck()}
                  disabled={integrityLoading}
                  title="Re-check integrity"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                >
                  {integrityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Sync status */}
            <div className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              {syncLabel}
              {integrity.checkedAt && (
                <span className="ml-2">
                  · Checked {Math.floor((Date.now() - new Date(integrity.checkedAt).getTime()) / 60000)}m ago
                </span>
              )}
            </div>

            {/* Sync failures */}
            {syncFailures.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-red-400">Sync Failures</span>
                  <button
                    onClick={clearSyncFailures}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Clear all
                  </button>
                </div>
                {syncFailures.map((msg, i) => (
                  <div key={i} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 mb-1">
                    {msg}
                  </div>
                ))}
              </div>
            )}

            {/* Issues */}
            {integrity.issues.length === 0 && syncFailures.length === 0 ? (
              <div className="py-4 text-center">
                <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-green-400/60" />
                <p className="text-sm font-medium text-green-400">All clear</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  All tasks are in sync. Nothing has fallen through the cracks.
                </p>
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {integrity.issues.map((issue, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <IssueIcon type={issue.type} />
                      <span className="flex-1 text-xs font-medium truncate">{issue.title}</span>
                    </div>
                    <p className="mb-2 text-[11px] text-muted-foreground">{issue.detail}</p>
                    <button
                      onClick={() => handleResolve(issue)}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30"
                    >
                      {issue.resolution.label}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Conflict Resolution Dialog */}
      {conflictIssue && conflictIssue.conflict && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50" onClick={() => !resolvingConflict && setConflictIssue(null)} />
          <div className="fixed left-1/2 top-1/2 z-[61] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="mb-1 text-sm font-semibold">Sync Conflict</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              This task was edited in both Burn-Down and Todoist since the last sync.
            </p>
            <div className="mb-4 space-y-2">
              <button
                onClick={() => resolveConflict('local')}
                disabled={resolvingConflict}
                className="flex w-full flex-col rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
              >
                <span className="text-xs font-medium text-primary">Keep mine (Burn-Down)</span>
                <span className="mt-1 text-xs text-muted-foreground truncate">{conflictIssue.conflict.localValue}</span>
              </button>
              <button
                onClick={() => resolveConflict('todoist')}
                disabled={resolvingConflict}
                className="flex w-full flex-col rounded-lg border border-border p-3 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/5 disabled:opacity-50"
              >
                <span className="text-xs font-medium text-amber-400">Use Todoist&apos;s</span>
                <span className="mt-1 text-xs text-muted-foreground truncate">{conflictIssue.conflict.todoistValue}</span>
              </button>
            </div>
            <button
              onClick={() => setConflictIssue(null)}
              disabled={resolvingConflict}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Skip for now
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function IssueIcon({ type }: { type: IntegrityIssue['type'] }) {
  switch (type) {
    case 'missing_locally': return <Inbox className="h-3 w-3 text-red-400" />;
    case 'missing_in_todoist': return <ShieldX className="h-3 w-3 text-red-400" />;
    case 'status_mismatch': return <ShieldAlert className="h-3 w-3 text-amber-400" />;
    case 'stale_inbox': return <Sparkles className="h-3 w-3 text-amber-400" />;
    case 'stale_active': return <Check className="h-3 w-3 text-amber-400" />;
  }
}
