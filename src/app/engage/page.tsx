'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Zap, Check, ArrowRight, Ban, Flame, ChevronDown, Clock, RotateCcw, Filter } from 'lucide-react';
import { PriorityBadge, EnergyBadge, TimeEstimate, ProjectBadge, PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useUndo, useSyncHealth } from '@/components/providers/trust-provider';
import { toast } from '@/hooks/use-toast';
import { snapshotTask } from '@/lib/undo/engine';
import type { TaskSnapshot } from '@/lib/undo/engine';

const CONTEXTS = [
  { value: 'all', label: 'All', icon: '📋' },
  { value: '@computer', label: '@computer', icon: '💻' },
  { value: '@calls', label: '@calls', icon: '📞' },
  { value: '@office', label: '@office', icon: '🏢' },
  { value: '@home', label: '@home', icon: '🏠' },
  { value: '@errands', label: '@errands', icon: '🚗' },
  { value: '@waiting', label: '@waiting', icon: '⏳' },
] as const;

interface Task {
  id: string;
  title: string;
  nextAction: string | null;
  priority: number | null;
  energyLevel: string | null;
  timeEstimateMin: number | null;
  labels: string | null;
  contextNotes: string | null;
  bumpCount: number | null;
  status: string | null;
  blockerNote: string | null;
  projectId: string | null;
}

interface EngageData {
  fires: Task[];
  mustDo: Task[];
  shouldDo: Task[];
  thisWeek: Task[];
  waiting: Task[];
  completed: Task[];
}

