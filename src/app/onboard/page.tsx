'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Check, ChevronDown, ChevronUp, Loader2, Pencil, CheckCircle2, ArrowLeft, Package } from 'lucide-react';
import { PriorityBadge, PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

// ─── Types ──────────────────────────────────────────────────

interface ClarifyResult {
  title: string;
  nextAction: string;
  projectName: string;
  newProject: boolean;
  priority: number;
  priorityReasoning: string;
  labels: string[];
  dueDate: string | null;
  timeEstimateMin: number;
  energyLevel: 'high' | 'medium' | 'low';
  contextNotes: string;
  definitionOfDone: string;
  nonGoals: string;
  relatedPeople: string[];
  relatedLinks: string[];
  decompositionNeeded: boolean;
  subtasks: { title: string; nextAction: string }[];
  confidence: number;
  questions: string[];
  knowledgeExtracted: any[];
}

interface LegacyTask {
  id: string;
  title: string;
  originalText: string;
  status: string;
  projectId: string | null;
  projectName: string | null;
  priority: number;
  labels: string;
  dueDate: string | null;
  description: string | null;
  todoistId: string;
  createdAt: string;
}

interface OnboardTask {
  legacy: LegacyTask;
  result: ClarifyResult | null;
  procStatus: 'pending' | 'processing' | 'done' | 'approved' | 'error';
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  editDraft?: Partial<ClarifyResult>;
}

// ─── Helpers ────────────────────────────────────────────────

const sanitizeResult = (r: any): ClarifyResult => ({
  title: r.title || '',
  nextAction: r.nextAction || '',
  projectName: r.projectName || '',
  newProject: r.newProject || false,
  priority: r.priority || 4,
  priorityReasoning: r.priorityReasoning || '',
  labels: Array.isArray(r.labels) ? r.labels : [],
  dueDate: r.dueDate || null,
  timeEstimateMin: r.timeEstimateMin || 0,
  energyLevel: r.energyLevel || 'medium',
  contextNotes: r.contextNotes || '',
  definitionOfDone: r.definitionOfDone || '',
  nonGoals: r.nonGoals || '',
  relatedPeople: Array.isArray(r.relatedPeople) ? r.relatedPeople : [],
  relatedLinks: Array.isArray(r.relatedLinks) ? r.relatedLinks : [],
  decompositionNeeded: false, // Always false for legacy enrichment
  subtasks: [],
  confidence: typeof r.confidence === 'number' && !isNaN(r.confidence) ? r.confidence : 0.5,
  questions: Array.isArray(r.questions) ? r.questions : [],
  knowledgeExtracted: Array.isArray(r.knowledgeExtracted) ? r.knowledgeExtracted : [],
});

const STORAGE_KEY = 'onboard-progress';

// ─── Component ──────────────────────────────────────────────

export default function OnboardPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<OnboardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingState, setProcessingState] = useState<'idle' | 'running' | 'done'>('idle');
  const [processedCount, setProcessedCount] = useState(0);
  const [processingTotal, setProcessingTotal] = useState(0);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(0.95);
  const [approvingAll, setApprovingAll] = useState(false);

  // ─── localStorage Persistence ─────────────────────────────

  const saveProgress = useCallback((t: OnboardTask[]) => {
    try {
      const saveable = t.filter(x => x.procStatus !== 'pending' && x.procStatus !== 'error');
      if (saveable.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ts: Date.now(),
          tasks: saveable.map(x => ({
            id: x.legacy.id,
            result: x.result,
            procStatus: x.procStatus,
          })),
        }));
      }
    } catch {}
  }, []);

  const loadProgress = useCallback((current: OnboardTask[]): OnboardTask[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return current;
      const saved = JSON.parse(raw);
      if (Date.now() - saved.ts > 2 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return current;
      }
      const savedMap = new Map<string, any>(saved.tasks.map((t: any) => [t.id, t]));
      return current.map(t => {
        const s = savedMap.get(t.legacy.id);
        if (s?.result) {
          return { ...t, result: sanitizeResult(s.result), procStatus: s.procStatus === 'approved' ? 'approved' as const : 'done' as const };
        }
        return t;
      });
    } catch {
      return current;
    }
  }, []);

  useEffect(() => {
    if (!loading && tasks.length > 0) saveProgress(tasks);
  }, [tasks, loading, saveProgress]);

  // ─── Load Tasks & Settings ────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [tasksRes, settingsRes] = await Promise.all([
          fetch('/api/todoist?action=legacy-tasks').then(r => r.ok ? r.json() : []),
          fetch('/api/todoist?action=app-settings').then(r => r.ok ? r.json() : null),
        ]);

        if (settingsRes?.autoApproveThreshold != null) {
          setAutoApproveThreshold(settingsRes.autoApproveThreshold);
        }

        const initial: OnboardTask[] = tasksRes.map((t: LegacyTask) => ({
          legacy: t,
          result: null,
          procStatus: 'pending' as const,
          selected: true,
          expanded: false,
          editing: false,
        }));
        setTasks(loadProgress(initial));
      } catch {
        toast({ title: 'Failed to load legacy tasks', duration: 5000 });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Grouping ─────────────────────────────────────────────

  const tasksByProject = useMemo(() => {
    const groups = new Map<string, OnboardTask[]>();
    for (const t of tasks) {
      const key = t.legacy.projectName ?? 'No Project';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  // ─── Selection ────────────────────────────────────────────

  const pendingTasks = tasks.filter(t => t.procStatus === 'pending');
  const selectedCount = tasks.filter(t => t.selected && t.procStatus === 'pending').length;

  const toggleSelect = (id: string) => {
    setTasks(prev => prev.map(t =>
      t.legacy.id === id ? { ...t, selected: !t.selected } : t
    ));
  };

  const toggleProjectSelect = (projectName: string) => {
    const group = tasksByProject.find(([name]) => name === projectName)?.[1] ?? [];
    const pending = group.filter(t => t.procStatus === 'pending');
    const allSelected = pending.every(t => t.selected);
    const ids = new Set(pending.map(t => t.legacy.id));
    setTasks(prev => prev.map(t =>
      ids.has(t.legacy.id) ? { ...t, selected: !allSelected } : t
    ));
  };

  const selectAll = () => {
    const allSelected = pendingTasks.every(t => t.selected);
    setTasks(prev => prev.map(t =>
      t.procStatus === 'pending' ? { ...t, selected: !allSelected } : t
    ));
  };

  // ─── Processing ───────────────────────────────────────────

  const processSelected = async () => {
    const toProcess = tasks.filter(t => t.selected && (t.procStatus === 'pending' || t.procStatus === 'error'));
    if (toProcess.length === 0) return;

    if (toProcess.length > 50 && !window.confirm(`This will make ${toProcess.length} LLM calls. This may take a while and use API credits. Continue?`)) {
      return;
    }

    setProcessingState('running');
    setProcessedCount(0);
    setProcessingTotal(toProcess.length);
    setProcessingStartTime(Date.now());

    const BATCH_SIZE = 5;
    for (let b = 0; b < toProcess.length; b += BATCH_SIZE) {
      const batch = toProcess.slice(b, b + BATCH_SIZE);

      await Promise.all(batch.map(async (task) => {
        const taskId = task.legacy.id;

        setTasks(prev => prev.map(t =>
          t.legacy.id === taskId ? { ...t, procStatus: 'processing' } : t
        ));

        try {
          const res = await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'enrich-legacy', taskId }),
          });

          if (res.ok) {
            const result = sanitizeResult(await res.json());
            const autoApprove = result.confidence >= autoApproveThreshold;

            setTasks(prev => prev.map(t =>
              t.legacy.id === taskId ? { ...t, result, procStatus: autoApprove ? 'approved' : 'done', expanded: !autoApprove } : t
            ));

            // Auto-approve: push to Todoist immediately
            if (autoApprove) {
              try {
                const applyRes = await fetch('/api/todoist', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'apply-clarification', taskId, clarification: result }),
                });
                if (!applyRes.ok) {
                  setTasks(prev => prev.map(t =>
                    t.legacy.id === taskId ? { ...t, procStatus: 'done' } : t
                  ));
                }
              } catch {
                setTasks(prev => prev.map(t =>
                  t.legacy.id === taskId ? { ...t, procStatus: 'done' } : t
                ));
              }
            }
          } else {
            setTasks(prev => prev.map(t =>
              t.legacy.id === taskId ? { ...t, procStatus: 'error' } : t
            ));
          }
        } catch {
          setTasks(prev => prev.map(t =>
            t.legacy.id === taskId ? { ...t, procStatus: 'error' } : t
          ));
        }

        setProcessedCount(prev => prev + 1);
      }));
    }

    setProcessingState('done');
  };

  // ─── Approval ─────────────────────────────────────────────

  const approveTask = async (taskId: string, taskOverride?: OnboardTask) => {
    const task = taskOverride ?? tasks.find(t => t.legacy.id === taskId);
    if (!task?.result) return;

    const clarification = task.editDraft
      ? { ...task.result, ...task.editDraft }
      : task.result;

    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, procStatus: 'approved', expanded: false, editing: false, editDraft: undefined } : t
    ));

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply-clarification', taskId, clarification }),
      });
      if (!res.ok) {
        setTasks(prev => prev.map(t =>
          t.legacy.id === taskId ? { ...t, procStatus: 'done', result: clarification } : t
        ));
      }
    } catch {
      setTasks(prev => prev.map(t =>
        t.legacy.id === taskId ? { ...t, procStatus: 'done', result: clarification } : t
      ));
    }
  };

  const approveAllHighConfidence = async () => {
    const toApprove = tasks.filter(t => t.procStatus === 'done' && t.result && t.result.confidence >= autoApproveThreshold);
    if (toApprove.length === 0) return;
    setApprovingAll(true);
    for (const task of toApprove) {
      await approveTask(task.legacy.id, task);
    }
    setApprovingAll(false);
  };

  // ─── Editing ──────────────────────────────────────────────

  const startEditing = (taskId: string) => {
    const task = tasks.find(t => t.legacy.id === taskId);
    if (!task?.result) return;
    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, editing: true, expanded: true, editDraft: { ...t.result! } } : t
    ));
  };

  const updateDraft = (taskId: string, field: string, value: any) => {
    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, editDraft: { ...t.editDraft, [field]: value } } : t
    ));
  };

  const cancelEditing = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, editing: false, editDraft: undefined } : t
    ));
  };

  const saveEdits = (taskId: string) => {
    const task = tasks.find(t => t.legacy.id === taskId);
    if (!task?.editDraft) return;
    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, result: { ...t.result!, ...t.editDraft }, editing: false, editDraft: undefined } : t
    ));
  };

  const toggleExpand = (taskId: string) => {
    setTasks(prev => prev.map(t =>
      t.legacy.id === taskId ? { ...t, expanded: !t.expanded } : t
    ));
  };

  // ─── Completion ───────────────────────────────────────────

  const allDone = tasks.length > 0 && tasks.every(t => t.procStatus === 'approved');

  const handleFinish = () => {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('task-changed'));
    router.push('/settings');
  };

  // ─── Stats ────────────────────────────────────────────────

  const approvedCount = tasks.filter(t => t.procStatus === 'approved').length;
  const doneCount = tasks.filter(t => t.procStatus === 'done').length;
  const errorCount = tasks.filter(t => t.procStatus === 'error').length;
  const processingRate = processingStartTime && processedCount > 0
    ? (processedCount / ((Date.now() - processingStartTime) / 60000)).toFixed(1)
    : null;

  // ─── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <PageHeader title="Legacy Task Onboarding" description="Enrich imported Todoist tasks with AI clarification" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div>
        <PageHeader title="Legacy Task Onboarding" description="Enrich imported Todoist tasks with AI clarification" />
        <EmptyState
          icon={CheckCircle2}
          title="All caught up!"
          description="No unenriched legacy tasks found. All your Todoist tasks have been through the clarify process."
        />
        <div className="mt-6 flex justify-center">
          <button onClick={() => router.push('/settings')} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Legacy Task Onboarding"
        description={`${tasks.length} imported tasks to enrich`}
        action={
          <button onClick={() => router.push('/settings')} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Settings
          </button>
        }
      />

      {/* Progress Bar */}
      {processingState === 'running' && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              Processing {processedCount} / {processingTotal}
            </span>
            {processingRate && (
              <span className="text-xs text-muted-foreground">{processingRate} tasks/min</span>
            )}
          </div>
          <div className="h-2 rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${processingTotal > 0 ? (processedCount / processingTotal) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary Stats (after processing) */}
      {processingState === 'done' && (
        <div className="mb-6 flex flex-wrap gap-3">
          {approvedCount > 0 && (
            <div className="rounded-lg bg-green-500/10 px-3 py-2 text-xs font-medium text-green-400">
              {approvedCount} approved
            </div>
          )}
          {doneCount > 0 && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-400">
              {doneCount} needs review
            </div>
          )}
          {errorCount > 0 && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              {errorCount} errors
            </div>
          )}
        </div>
      )}

      {/* All Done Banner */}
      {allDone && (
        <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-green-400 mb-2" />
          <h3 className="text-sm font-semibold text-green-400">All tasks enriched!</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {approvedCount} tasks have been enriched and pushed to Todoist.
          </p>
          <button
            onClick={handleFinish}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Done — Return to Settings
          </button>
        </div>
      )}

      {/* Bulk Approve Button (review phase) */}
      {processingState === 'done' && doneCount > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={approveAllHighConfidence}
            disabled={approvingAll}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {approvingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve All High-Confidence ({tasks.filter(t => t.procStatus === 'done' && t.result && t.result.confidence >= autoApproveThreshold).length})
          </button>
        </div>
      )}

      {/* Global Select/Deselect + Enrich (top action bar) */}
      {processingState !== 'running' && pendingTasks.length > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={selectAll} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              {pendingTasks.every(t => t.selected) ? 'Deselect All' : `Select All (${pendingTasks.length})`}
            </button>
            {selectedCount > 0 && (
              <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
                {selectedCount} selected
              </span>
            )}
          </div>
          <button
            onClick={processSelected}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Enrich Selected ({selectedCount})
          </button>
        </div>
      )}

      {/* Task List Grouped by Project */}
      <div className="space-y-6">
        {tasksByProject.map(([projectName, projectTasks]) => {
          const pendingInGroup = projectTasks.filter(t => t.procStatus === 'pending');
          const allGroupSelected = pendingInGroup.length > 0 && pendingInGroup.every(t => t.selected);

          return (
            <div key={projectName} className="rounded-xl border border-border bg-card">
              {/* Project Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{projectName}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {projectTasks.length}
                  </span>
                </div>
                {pendingInGroup.length > 0 && processingState !== 'running' && (
                  <button
                    onClick={() => toggleProjectSelect(projectName)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {allGroupSelected ? 'Deselect' : 'Select all'}
                  </button>
                )}
              </div>

              {/* Tasks */}
              <div className="divide-y divide-border">
                {projectTasks.map(task => (
                  <div key={task.legacy.id} className="px-4 py-3">
                    {/* Task Row */}
                    <div className="flex items-center gap-3">
                      {task.procStatus === 'pending' && processingState !== 'running' && (
                        <input
                          type="checkbox"
                          checked={task.selected}
                          onChange={() => toggleSelect(task.legacy.id)}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                      )}
                      {task.procStatus === 'processing' && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                      {task.procStatus === 'approved' && (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      )}
                      {task.procStatus === 'done' && (
                        <Sparkles className="h-4 w-4 text-amber-400" />
                      )}
                      {task.procStatus === 'error' && (
                        <span className="text-xs text-destructive">Error</span>
                      )}

                      <div className="flex-1 min-w-0">
                        <span className="text-sm break-words">{task.legacy.title}</span>
                        {task.legacy.dueDate && (
                          <span className="ml-2 text-xs text-muted-foreground">Due {task.legacy.dueDate}</span>
                        )}
                      </div>

                      <PriorityBadge priority={task.legacy.priority ?? 4} />

                      {/* Expand/Actions */}
                      {task.result && (
                        <button onClick={() => toggleExpand(task.legacy.id)} className="p-1 text-muted-foreground hover:text-foreground">
                          {task.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      )}
                    </div>

                    {/* Expanded Result Card */}
                    {task.expanded && task.result && (
                      <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-4 space-y-3">
                        {/* Confidence */}
                        <div className="flex items-center justify-between">
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            task.result.confidence >= 0.9 ? 'bg-green-500/20 text-green-400' :
                            task.result.confidence >= 0.7 ? 'bg-amber-500/20 text-amber-400' :
                            'bg-red-500/20 text-red-400'
                          )}>
                            {Math.round(task.result.confidence * 100)}% confidence
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Todoist metadata preserved
                          </span>
                        </div>

                        {task.editing ? (
                          /* Edit Mode */
                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Title</label>
                              <input
                                type="text"
                                value={task.editDraft?.title ?? task.result.title}
                                onChange={(e) => updateDraft(task.legacy.id, 'title', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Next Action</label>
                              <input
                                type="text"
                                value={task.editDraft?.nextAction ?? task.result.nextAction}
                                onChange={(e) => updateDraft(task.legacy.id, 'nextAction', e.target.value)}
                                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-xs font-medium text-muted-foreground">Time Estimate (min)</label>
                                <input
                                  type="number"
                                  value={task.editDraft?.timeEstimateMin ?? task.result.timeEstimateMin}
                                  onChange={(e) => updateDraft(task.legacy.id, 'timeEstimateMin', parseInt(e.target.value) || 0)}
                                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-xs font-medium text-muted-foreground">Energy</label>
                                <select
                                  value={task.editDraft?.energyLevel ?? task.result.energyLevel}
                                  onChange={(e) => updateDraft(task.legacy.id, 'energyLevel', e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                >
                                  <option value="high">High</option>
                                  <option value="medium">Medium</option>
                                  <option value="low">Low</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Context Notes</label>
                              <textarea
                                value={task.editDraft?.contextNotes ?? task.result.contextNotes}
                                onChange={(e) => updateDraft(task.legacy.id, 'contextNotes', e.target.value)}
                                rows={2}
                                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => saveEdits(task.legacy.id)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                                Save Edits
                              </button>
                              <button onClick={() => cancelEditing(task.legacy.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* View Mode */
                          <>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground">Title</span>
                                <div className="text-sm">{task.result.title}</div>
                              </div>
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground">Next Action</span>
                                <div className="text-sm">{task.result.nextAction || '—'}</div>
                              </div>
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground">Time / Energy</span>
                                <div className="text-sm">{task.result.timeEstimateMin}min · {task.result.energyLevel}</div>
                              </div>
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground">Labels</span>
                                <div className="text-sm">{task.result.labels.join(', ') || '—'}</div>
                              </div>
                            </div>
                            {task.result.contextNotes && (
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground">Context</span>
                                <div className="text-sm text-muted-foreground">{task.result.contextNotes}</div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Action Buttons */}
                        {task.procStatus === 'done' && !task.editing && (
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => approveTask(task.legacy.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button
                              onClick={() => startEditing(task.legacy.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Action Bar */}
      {processingState !== 'running' && pendingTasks.length > 0 && (
        <div className="mt-6 flex justify-center">
          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground">
              {pendingTasks.every(t => t.selected) ? 'Deselect All' : `Select All (${pendingTasks.length})`}
            </button>
            <button
              onClick={processSelected}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:py-2.5"
            >
              <Sparkles className="h-4 w-4" />
              Enrich Selected ({selectedCount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
