'use client';

import { useState, useEffect } from 'react';
import { BarChart3, Check, ArrowRight, Ban, Skull, Loader2, Sparkles, Calendar, TrendingUp, TrendingDown, Minus, AlertTriangle, Flame, FolderKanban, Brain, Target } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  priority: number | null;
  bumpCount: number | null;
}

interface ReviewData {
  reviewDate: string;
  completed: Task[];
  planned: Task[];
  fires: number;
  bumps: number;
  completionRate: number;
}

interface ProjectVelocity {
  project: string;
  status: 'accelerating' | 'steady' | 'stalled' | 'blocked';
  note: string;
}

interface AntiPileupAlert {
  taskTitle: string;
  bumpCount: number;
  recommendation: string;
}

interface WeeklyReview {
  weekSummary: string;
  completionTrend: string;
  topWins: string[];
  fireAnalysis: string;
  projectVelocity: ProjectVelocity[];
  antiPileupAlerts: AntiPileupAlert[];
  patternInsights: string[];
  priorityRecalibration: string;
  nextWeekFocus: string[];
}

export default function ReflectPage() {
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily');
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [observations, setObservations] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [freeCapture, setFreeCapture] = useState('');
  const [taskActions, setTaskActions] = useState<Record<string, 'bump' | 'block' | 'kill' | 'schedule'>>({});

  // Weekly review state
  const [weeklyReview, setWeeklyReview] = useState<WeeklyReview | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyNotes, setWeeklyNotes] = useState('');
  const [confirmKill, setConfirmKill] = useState<Task | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/todoist?action=daily-review');
        if (res.ok) {
          setData(await res.json());
        } else {
          // Auth or server error — show empty state gracefully
          setData({ reviewDate: new Date().toISOString().split('T')[0], completed: [], planned: [], fires: 0, bumps: 0, completionRate: 0 });
        }
      } catch {
        // Network error — show empty state
        setData({ reviewDate: new Date().toISOString().split('T')[0], completed: [], planned: [], fires: 0, bumps: 0, completionRate: 0 });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const generateObservations = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'daily-observations' }),
      });
      if (res.ok) setObservations(await res.json());
    } finally {
      setGenerating(false);
    }
  };

  const saveReview = async () => {
    const bumpedTasks = Object.entries(taskActions)
      .filter(([, action]) => action === 'bump')
      .map(([taskId]) => ({ taskId, reason: 'daily review' }));
    const blockedTasks = Object.entries(taskActions)
      .filter(([, action]) => action === 'block')
      .map(([taskId]) => ({ taskId, blocker: '' }));
    const killedTaskIds = Object.entries(taskActions)
      .filter(([, action]) => action === 'kill')
      .map(([taskId]) => taskId);

    await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save-daily-review',
        reviewDate: data?.reviewDate,
        completedTaskIds: data?.completed.map(t => t.id) || [],
        bumpedTasks,
        blockedTasks,
        killedTaskIds,
        freeCapture,
        tomorrowSeed: [],
      }),
    });
  };

  const runWeeklyReview = async () => {
    setWeeklyLoading(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'weekly-review' }),
      });
      if (res.ok) {
        setWeeklyReview(await res.json());
      }
    } finally {
      setWeeklyLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Reflect" description="Close the day. Learn the patterns." />
        <div className="h-40 animate-pulse rounded-lg bg-card" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Reflect" description="Close the day. Learn the patterns." />

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-secondary p-1">
        <button
          onClick={() => setTab('daily')}
          className={cn(
            'flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors sm:py-2',
            tab === 'daily' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          Daily Close-Out
        </button>
        <button
          onClick={() => setTab('weekly')}
          className={cn(
            'flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors sm:py-2',
            tab === 'weekly' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          Weekly Review
        </button>
      </div>

      {tab === 'daily' && data && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Completed', value: data.completed.length, color: 'text-green-400' },
              { label: 'Remaining', value: data.planned.length, color: 'text-amber-400' },
              { label: 'Fires', value: data.fires, color: 'text-red-400' },
              { label: 'Rate', value: `${Math.round(data.completionRate * 100)}%`, color: 'text-blue-400' },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-4 text-center">
                <div className={cn('text-2xl font-bold', stat.color)}>{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Completed */}
          {data.completed.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-400/70">
                ✅ Completed
              </h3>
              <div className="space-y-1">
                {data.completed.map(t => (
                  <div key={t.id} className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-green-400" />
                    {t.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Incomplete - need decisions */}
          {data.planned.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                ⏭️ Didn&apos;t Complete
              </h3>
              <div className="space-y-2">
                {data.planned.map(t => (
                  <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 text-sm font-medium">{t.title}</div>
                    <div className="flex flex-wrap gap-2">
                      {(['bump', 'block', 'kill'] as const).map(action => (
                        <button
                          key={action}
                          onClick={() => {
                            if (action === 'kill') {
                              setConfirmKill(t);
                            } else {
                              setTaskActions(prev => ({ ...prev, [t.id]: action }));
                            }
                          }}
                          aria-label={`${action === 'bump' ? 'Bump' : action === 'block' ? 'Block' : 'Kill'} task: ${t.title}`}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors sm:py-1.5',
                            taskActions[t.id] === action
                              ? action === 'kill' ? 'bg-red-500/20 text-red-400' : 'bg-primary/20 text-primary'
                              : 'bg-secondary text-muted-foreground hover:bg-accent',
                          )}
                        >
                          {action === 'bump' && <><ArrowRight className="h-3 w-3" /> Bump<span className="hidden sm:inline"> to tomorrow</span></>}
                          {action === 'block' && <><Ban className="h-3 w-3" /> Blocked</>}
                          {action === 'kill' && <><Skull className="h-3 w-3" /> Kill it</>}
                        </button>
                      ))}
                      {(t.bumpCount || 0) >= 2 && (
                        <span className="ml-2 text-xs text-amber-400">
                          ⚠️ Bumped {t.bumpCount}x already
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Free Capture */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              💭 Anything else on your mind?
            </h3>
            <textarea
              value={freeCapture}
              onChange={(e) => setFreeCapture(e.target.value)}
              placeholder="Loose ends, thoughts, notes for tomorrow..."
              rows={3}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* LLM Observations */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">🤖 LLM Observations</h3>
              <button
                onClick={generateObservations}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30 disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generating ? 'Analyzing...' : 'Generate'}
              </button>
            </div>

            {observations && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{observations.observations}</p>
                {observations.wins?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-green-400">Wins: </span>
                    <span className="text-xs text-muted-foreground">{observations.wins.join(', ')}</span>
                  </div>
                )}
                {observations.tomorrowSuggestions?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-blue-400">Tomorrow: </span>
                    <span className="text-xs text-muted-foreground">{observations.tomorrowSuggestions.join(', ')}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save */}
          <button
            onClick={saveReview}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save & Close Day
          </button>

          {/* Kill Confirmation */}
          <ConfirmDialog
            open={!!confirmKill}
            onOpenChange={(open) => { if (!open) setConfirmKill(null); }}
            title="Kill this task?"
            description={`"${confirmKill?.title}" will be permanently removed. This cannot be undone.`}
            confirmLabel="Kill It"
            onConfirm={() => {
              if (confirmKill) {
                setTaskActions(prev => ({ ...prev, [confirmKill.id]: 'kill' }));
                setConfirmKill(null);
              }
            }}
          />
        </div>
      )}

      {tab === 'weekly' && (
        <div className="space-y-6">
          {/* GTD Weekly Review Checklist */}
          {!weeklyReview && !weeklyLoading && (
            <WeeklyReviewChecklist onRunReview={runWeeklyReview} />
          )}

          {/* Loading */}
          {weeklyLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing your week with Claude Opus...</p>
              <p className="mt-1 text-xs text-muted-foreground/60">This may take a moment</p>
            </div>
          )}

          {/* Weekly Review Results */}
          {weeklyReview && (
            <div className="space-y-6">
              {/* Week Summary */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-2 text-sm font-semibold">📊 Week Summary</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{weeklyReview.weekSummary}</p>
              </div>

              {/* Completion Trend + Top Wins */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    {weeklyReview.completionTrend.startsWith('improving') ? (
                      <TrendingUp className="h-4 w-4 text-green-400" />
                    ) : weeklyReview.completionTrend.startsWith('declining') ? (
                      <TrendingDown className="h-4 w-4 text-red-400" />
                    ) : (
                      <Minus className="h-4 w-4 text-amber-400" />
                    )}
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Completion Trend
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{weeklyReview.completionTrend}</p>
                </div>

                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-400/70">
                    🏆 Top Wins
                  </h3>
                  <div className="space-y-1">
                    {weeklyReview.topWins.map((win, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-400" />
                        <span>{win}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Fire Analysis */}
              {weeklyReview.fireAnalysis && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Flame className="h-4 w-4 text-red-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-red-400/70">
                      Fire Analysis
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{weeklyReview.fireAnalysis}</p>
                </div>
              )}

              {/* Project Velocity */}
              {weeklyReview.projectVelocity?.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FolderKanban className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Project Velocity
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {weeklyReview.projectVelocity.map((pv, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-secondary/50">
                        <span className={cn(
                          'inline-block h-2 w-2 rounded-full',
                          pv.status === 'accelerating' ? 'bg-green-400' :
                          pv.status === 'steady' ? 'bg-blue-400' :
                          pv.status === 'stalled' ? 'bg-amber-400' : 'bg-red-400',
                        )} />
                        <span className="flex-1 text-sm font-medium">{pv.project}</span>
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          pv.status === 'accelerating' ? 'bg-green-500/10 text-green-400' :
                          pv.status === 'steady' ? 'bg-blue-500/10 text-blue-400' :
                          pv.status === 'stalled' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400',
                        )}>
                          {pv.status}
                        </span>
                        <span className="max-w-[200px] truncate text-xs text-muted-foreground">{pv.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Anti-Pile-Up Alerts */}
              {weeklyReview.antiPileupAlerts?.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                      Anti-Pile-Up Alerts
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {weeklyReview.antiPileupAlerts.map((alert, i) => (
                      <div key={i} className="rounded-lg border border-amber-500/10 bg-card px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{alert.taskTitle}</span>
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            bumped {alert.bumpCount}x
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{alert.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pattern Insights */}
              {weeklyReview.patternInsights?.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-400/70">
                      Pattern Insights
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {weeklyReview.patternInsights.map((insight, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="mt-0.5 text-purple-400">•</span>
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Priority Recalibration */}
              {weeklyReview.priorityRecalibration && (
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-400/70">
                      Priority Recalibration
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{weeklyReview.priorityRecalibration}</p>
                </div>
              )}

              {/* Next Week Focus */}
              {weeklyReview.nextWeekFocus?.length > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-primary/70">
                      Next Week Focus
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {weeklyReview.nextWeekFocus.map((focus, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 font-bold text-primary">{i + 1}.</span>
                        <span className="text-muted-foreground">{focus}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* User Notes */}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  📝 Your Notes
                </h3>
                <textarea
                  value={weeklyNotes}
                  onChange={(e) => setWeeklyNotes(e.target.value)}
                  placeholder="Add notes, override priorities, capture decisions..."
                  rows={4}
                  className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {/* Re-run */}
              <div className="flex gap-3">
                <button
                  onClick={runWeeklyReview}
                  disabled={weeklyLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  {weeklyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Re-run Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── GTD Weekly Review Checklist ─────────────────────────────

const GTD_CHECKLIST = [
  {
    phase: 'Get Clear',
    icon: '📥',
    items: [
      { id: 'collect-loose', label: 'Collect loose papers and materials' },
      { id: 'empty-inbox', label: 'Process inbox to zero' },
      { id: 'empty-head', label: 'Empty your head — capture any new open loops' },
    ],
  },
  {
    phase: 'Get Current',
    icon: '📋',
    items: [
      { id: 'review-actions', label: 'Review next action lists — mark off completed, add new' },
      { id: 'review-calendar-past', label: 'Review previous calendar — capture follow-ups' },
      { id: 'review-calendar-future', label: 'Review upcoming calendar — prepare and capture actions' },
      { id: 'review-waiting', label: 'Review waiting-for list — follow up as needed' },
      { id: 'review-projects', label: 'Review project list — ensure each has a next action' },
      { id: 'review-stuck', label: 'Review any stuck/stale projects — reactivate or move to Someday/Maybe' },
    ],
  },
  {
    phase: 'Get Creative',
    icon: '💡',
    items: [
      { id: 'review-someday', label: 'Review Someday/Maybe list — activate or delete' },
      { id: 'be-creative', label: 'Be creative and courageous — any new projects or goals?' },
    ],
  },
] as const;

function WeeklyReviewChecklist({ onRunReview }: { onRunReview: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const totalItems = GTD_CHECKLIST.reduce((sum, phase) => sum + phase.items.length, 0);
  const progress = checked.size / totalItems;

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">GTD Weekly Review Checklist</h3>
        <span className="text-xs text-muted-foreground">
          {checked.size}/{totalItems} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            progress === 1 ? 'bg-green-500' : 'bg-primary',
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {GTD_CHECKLIST.map(phase => (
        <div key={phase.phase} className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {phase.icon} {phase.phase}
          </h4>
          <div className="space-y-2">
            {phase.items.map(item => (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors hover:bg-secondary/50 sm:py-2',
                  checked.has(item.id) && 'text-muted-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="h-5 w-5 rounded border-border accent-primary"
                />
                <span className={checked.has(item.id) ? 'line-through' : ''}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}

      {/* AI Analysis trigger — only after completing checklist */}
      <div className={cn(
        'flex flex-col items-center rounded-xl border border-dashed py-6 text-center transition-all',
        progress === 1 ? 'border-primary/50 bg-primary/5' : 'border-border',
      )}>
        {progress === 1 ? (
          <>
            <Check className="mb-2 h-6 w-6 text-green-400" />
            <p className="mb-3 text-sm font-medium text-foreground">Checklist complete! Ready for AI analysis.</p>
          </>
        ) : (
          <>
            <Calendar className="mb-2 h-6 w-6 text-muted-foreground" />
            <p className="mb-3 text-sm text-muted-foreground">
              Complete the checklist above, then run AI analysis for patterns and insights.
            </p>
          </>
        )}
        <button
          onClick={onRunReview}
          disabled={progress < 1}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" />
          Run AI Weekly Analysis
        </button>
        {progress < 1 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Complete all {totalItems - checked.size} remaining items first
          </p>
        )}
      </div>
    </div>
  );
}
