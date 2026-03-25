'use client';

import { useState, useEffect } from 'react';
import { Zap, Check, ArrowRight, Ban, Flame, ChevronDown, Clock, RotateCcw } from 'lucide-react';
import { PriorityBadge, EnergyBadge, TimeEstimate, ProjectBadge, PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

  const fetchData = async () => {
    try {
      const res = await fetch('/api/todoist?action=engage');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleComplete = async (taskId: string) => {
    await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', taskId }),
    });
    await fetchData();
  };

  const handleDefer = async (taskId: string) => {
    const res = await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'defer', taskId }),
    });
    if (res.ok) {
      const result = await res.json();
      if (result.antiPileUp) {
        setAntiPileUpTask(result);
        setAntiPileUpChoice(null);
        setAntiPileUpDate('');
      }
    }
    await fetchData();
  };

  const handleBlock = async (taskId: string) => {
    await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block', taskId, blockerNote: blockerText }),
    });
    setBlockModal(null);
    setBlockerText('');
    await fetchData();
  };

  const handleFire = async () => {
    if (!fireText.trim()) return;
    await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fire', description: fireText }),
    });
    setFireModal(false);
    setFireText('');
    await fetchData();
  };

  const handleAntiPileUpDecision = async () => {
    if (!antiPileUpTask || !antiPileUpChoice) return;
    const taskId = antiPileUpTask.id;

    switch (antiPileUpChoice) {
      case 'promote':
        // Promote to P1 today
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-task', taskId, data: { priority: 1, status: 'active', dueDate: null } }),
        });
        break;
      case 'kill':
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill', taskId }),
        });
        break;
      case 'schedule':
        if (antiPileUpDate) {
          await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update-task', taskId, data: { dueDate: antiPileUpDate, status: 'active' } }),
          });
        }
        break;
      case 'delegate':
        // For now, mark as waiting with a note
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'block', taskId, blockerNote: 'Delegated — awaiting handoff' }),
        });
        break;
    }

    setAntiPileUpTask(null);
    setAntiPileUpChoice(null);
    setAntiPileUpDate('');
    await fetchData();
  };

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

  const allActive = [...data.fires, ...data.mustDo, ...data.shouldDo];
  const nextTask = allActive[0];

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
            Fire Incoming
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
        <span className="text-sm font-medium text-muted-foreground">
          {completedCount}/{completedCount + totalPlanned}
        </span>
      </div>

      {/* Next Up */}
      {nextTask && (
        <div className="mb-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">
            ► Next Up
          </div>
          <div className="mb-1 text-lg font-semibold">{nextTask.title}</div>
          {nextTask.nextAction && (
            <div className="mb-3 text-sm text-muted-foreground">{nextTask.nextAction}</div>
          )}
          <div className="mb-4 flex items-center gap-2">
            <PriorityBadge priority={nextTask.priority || 4} size="md" />
            <EnergyBadge level={nextTask.energyLevel} />
            <TimeEstimate minutes={nextTask.timeEstimateMin} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleComplete(nextTask.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-500/20 px-4 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30"
            >
              <Check className="h-4 w-4" /> Complete
            </button>
            <button
              onClick={() => handleDefer(nextTask.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <ArrowRight className="h-4 w-4" /> Defer
            </button>
            <button
              onClick={() => setBlockModal(nextTask.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              <Ban className="h-4 w-4" /> Blocked
            </button>
          </div>
        </div>
      )}

      {/* Task Queue */}
      <div className="space-y-6">
        {/* Fires */}
        {data.fires.length > 0 && (
          <TaskSection title="🔥 Fires" tasks={data.fires} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* Must Do */}
        {data.mustDo.length > 0 && (
          <TaskSection title="🎯 Must Do" tasks={data.mustDo.slice(nextTask && data.fires.length === 0 ? 1 : 0)} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* Should Do */}
        {data.shouldDo.length > 0 && (
          <TaskSection title="📋 Should Do" tasks={data.shouldDo} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} />
        )}

        {/* This Week */}
        {data.thisWeek.length > 0 && (
          <TaskSection title="📌 This Week" tasks={data.thisWeek} onComplete={handleComplete} onDefer={handleDefer} expandedId={expandedId} onExpand={setExpandedId} muted />
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
              Fire Triage
            </DialogTitle>
            <DialogDescription>
              What&apos;s the fire? The lowest P2 will be bumped to tomorrow.
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
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-transparent transition-colors hover:border-green-400 hover:text-green-400"
              >
                <Check className="h-3 w-3" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{task.title}</div>
                {task.nextAction && expandedId !== task.id && (
                  <div className="text-xs text-muted-foreground truncate">{task.nextAction}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <PriorityBadge priority={task.priority || 4} />
                <EnergyBadge level={task.energyLevel} />
                <TimeEstimate minutes={task.timeEstimateMin} />
                {(task.bumpCount || 0) >= 2 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-400">
                    <RotateCcw className="h-3 w-3" />
                    {task.bumpCount}x
                  </span>
                )}
                <button
                  onClick={() => onExpand(expandedId === task.id ? null : task.id)}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                >
                  <ChevronDown className={cn('h-4 w-4 transition-transform', expandedId === task.id && 'rotate-180')} />
                </button>
              </div>
            </div>

            {expandedId === task.id && (
              <div className="mt-2 ml-8 space-y-2 border-t border-border pt-2">
                {task.nextAction && <p className="text-sm text-muted-foreground">{task.nextAction}</p>}
                {task.contextNotes && <p className="text-xs text-muted-foreground">{task.contextNotes}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => onComplete(task.id)}
                    className="rounded bg-green-500/20 px-2 py-1 text-xs text-green-400 hover:bg-green-500/30"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => onDefer(task.id)}
                    className="rounded bg-secondary px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
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