export default function EngagePage() {
  const [data, setData] = useState<EngageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fireModal, setFireModal] = useState(false);
  const [fireText, setFireText] = useState('');
  const [blockModal, setBlockModal] = useState<string | null>(null);
  const [blockerText, setBlockerText] = useState('');
  const [antiPileUpTask, setAntiPileUpTask] = useState<Task | null>(null);
  const [antiPileUpChoice, setAntiPileUpChoice] = useState<'promote' | 'delegate' | 'kill' | 'schedule' | null>(null);
  const [antiPileUpDate, setAntiPileUpDate] = useState('');
  const [contextFilter, setContextFilter] = useState<string>('all');
  const [focusIndex, setFocusIndex] = useState(0);

  const { pushUndo, isActionBusy, markBusy } = useUndo();
  const { addSyncFailure } = useSyncHealth();

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist?action=engage');
      if (res.ok) {
        setData(await res.json());
      } else {
        toast({ title: 'Failed to load tasks', description: 'Could not fetch your task list. Try refreshing.', duration: 5000 });
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not connect to the server.', duration: 5000 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Listen for undo/task-changed events to refresh
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('task-changed', handler);
    return () => window.removeEventListener('task-changed', handler);
  }, [fetchData]);

  // Helper: optimistically remove a task from the engage data
  const removeTaskOptimistic = useCallback((taskId: string) => {
    setData(prev => {
      if (!prev) return prev;
      const remove = (arr: Task[]) => arr.filter(t => t.id !== taskId);
      return {
        ...prev,
        fires: remove(prev.fires),
        mustDo: remove(prev.mustDo),
        shouldDo: remove(prev.shouldDo),
        thisWeek: remove(prev.thisWeek),
        waiting: remove(prev.waiting),
      };
    });
  }, []);

  // Helper: find task and build snapshot from current in-memory data
  const findTaskAndSnapshot = useCallback((taskId: string) => {
    const allTasks = data ? [...data.fires, ...data.mustDo, ...data.shouldDo, ...data.thisWeek, ...data.waiting] : [];
    const task = allTasks.find(t => t.id === taskId);
    const snapshot: TaskSnapshot | null = task ? {
      status: task.status, priority: task.priority, dueDate: null,
      bumpCount: task.bumpCount, labels: task.labels, blockerNote: task.blockerNote,
      completedAt: null, todoistId: null,
    } : null;
    return { task, snapshot };
  }, [data]);

  const handleComplete = useCallback(async (taskId: string) => {
    if (isActionBusy(taskId)) return;
    markBusy(taskId);

    const { task, snapshot } = findTaskAndSnapshot(taskId);
    const prevData = data;

    // Optimistic: remove immediately
    removeTaskOptimistic(taskId);

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', taskId }),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.syncWarning) addSyncFailure(result.syncWarning);
        if (snapshot && task) {
          pushUndo({ action: 'completed', taskId, taskTitle: task.title, previousSnapshot: snapshot });
        }
        window.dispatchEvent(new Event('task-changed'));
      } else {
        // Revert on failure
        setData(prevData);
        toast({ title: 'Complete failed', description: 'Could not complete the task. Try again.', duration: 5000 });
      }
    } catch {
      setData(prevData);
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 5000 });
    }
  }, [fetchData, data, pushUndo, isActionBusy, markBusy, addSyncFailure, findTaskAndSnapshot, removeTaskOptimistic]);

  const handleDefer = useCallback(async (taskId: string) => {
    if (isActionBusy(taskId)) return;
    markBusy(taskId);

    const { task, snapshot } = findTaskAndSnapshot(taskId);
    const prevData = data;

    // Optimistic: remove from active lists
    removeTaskOptimistic(taskId);

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'defer', taskId }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.syncWarning) addSyncFailure(result.syncWarning);
        if (result.antiPileUp) {
          setAntiPileUpTask(result);
          setAntiPileUpChoice(null);
          setAntiPileUpDate('');
        }
        if (snapshot && task) {
          pushUndo({ action: 'bumped', taskId, taskTitle: task.title, previousSnapshot: snapshot });
        }
        window.dispatchEvent(new Event('task-changed'));
      } else {
        setData(prevData);
        toast({ title: 'Defer failed', description: 'Could not defer the task. Try again.', duration: 5000 });
      }
    } catch {
      setData(prevData);
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 5000 });
    }
  }, [fetchData, data, pushUndo, isActionBusy, markBusy, addSyncFailure, findTaskAndSnapshot, removeTaskOptimistic]);

  const handleBlock = async (taskId: string) => {
    if (isActionBusy(taskId)) return;
    markBusy(taskId);

    const { task, snapshot } = findTaskAndSnapshot(taskId);
    const prevData = data;

    // Optimistic: remove from active lists
    removeTaskOptimistic(taskId);
    setBlockModal(null);
    setBlockerText('');

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'block', taskId, blockerNote: blockerText }),
      });

      if (res.ok && snapshot && task) {
        pushUndo({ action: 'blocked', taskId, taskTitle: task.title, previousSnapshot: snapshot });
        window.dispatchEvent(new Event('task-changed'));
      } else if (!res.ok) {
        setData(prevData);
        toast({ title: 'Block failed', description: 'Could not block the task. Try again.', duration: 5000 });
      }
    } catch {
      setData(prevData);
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 5000 });
    }
  };

  const handleFire = async () => {
    if (!fireText.trim()) return;
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fire', description: fireText }),
      });
      if (res.ok) {
        setFireModal(false);
        setFireText('');
        window.dispatchEvent(new Event('task-changed'));
        await fetchData();
      } else {
        toast({ title: 'Fire creation failed', description: 'Could not create the urgent task.', duration: 5000 });
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 5000 });
    }
  };

  const handleAntiPileUpDecision = async () => {
    if (!antiPileUpTask || !antiPileUpChoice) return;
    const taskId = antiPileUpTask.id;

    try {
      const actions: Record<string, () => Promise<Response>> = {
        promote: () => fetch('/api/todoist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-task', taskId, data: { priority: 1, status: 'active', dueDate: null } }),
        }),
        kill: () => fetch('/api/todoist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill', taskId }),
        }),
        schedule: () => fetch('/api/todoist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-task', taskId, data: { dueDate: antiPileUpDate, status: 'active' } }),
        }),
        delegate: () => fetch('/api/todoist', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'block', taskId, blockerNote: 'Delegated — awaiting handoff' }),
        }),
      };

      if (antiPileUpChoice === 'schedule' && !antiPileUpDate) return;
      const res = await actions[antiPileUpChoice]();
      if (!res.ok) {
        toast({ title: 'Decision failed', description: 'Could not apply the anti-pile-up decision.', duration: 5000 });
        return;
      }
      window.dispatchEvent(new Event('task-changed'));
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 5000 });
      return;
    }

    setAntiPileUpTask(null);
    setAntiPileUpChoice(null);
    setAntiPileUpDate('');
    await fetchData();
  };

  // Context filtering — safe to call even when data is null
  const filterByContext = useCallback((tasks: Task[]) => {
    if (contextFilter === 'all') return tasks;
    return tasks.filter(t => {
      const labels = t.labels?.toLowerCase() || '';
      const notes = t.contextNotes?.toLowerCase() || '';
      const ctx = contextFilter.toLowerCase();
      return labels.includes(ctx) || notes.includes(ctx) || labels.includes(ctx.replace('@', ''));
    });
  }, [contextFilter]);

  const allActive = data ? [...data.fires, ...data.mustDo, ...data.shouldDo] : [];
  const filteredActive = filterByContext(allActive);
  const nextTasks = useMemo(() => filteredActive.slice(0, 10), [filteredActive]);

  // Keyboard navigation — must be before early return to maintain hook order
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (nextTasks.length === 0) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusIndex(prev => Math.min(prev + 1, nextTasks.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'c':
          if (nextTasks[focusIndex]) {
            e.preventDefault();
            handleComplete(nextTasks[focusIndex].id);
          }
          break;
        case 'd':
          if (nextTasks[focusIndex]) {
            e.preventDefault();
            handleDefer(nextTasks[focusIndex].id);
          }
          break;
        case 'b':
          if (nextTasks[focusIndex]) {
            e.preventDefault();
            setBlockModal(nextTasks[focusIndex].id);
          }
          break;
        case 'f':
          e.preventDefault();
          setFireModal(true);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextTasks, focusIndex, handleComplete, handleDefer]);

  if (loading || !data) {
    return (
      <div>
        <PageHeader title="Engage" description="Your prioritized action list" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />)}
        </div>
      </div>
    );
  }

  const totalPlanned = data.mustDo.length + data.shouldDo.length + data.fires.length;
  const completedCount = data.completed.length;
  const progress = totalPlanned > 0 ? completedCount / (completedCount + totalPlanned) : 0;

  const nextTask = nextTasks[0];

  return (
    <div>
      <PageHeader
        title="Engage"
        description="Execute. One task at a time."
        action={
          <button
            onClick={() => setFireModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Flame className="h-4 w-4" />
            Urgent Interrupt
          </button>
        }
      />

      {/* Progress */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <span className="text-sm font-medium text-muted-foreground" title={`${completedCount} of ${completedCount + totalPlanned} tasks completed today`}>
          {completedCount}/{completedCount + totalPlanned} done
        </span>
      </div>

      {/* Context Filter */}
      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex items-center gap-2 pb-1 sm:flex-wrap sm:pb-0">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          {CONTEXTS.map(ctx => (
            <button
              key={ctx.value}
              onClick={() => { setContextFilter(ctx.value); setFocusIndex(0); }}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:py-1',
                contextFilter === ctx.value
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-muted-foreground hover:bg-accent',
              )}
            >
              <span>{ctx.icon}</span> {ctx.label}
            </button>
          ))}
          {contextFilter !== 'all' && (
            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
              {filteredActive.length} task{filteredActive.length !== 1 ? 's' : ''} in context
            </span>
          )}
        </div>
      </div>

      {/* Next Up — Top 5 Tasks */}
      {nextTasks.length > 0 && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
              ► Next Up ({nextTasks.length} of {filteredActive.length})
            </span>
            <span className="hidden text-[10px] text-muted-foreground/60 sm:block">
              j/k navigate · c complete · d defer · b block · f urgent
            </span>
          </div>
          {nextTasks.map((task, i) => (
            <div
              key={task.id}
              className={cn(
                'rounded-xl border-2 p-3 transition-all sm:p-4',
                i === focusIndex
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/50 bg-card',
                i === 0 && focusIndex === 0 && 'ring-1 ring-primary/20',
              )}
            >
              <div className="flex items-start gap-3">
                <PriorityBadge priority={task.priority || 4} size={i === 0 ? 'md' : 'sm'} />
                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm font-semibold', i === 0 && 'text-base')}>{task.title}</div>
                  {task.nextAction && (
                    <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{task.nextAction}</div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <EnergyBadge level={task.energyLevel} />
                    <TimeEstimate minutes={task.timeEstimateMin} />
                    {task.labels && (() => {
                      try {
                        const parsed = JSON.parse(task.labels);
                        if (Array.isArray(parsed)) return parsed.map((l: string) => (
                          <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            @{l}
                          </span>
                        ));
                      } catch {}
                      return (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {task.labels}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                {/* Desktop action buttons */}
                <div className="hidden shrink-0 gap-1.5 sm:flex">
                  <button
                    onClick={() => handleComplete(task.id)}
                    aria-label={`Complete: ${task.title}`}
                    className="rounded-lg bg-green-500/20 px-2.5 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDefer(task.id)}
                    aria-label={`Defer: ${task.title}`}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setBlockModal(task.id)}
                    aria-label={`Block: ${task.title}`}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {/* Mobile action buttons — full-width row */}
              <div className="mt-3 flex gap-2 sm:hidden">
                <button
                  onClick={() => handleComplete(task.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-500/20 py-2.5 text-xs font-medium text-green-400 transition-colors active:bg-green-500/30"
                >
                  <Check className="h-4 w-4" />
                  Done
                </button>
                <button
                  onClick={() => handleDefer(task.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors active:bg-accent"
                >
                  <ArrowRight className="h-4 w-4" />
                  Defer
                </button>
                <button
                  onClick={() => setBlockModal(task.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors active:bg-accent"
                >
                  <Ban className="h-4 w-4" />
                  Block
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Task Queue */}
      <div className="space-y-6">
        {/* Fires */}
        {filterByContext(data.fires).length > 0 && (
          <TaskSection title="🔥 Fires" tasks={filterByContext(data.fires)} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* Must Do */}
        {filterByContext(data.mustDo).length > 0 && (
          <TaskSection title="🎯 Must Do" tasks={filterByContext(data.mustDo).slice(nextTask && filterByContext(data.fires).length === 0 ? 1 : 0)} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* Should Do */}
        {filterByContext(data.shouldDo).length > 0 && (
          <TaskSection title="📋 Should Do" tasks={filterByContext(data.shouldDo)} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* This Week */}
        {filterByContext(data.thisWeek).length > 0 && (
          <TaskSection title="📌 This Week" tasks={filterByContext(data.thisWeek)} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} muted />
        )}

        {/* Waiting / Blocked */}
        {data.waiting.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              ⏳ Waiting / Blocked ({data.waiting.length})
            </h3>
            <div className="space-y-1">
              {data.waiting.map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="flex-1">{t.title}</span>
                  {t.blockerNote && <span className="text-xs italic">({t.blockerNote})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Today */}
        {data.completed.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-400/70">
              ✅ Completed Today ({data.completed.length})
            </h3>
            <div className="space-y-1">
              {data.completed.map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground line-through">
                  <Check className="h-3.5 w-3.5 text-green-400" />
                  {t.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Fire Modal */}
      <Dialog open={fireModal} onOpenChange={(open) => { if (!open) { setFireModal(false); setFireText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-destructive" />
              Urgent Interrupt
            </DialogTitle>
            <DialogDescription>
              Describe the urgent task. The lowest-priority P2 task will be deferred to tomorrow to make room.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={fireText}
            onChange={(e) => setFireText(e.target.value)}
            placeholder="Describe the fire..."
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-destructive focus:outline-none"
          />
          <DialogFooter>
            <button
              onClick={() => { setFireModal(false); setFireText(''); }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleFire}
              disabled={!fireText.trim()}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              Insert Fire + Bump
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block Modal */}
      <Dialog open={!!blockModal} onOpenChange={(open) => { if (!open) { setBlockModal(null); setBlockerText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What&apos;s blocking this?</DialogTitle>
          </DialogHeader>
          <input
            value={blockerText}
            onChange={(e) => setBlockerText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && blockModal && handleBlock(blockModal)}
            placeholder="Waiting on..."
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <DialogFooter>
            <button
              onClick={() => { setBlockModal(null); setBlockerText(''); }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => blockModal && handleBlock(blockModal)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Mark Blocked
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anti-Pile-Up Modal */}
      <Dialog open={!!antiPileUpTask} onOpenChange={(open) => { if (!open) { setAntiPileUpTask(null); setAntiPileUpChoice(null); setAntiPileUpDate(''); } }}>
        <DialogContent className="border-amber-500/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              ⚠️ Anti-Pile-Up Check
            </DialogTitle>
            <DialogDescription>
              &ldquo;{antiPileUpTask?.title}&rdquo; has been bumped {antiPileUpTask?.bumpCount} times. Decision time:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {([
              { value: 'promote' as const, label: 'Do it now', desc: 'Promote to P1 today' },
              { value: 'delegate' as const, label: 'Delegate it', desc: 'Who should handle this?' },
              { value: 'kill' as const, label: 'Kill it', desc: "It's not actually important" },
              { value: 'schedule' as const, label: 'Hard schedule', desc: 'Pick a specific date' },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => setAntiPileUpChoice(opt.value)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  antiPileUpChoice === opt.value
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-border hover:bg-accent',
                )}
              >
                <div className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                  antiPileUpChoice === opt.value ? 'border-amber-400 bg-amber-400' : 'border-muted-foreground',
                )} />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {antiPileUpChoice === 'schedule' && (
            <input
              type="date"
              value={antiPileUpDate}
              onChange={(e) => setAntiPileUpDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm focus:border-amber-500 focus:outline-none"
            />
          )}

          <DialogFooter>
            <button
              onClick={() => { setAntiPileUpTask(null); setAntiPileUpChoice(null); setAntiPileUpDate(''); }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Skip
            </button>
            <button
              onClick={handleAntiPileUpDecision}
              disabled={!antiPileUpChoice || (antiPileUpChoice === 'schedule' && !antiPileUpDate)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
            >
              Decide
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {totalPlanned === 0 && data.completed.length === 0 && (
        <EmptyState
          icon={Zap}
          title="No tasks to engage with"
          description="Process your inbox through Clarify and Organize first."
        />
      )}
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  onComplete,
  onDefer,
  expandedId,
  onExpand,
  muted = false,
}: {
  title: string;
  tasks: Task[];
  onComplete: (id: string) => void;
  onDefer: (id: string) => void;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  muted?: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <div>
      <h3 className={cn(
        'mb-2 text-xs font-semibold uppercase tracking-wider',
        muted ? 'text-muted-foreground/50' : 'text-muted-foreground',
      )}>
        {title}
      </h3>
      <div className="space-y-1">
        {tasks.map((task, i) => (
          <div
            key={task.id}
            className={cn(
              'stagger-item task-card group rounded-lg border border-transparent px-4 py-3',
              muted && 'opacity-60',
            )}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => onComplete(task.id)}
                aria-label={`Complete task: ${task.title}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition-colors hover:border-green-400 hover:text-green-400 sm:h-5 sm:w-5"
              >
                <Check className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium break-words">{task.title}</div>
                {task.nextAction && expandedId !== task.id && (
                  <div className="text-xs text-muted-foreground break-words line-clamp-2">{task.nextAction}</div>
                )}
                {/* Mobile-only: inline badges below title */}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
                  <PriorityBadge priority={task.priority || 4} />
                  <EnergyBadge level={task.energyLevel} />
                  <TimeEstimate minutes={task.timeEstimateMin} />
                  {(task.bumpCount || 0) >= 2 && (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400">
                      <RotateCcw className="h-3 w-3" />
                      {task.bumpCount}x
                    </span>
                  )}
                </div>
              </div>
              {/* Desktop-only: badges in row */}
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <PriorityBadge priority={task.priority || 4} />
                <EnergyBadge level={task.energyLevel} />
                <TimeEstimate minutes={task.timeEstimateMin} />
                {(task.bumpCount || 0) >= 2 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400">
                    <RotateCcw className="h-3 w-3" />
                    {task.bumpCount}x
                  </span>
                )}
              </div>
              <button
                onClick={() => onDefer(task.id)}
                aria-label={`Defer: ${task.title}`}
                className="touch-show flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 sm:h-auto sm:w-auto sm:rounded sm:p-1"
              >
                <ArrowRight className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
              </button>
              <button
                onClick={() => onExpand(expandedId === task.id ? null : task.id)}
                className="touch-show flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 sm:h-auto sm:w-auto sm:rounded sm:p-1"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', expandedId === task.id && 'rotate-180')} />
              </button>
            </div>

            {expandedId === task.id && (
              <div className="mt-2 ml-8 space-y-2 border-t border-border pt-2">
                {task.nextAction && <p className="text-sm text-muted-foreground">{task.nextAction}</p>}
                {task.contextNotes && <p className="text-xs text-muted-foreground">{task.contextNotes}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => onComplete(task.id)}
                    className="rounded-lg bg-green-500/20 px-3 py-2.5 text-xs text-green-400 hover:bg-green-500/30 sm:px-2 sm:py-1 sm:rounded"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => onDefer(task.id)}
                    className="rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:px-2 sm:py-1 sm:rounded"
                  >
                    Defer
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
