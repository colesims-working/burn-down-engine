'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronUp, ChevronDown, GripVertical, Archive, Loader2 } from 'lucide-react';
import { PriorityBadge, EnergyBadge, TimeEstimate, DueDateBadge, PageHeader } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';
import { useUndo, useSyncHealth } from '@/components/providers/trust-provider';
import { toast } from '@/hooks/use-toast';

interface Task {
  id: string;
  title: string;
  nextAction: string | null;
  status: string;
  priority: number;
  dueDate: string | null;
  labels: string;
  energyLevel: string | null;
  timeEstimateMin: number | null;
  projectOrder: number | null;
  bumpCount: number;
  completedAt: string | null;
}

interface Project {
  id: string;
  name: string;
  goal: string | null;
  category: string | null;
  status: string;
  openActionCount: number;
}

export default function ProjectExecutionPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { pushUndo } = useUndo();
  const { addSyncFailure } = useSyncHealth();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [projRes, tasksRes] = await Promise.all([
        fetch('/api/todoist?action=projects'),
        fetch(`/api/todoist?action=project-tasks&projectId=${projectId}`),
      ]);
      if (projRes.ok) {
        const projects = await projRes.json();
        setProject((Array.isArray(projects) ? projects : []).find((p: Project) => p.id === projectId) || null);
      }
      if (tasksRes.ok) {
        setTasks(await tasksRes.json());
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Split tasks by status
  const activeTasks = tasks.filter(t => !['completed', 'killed', 'needs_reconcile'].includes(t.status));
  const completedTasks = tasks.filter(t => t.status === 'completed');

  // Move task up/down in the list
  const moveTask = async (taskId: string, direction: 'up' | 'down') => {
    const idx = activeTasks.findIndex(t => t.id === taskId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= activeTasks.length) return;

    // Swap locally
    const newOrder = [...activeTasks];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    const orderedIds = newOrder.map(t => t.id);

    // Optimistic update
    setTasks(prev => {
      const reordered = [...prev];
      for (let i = 0; i < orderedIds.length; i++) {
        const t = reordered.find(r => r.id === orderedIds[i]);
        if (t) t.projectOrder = i + 1;
      }
      return reordered.sort((a, b) => (a.projectOrder ?? 999) - (b.projectOrder ?? 999));
    });

    // Persist
    await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder-project-tasks', orderedTaskIds: orderedIds }),
    });
  };

  const completeTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Optimistic remove
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed', completedAt: new Date().toISOString() } : t));

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', taskId }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.syncWarning) addSyncFailure(result.syncWarning);
        pushUndo({
          action: 'completed',
          taskId,
          taskTitle: task.title,
          previousSnapshot: { status: task.status, priority: task.priority, dueDate: task.dueDate, bumpCount: task.bumpCount, labels: task.labels, blockerNote: null, completedAt: null, todoistId: null },
        });
        window.dispatchEvent(new Event('task-changed'));

        // Check if all active tasks are now done
        const remainingActive = tasks.filter(t => t.id !== taskId && !['completed', 'killed', 'needs_reconcile'].includes(t.status));
        if (remainingActive.length === 0) {
          toast({ title: 'All tasks done!', description: `${project?.name} has no more active tasks. Archive it?`, duration: 10000 });
        }
      } else {
        // Revert
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: task.status, completedAt: task.completedAt } : t));
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: task.status, completedAt: task.completedAt } : t));
    }
  };

  const archiveProject = async () => {
    if (!project) return;
    setArchiving(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-project', projectId: project.id }),
      });
      if (res.ok) {
        toast({ title: 'Project archived', description: `${project.name} has been archived.` });
        router.push('/organize');
      }
    } catch {} finally {
      setArchiving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Project not found.</p>
        <Link href="/organize" className="text-primary hover:underline mt-2 inline-block">Back to Organize</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/organize" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <PageHeader
            title={project.name}
            description={project.goal || `${activeTasks.length} active tasks`}
          />
        </div>
        <button
          onClick={archiveProject}
          disabled={archiving}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Active Tasks — manually orderable */}
      {activeTasks.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No active tasks in this project.</p>
          <button onClick={archiveProject} className="mt-3 text-sm text-primary hover:underline">
            Archive this project
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {activeTasks.map((task, i) => (
            <li
              key={task.id}
              className="group flex items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 hover:bg-accent/50 hover:border-border transition-colors"
            >
              {/* Reorder controls */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveTask(task.id, 'up')}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveTask(task.id, 'down')}
                  disabled={i === activeTasks.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Task content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <PriorityBadge priority={task.priority} />
                  <span className="text-sm font-medium truncate">{task.title}</span>
                  {task.dueDate && <DueDateBadge dueDate={task.dueDate} />}
                </div>
                {task.nextAction && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{task.nextAction}</div>
                )}
              </div>

              {/* Metadata */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {task.energyLevel && <EnergyBadge energy={task.energyLevel} />}
                {task.timeEstimateMin && <TimeEstimate minutes={task.timeEstimateMin} />}
              </div>

              {/* Complete button */}
              <button
                onClick={() => completeTask(task.id)}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-green-500/20 hover:text-green-400 transition-colors"
                title="Complete"
              >
                <Check className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {completedTasks.length} completed task{completedTasks.length !== 1 ? 's' : ''}
          </summary>
          <ul className="mt-2 space-y-1 opacity-60">
            {completedTasks.map(task => (
              <li key={task.id} className="flex items-center gap-2 px-3 py-1.5 text-sm line-through text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                {task.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
