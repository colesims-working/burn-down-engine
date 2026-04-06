'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, Check, ChevronDown, ChevronUp, Loader2, MessageCircle, Mic, MicOff, X, RotateCcw, Pencil, CheckCircle2, Undo2, GitBranch, MessageSquare, Zap } from 'lucide-react';
import { PriorityBadge, EnergyBadge, TimeEstimate, ProjectBadge, PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';
import { useUndo } from '@/components/providers/trust-provider';
import { toast } from '@/hooks/use-toast';
import type { TaskSnapshot } from '@/lib/undo/engine';

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
  relatedPeople: string[];
  relatedLinks: string[];
  decompositionNeeded: boolean;
  subtasks: { title: string; nextAction: string }[];
  confidence: number;
  questions: string[];
  knowledgeExtracted: any[];
}

interface ProcessedTask {
  id: string;
  originalText: string;
  result: ClarifyResult | null;
  status: 'pending' | 'processing' | 'done' | 'needs-input' | 'approved' | 'error' | 'rejected' | 'completed';
  expanded: boolean;
  selected: boolean;
  answer?: string;
  streamText?: string;
  editing?: boolean;
  editDraft?: Partial<ClarifyResult>;
  splitInto?: number;
  splitFromId?: string;
  noSplit?: boolean;
}

export default function ClarifyPage() {
  const searchParams = useSearchParams();
  const filterTaskIds = searchParams.get('taskIds')?.split(',').filter(Boolean) || [];
  const { pushUndo, isActionBusy, markBusy } = useUndo();

  const [tasks, setTasks] = useState<ProcessedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('clarify-guide-dismissed') !== '1';
  });
  const [processedCount, setProcessedCount] = useState(0);
  const [processingTotal, setProcessingTotal] = useState(0);
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [autoApproveThreshold, setAutoApproveThreshold] = useState<number>(0.95);

  // Persist clarify progress to localStorage
  const STORAGE_KEY = 'clarify-progress';
  const saveProgress = (tasks: ProcessedTask[]) => {
    try {
      const saveable = tasks.filter(t => t.status !== 'pending' && t.status !== 'error');
      if (saveable.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ts: Date.now(),
          tasks: saveable.map(t => ({
            id: t.id,
            originalText: t.originalText,
            result: t.result,
            status: t.status,
            splitInto: t.splitInto,
            splitFromId: t.splitFromId,
            noSplit: t.noSplit,
          })),
        }));
      }
    } catch {}
  };
  const loadProgress = (currentTasks: ProcessedTask[]): ProcessedTask[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return currentTasks;
      const saved = JSON.parse(raw);
      // Expire after 2 hours
      if (Date.now() - saved.ts > 2 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return currentTasks;
      }
      const savedMap = new Map<string, any>(saved.tasks.map((t: any) => [t.id, t]));
      return currentTasks.map(t => {
        const s = savedMap.get(t.id);
        if (s && s.result) {
          return { ...t, result: sanitizeResult(s.result), status: s.status === 'approved' ? 'approved' : 'done', splitInto: s.splitInto, splitFromId: s.splitFromId, noSplit: s.noSplit };
        }
        return t;
      });
    } catch {
      return currentTasks;
    }
  };

  // Save progress whenever tasks change (debounced via status changes)
  useEffect(() => {
    if (!loading && tasks.length > 0) saveProgress(tasks);
  }, [tasks, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sanitize LLM results — fill in defaults for any missing fields
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
    relatedPeople: Array.isArray(r.relatedPeople) ? r.relatedPeople : [],
    relatedLinks: Array.isArray(r.relatedLinks) ? r.relatedLinks : [],
    decompositionNeeded: r.decompositionNeeded || false,
    subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
    confidence: typeof r.confidence === 'number' && !isNaN(r.confidence) ? r.confidence : 0.5,
    questions: Array.isArray(r.questions) ? r.questions : [],
    knowledgeExtracted: Array.isArray(r.knowledgeExtracted) ? r.knowledgeExtracted : [],
  });

  // Create split tasks from subtask titles — returns new ProcessedTask[] or null if no split needed
  const autoSplitIfNeeded = async (result: ClarifyResult, taskId: string): Promise<ProcessedTask[] | null> => {
    if (!result.decompositionNeeded || result.subtasks.length === 0) return null;
    const splitTexts = result.subtasks.map(s => s.title).filter(Boolean);
    if (splitTexts.length === 0) return null;

    // Find original task text to provide context in split titles
    const originalTask = tasks.find(t => t.id === taskId);
    const parentContext = originalTask?.originalText || '';

    const newTasks: ProcessedTask[] = [];
    for (const text of splitTexts) {
      try {
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quick-add', content: text }),
        });
        if (res.ok) {
          const created = await res.json();
          newTasks.push({
            id: created.id,
            originalText: parentContext ? `${text} [from: ${parentContext}]` : text,
            result: null,
            status: 'pending',
            expanded: false,
            selected: true,
            splitFromId: taskId,
          });
        }
      } catch (e) {
        console.error('Auto-split subtask creation failed:', e);
        toast({ title: 'Subtask creation failed', description: 'Some subtasks could not be created.', duration: 4000 });
      }
    }

    if (newTasks.length > 0) {
      setTasks(prev => {
        const updated = prev.map(t =>
          t.id === taskId ? { ...t, status: 'done' as const, result, expanded: false, splitInto: newTasks.length } : t
        );
        return [...updated, ...newTasks];
      });
      return newTasks;
    }
    return null;
  };

  const confirmSplit = (index: number) => {
    const task = tasks[index];
    if (!task) return;
    // Confirm: mark original as rejected, remove splitFromId from children so they're independent
    setTasks(prev => prev.map((t, idx) => {
      if (idx === index) return { ...t, status: 'rejected' as const };
      if (t.splitFromId === task.id) return { ...t, splitFromId: undefined };
      return t;
    }));
  };

  const keepOriginal = async (index: number) => {
    const task = tasks[index];
    if (!task) return;
    // Delete all split children and show original with its existing clarification result
    const children = tasks.filter(t => t.splitFromId === task.id);
    setTasks(prev =>
      prev.filter(t => t.splitFromId !== task.id).map(t =>
        t.id === task.id ? { ...t, status: 'done' as const, splitInto: undefined } : t
      )
    );
    // Delete from Todoist in parallel (non-blocking)
    await Promise.all(children.map(child =>
      fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', taskId: child.id }),
      }).catch(e => console.error('Failed to delete split child:', e))
    ));
  };

  const undoSplit = async (index: number) => {
    const task = tasks[index];
    if (!task) return;
    // Delete all children from Todoist and state, restore original to pending with noSplit flag
    const children = tasks.filter(t => t.splitFromId === task.id);
    setTasks(prev =>
      prev.filter(t => t.splitFromId !== task.id).map(t =>
        t.id === task.id ? { ...t, status: 'pending' as const, splitInto: undefined, selected: true, noSplit: true } : t
      )
    );
    // Delete from Todoist in background
    for (const child of children) {
      try {
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', taskId: child.id }),
        });
      } catch (e) {
        console.error('Failed to undo split child:', e);
      }
    }
  };

  const deleteSplitChild = async (childId: string, parentId: string) => {
    // Remove child from state
    setTasks(prev => {
      const remaining = prev.filter(t => t.id !== childId);
      // Update parent's splitInto count
      const childrenLeft = remaining.filter(t => t.splitFromId === parentId).length;
      return remaining.map(t =>
        t.id === parentId
          ? childrenLeft === 0
            ? { ...t, status: 'pending' as const, splitInto: undefined, selected: true } // No children left, restore original
            : { ...t, splitInto: childrenLeft }
          : t
      );
    });
    // Delete from Todoist
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', taskId: childId }),
      });
    } catch (e) {
      console.error('Failed to delete split child:', e);
    }
  };

  // Auto-sync if stale (>5 min since last inbox sync)
  useEffect(() => {
    async function syncIfStale() {
      try {
        const res = await fetch('/api/todoist?action=sync-state');
        if (!res.ok) return;
        const state = await res.json();
        const lastSync = state?.lastInboxSync || state?.lastFullSync;
        if (!lastSync || (Date.now() - new Date(lastSync).getTime()) > 5 * 60 * 1000) {
          await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync-inbox' }),
          });
        }
      } catch {
        // Auth not ready or network issue — silent fallback
      }
    }

    async function loadAutoApproveThreshold() {
      try {
        const res = await fetch('/api/todoist?action=app-settings');
        if (res.ok) {
          const data = await res.json();
          if (data.autoApproveThreshold != null) {
            setAutoApproveThreshold(data.autoApproveThreshold);
          }
        }
      } catch {
        // Use default 0.95
      }
    }

    syncIfStale();
    loadAutoApproveThreshold();
  }, []);

  useEffect(() => {
    async function loadInbox() {
      try {
        const res = await fetch('/api/todoist?action=inbox');
        if (res.ok) {
          const data = await res.json();
          let filtered = data;
          if (filterTaskIds.length > 0) {
            const idSet = new Set(filterTaskIds);
            filtered = data.filter((t: any) => idSet.has(t.id));
          }
          const initial = filtered.map((t: any) => ({
            id: t.id,
            originalText: t.title || t.originalText,
            result: null,
            status: 'pending' as const,
            expanded: false,
            selected: true,
          }));
          setTasks(loadProgress(initial));

          // Pre-warm knowledge context cache in background — makes first clarify instant
          const taskIds = filtered.map((t: any) => t.id);
          fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'warm-context', taskIds: taskIds.slice(0, 20) }),
          }).catch(() => {});
        }
      } catch {
        toast({ title: 'Failed to load inbox', description: 'Could not fetch tasks for clarification.', duration: 5000 });
      } finally {
        setLoading(false);
      }
    }
    loadInbox();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelect = (index: number) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, selected: !t.selected } : t
    ));
  };

  const selectAll = () => {
    const awaitingIds = new Set(tasks.filter(t => t.status === 'done' && t.splitInto).map(t => t.id));
    const isPending = (t: ProcessedTask) => t.status === 'pending' && !awaitingIds.has(t.splitFromId || '');
    const allSelected = tasks.filter(isPending).every(t => t.selected);
    setTasks(prev => prev.map(t =>
      isPending(t) ? { ...t, selected: !allSelected } : t
    ));
  };

  const processSelected = async () => {
    const count = tasks.filter(t => t.selected && t.status === 'pending').length;
    if (count > 50 && !window.confirm(`This will make ${count} LLM calls. This may take a while and use API credits. Continue?`)) {
      return;
    }
    setProcessing(true);
    setProcessedCount(0);
    setProcessingStartTime(Date.now());

    const awaitingIds = new Set(tasks.filter(t => t.status === 'done' && t.splitInto).map(t => t.id));
    const toProcess = tasks
      .map((t, i) => ({ task: t, index: i }))
      .filter(({ task }) => task.selected && (task.status === 'pending' || task.status === 'error') && !awaitingIds.has(task.splitFromId || ''));
    setProcessingTotal(toProcess.length);

    // Process in parallel batches of 3 for speed
    const BATCH_SIZE = 5;
    for (let b = 0; b < toProcess.length; b += BATCH_SIZE) {
      const batch = toProcess.slice(b, b + BATCH_SIZE);

      await Promise.all(batch.map(async ({ task, index }) => {
        setTasks(prev => prev.map((t, idx) =>
          idx === index ? { ...t, status: 'processing', streamText: '' } : t
        ));

        try {
          // Try fallback (non-streaming) first for parallel speed since streaming
          // is sequential by nature and blocks the response
          const res = await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'clarify',
              taskId: task.id,
              ...(task.noSplit ? { additionalInstructions: 'Do NOT decompose or split this task. Keep it as a single task. Set decompositionNeeded to false and subtasks to [].' } : {}),
            }),
          });

          if (res.ok) {
            const result = sanitizeResult(await res.json());

            // Auto-split if LLM says decomposition is needed (skip if user said no)
            const didSplit = !task.noSplit && await autoSplitIfNeeded(result, task.id);
            if (didSplit) {
              setProcessedCount(prev => prev + 1);
              return;
            }

            const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
            const autoApprove = result.confidence >= autoApproveThreshold && !needsInput;
            setTasks(prev => prev.map((t, idx) =>
              idx === index ? { ...t, result, status: needsInput ? 'needs-input' : autoApprove ? 'approved' : 'done', expanded: needsInput, streamText: undefined } : t
            ));

            // Auto-approve: push to Todoist immediately
            if (autoApprove) {
              try {
                await fetch('/api/todoist', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'apply-clarification', taskId: task.id, clarification: result }),
                });
              } catch {
                // Revert to 'done' so user can manually approve
                setTasks(prev => prev.map((t, idx) =>
                  idx === index ? { ...t, status: 'done' } : t
                ));
              }
            }

            setProcessedCount(prev => prev + 1);
          } else {
            setTasks(prev => prev.map((t, idx) =>
              idx === index ? { ...t, status: 'error', streamText: undefined } : t
            ));
          }
        } catch {
          setTasks(prev => prev.map((t, idx) =>
            idx === index ? { ...t, status: 'error', streamText: undefined } : t
          ));
        }
      }));
    }

    setProcessing(false);
    window.dispatchEvent(new Event('llm-complete'));
  };

  const approveTask = async (index: number) => {
    const task = tasks[index];
    if (!task.result) return;
    if (isActionBusy(task.id)) return;
    markBusy(task.id);

    // Apply any overrides from editing
    const clarificationToApply = task.editDraft
      ? { ...task.result, ...task.editDraft }
      : task.result;

    // Optimistically collapse
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, status: 'approved', expanded: false, editing: false, editDraft: undefined } : t
    ));

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply-clarification',
          taskId: task.id,
          clarification: clarificationToApply,
        }),
      });
      if (res.ok) {
        pushUndo({
          action: 'clarify_approved',
          taskId: task.id,
          taskTitle: task.originalText,
          previousSnapshot: {
            status: 'inbox', priority: null, dueDate: null,
            bumpCount: null, labels: null, blockerNote: null,
            completedAt: null, todoistId: null,
          },
        });
      } else {
        // Revert on failure
        setTasks(prev => prev.map((t, idx) =>
          idx === index ? { ...t, status: 'done', result: clarificationToApply } : t
        ));
      }
    } catch {
      setTasks(prev => prev.map((t, idx) =>
        idx === index ? { ...t, status: 'done', result: clarificationToApply } : t
      ));
    }
  };

  const unapproveTask = (index: number) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, status: 'done', expanded: true } : t
    ));
  };

  const rejectTask = async (index: number) => {
    const task = tasks[index];
    if (!task) return;

    // If this task was split, clean up the split children from Todoist
    const children = tasks.filter(t => t.splitFromId === task.id);
    setTasks(prev =>
      prev.filter(t => t.splitFromId !== task.id).map((t, idx) =>
        idx === index ? { ...t, status: 'rejected' as const, result: null, expanded: false, editing: false, editDraft: undefined, splitInto: undefined } : t
      )
    );

    // Delete split children from Todoist (non-blocking)
    for (const child of children) {
      try {
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', taskId: child.id }),
        });
      } catch {}
    }
  };

  const completeTaskInClarify = async (index: number) => {
    const task = tasks[index];
    if (!task) return;
    if (isActionBusy(task.id)) return;
    markBusy(task.id);
    const taskId = task.id;

    // Only mark this specific task by ID, not index (prevents marking all tasks)
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'completed' as const } : t
    ));

    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete-in-clarify', taskId }),
      });
      pushUndo({
        action: 'completed',
        taskId,
        taskTitle: task.originalText,
        previousSnapshot: {
          status: 'inbox', priority: null, dueDate: null,
          bumpCount: null, labels: null, blockerNote: null,
          completedAt: null, todoistId: null,
        },
      });
    } catch {
      // Revert on failure
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: task.result ? 'done' as const : 'pending' as const } : t
      ));
    }
  };

  const undoComplete = (index: number) => {
    const task = tasks[index];
    if (!task) return;
    const taskId = task.id;
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: t.result ? 'done' as const : 'pending' as const } : t
    ));
  };

  const startEditing = (index: number) => {
    const task = tasks[index];
    if (!task.result) return;
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, editing: true, expanded: true, editDraft: { ...t.result! } } : t
    ));
  };

  const updateDraft = (index: number, field: string, value: any) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, editDraft: { ...t.editDraft, [field]: value } } : t
    ));
  };

  const cancelEditing = (index: number) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, editing: false, editDraft: undefined } : t
    ));
  };

  const saveEdits = (index: number) => {
    const task = tasks[index];
    if (!task.editDraft) return;
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, result: { ...t.result!, ...t.editDraft }, editing: false, editDraft: undefined } : t
    ));
  };

  const approveAllDone = async () => {
    const doneTasks = tasks.filter(t => t.status === 'done' && !t.splitInto && t.result);
    for (const task of doneTasks) {
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) await approveTask(idx);
    }
  };

  const reclarifyWithInstructions = async (index: number, instructions: string) => {
    const task = tasks[index];
    if (!task) return;
    const taskId = task.id;

    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: 'processing' as const, streamText: '' } : t
    ));

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clarify',
          taskId,
          additionalInstructions: instructions,
        }),
      });

      if (res.ok) {
        const result = sanitizeResult(await res.json());

        // Auto-split if LLM says decomposition is needed (respect noSplit flag)
        const didSplit = !task.noSplit && await autoSplitIfNeeded(result, taskId);
        if (didSplit) return;

        const needsInput = result.confidence < 0.7 && (result.questions?.length ?? 0) > 0;
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, result, status: needsInput ? 'needs-input' as const : 'done' as const, expanded: true, streamText: undefined, editing: false, editDraft: undefined } : t
        ));
      } else {
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'error' as const, streamText: undefined } : t
        ));
      }
    } catch {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'error' as const, streamText: undefined } : t
      ));
    }
  };

  const splitTask = async (index: number, splitTexts: string[]) => {
    const task = tasks[index];
    if (!task || splitTexts.length === 0) return;
    const taskId = task.id;

    // Create new tasks from split texts
    const newTasks: ProcessedTask[] = [];
    for (const text of splitTexts) {
      if (!text.trim()) continue;
      try {
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quick-add', content: text.trim() }),
        });
        if (res.ok) {
          const created = await res.json();
          newTasks.push({
            id: created.id,
            originalText: text.trim(),
            result: null,
            status: 'pending',
            expanded: false,
            selected: true,
            splitFromId: taskId,
          });
        }
      } catch {
        // Skip failed creates
      }
    }

    // Mark original as split and add new tasks
    setTasks(prev => {
      const updated = prev.map(t =>
        t.id === taskId ? { ...t, status: 'done' as const, result: null, expanded: false, splitInto: newTasks.length } : t
      );
      return [...updated, ...newTasks];
    });
  };

  const toggleExpand = (index: number) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, expanded: !t.expanded } : t
    ));
  };

  const submitAnswer = async (index: number, answer: string) => {
    const task = tasks[index];
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, status: 'processing' } : t
    ));

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'answer-clarify',
          taskId: task.id,
          answer,
        }),
      });

      if (res.ok) {
        const result: ClarifyResult = await res.json();
        setTasks(prev => prev.map((t, idx) =>
          idx === index ? { ...t, result, status: 'done', answer } : t
        ));
      }
    } catch {
      setTasks(prev => prev.map((t, idx) =>
        idx === index ? { ...t, status: 'needs-input' } : t
      ));
    }
  };

  // Tasks with a splitFromId whose parent is still awaiting confirmation are shown under the parent banner, not in pending
  const awaitingSplitParentIds = new Set(tasks.filter(t => t.status === 'done' && t.splitInto).map(t => t.id));
  const pendingTasks = tasks.filter(t => (t.status === 'pending' || t.status === 'error') && !awaitingSplitParentIds.has(t.splitFromId || ''));
  const processingTasks = tasks.filter(t => t.status === 'processing' && !t.streamText);
  const selectedCount = pendingTasks.filter(t => t.selected).length;
  // Only count tasks that are actually visible (have results and no splitInto flag)
  const doneTasks = tasks.filter(t => t.status === 'done' && !t.splitInto && t.result);
  const doneCount = doneTasks.length;
  const splitCount = tasks.filter(t => t.status === 'done' && t.splitInto).length;
  const needsInputCount = tasks.filter(t => t.status === 'needs-input').length;
  const approvedCount = tasks.filter(t => t.status === 'approved' && t.result).length;
  const rejectedCount = tasks.filter(t => t.status === 'rejected').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  // Focus index for keyboard nav through processed tasks
  const [focusedDoneIdx, setFocusedDoneIdx] = useState(0);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (processing) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusedDoneIdx(prev => Math.min(prev + 1, doneTasks.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusedDoneIdx(prev => Math.max(prev - 1, 0));
          break;
        case 'a': {
          // Approve focused task
          const task = doneTasks[focusedDoneIdx];
          if (task) {
            e.preventDefault();
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx >= 0) approveTask(idx);
          }
          break;
        }
        case 'e': {
          // Edit focused task
          const task = doneTasks[focusedDoneIdx];
          if (task) {
            e.preventDefault();
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx >= 0) startEditing(idx);
          }
          break;
        }
        case 'x': {
          // Reject focused task
          const task = doneTasks[focusedDoneIdx];
          if (task) {
            e.preventDefault();
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx >= 0) rejectTask(idx);
          }
          break;
        }
        case 'd': {
          // Mark focused task as already done (2-min rule)
          const task = doneTasks[focusedDoneIdx];
          if (task) {
            e.preventDefault();
            const idx = tasks.findIndex(t => t.id === task.id);
            if (idx >= 0) completeTaskInClarify(idx);
          }
          break;
        }
        case ' ':
          e.preventDefault();
          if (pendingTasks.length > 0) selectAll();
          break;
        case 'Enter':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedCount > 0 && !processing) processSelected();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doneTasks, focusedDoneIdx, tasks, processing, selectedCount, pendingTasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
        <PageHeader title="Clarify" description="Transform messy captures into perfect next actions" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-lg bg-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Clarify"
        description="Transform messy captures into perfect next actions"
        action={
          tasks.length > 0 && !processing ? (
            <button
              onClick={processSelected}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Process{selectedCount < pendingTasks.length ? ` Selected (${selectedCount})` : ` All (${selectedCount})`}
            </button>
          ) : processing ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Processing {processedCount}/{processingTotal}...</span>
              {processedCount > 0 && processingStartTime && (
                <span className="text-xs text-primary">
                  {(processedCount / ((Date.now() - processingStartTime) / 60000)).toFixed(1)} tasks/min
                </span>
              )}
            </div>
          ) : null
        }
      />

      {tasks.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing to clarify"
          description="Your inbox is empty. Capture some tasks first."
        />
      ) : (
        <>
          {/* Progress Bar (visible during processing) */}
          {processing && processingTotal > 0 && (
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{Math.round((processedCount / processingTotal) * 100)}% complete</span>
                <span>{processedCount} of {processingTotal} tasks</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${(processedCount / processingTotal) * 100}%` }}
                />
              </div>
            </div>
          )}
          {/* GTD Clarification Guide */}
          {pendingTasks.length > 0 && !processing && (
            guideOpen ? (
            <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary/70">
                  GTD Clarify Questions — Ask yourself for each item:
                </span>
                <div className="flex items-center gap-2">
                  <span className="hidden text-[10px] text-muted-foreground/60 sm:block">
                    j/k navigate · a approve · e edit · x reject · d done · Ctrl+Enter process
                  </span>
                  <button
                    onClick={() => { setGuideOpen(false); localStorage.setItem('clarify-guide-dismissed', '1'); }}
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                    title="Dismiss guide"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3 sm:gap-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 font-bold text-primary">1.</span>
                  <span><strong>What is it?</strong> Identify the actual commitment or reference.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 font-bold text-primary">2.</span>
                  <span><strong>Is it actionable?</strong> If not → trash, reference, or someday/maybe.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 font-bold text-primary">3.</span>
                  <span><strong>What&apos;s the next action?</strong> If &lt;2 min → do it now. Otherwise → delegate or defer.</span>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                AI will suggest answers below — review and approve or edit each one. You make the decisions.
              </p>
            </div>
            ) : (
            <button
              onClick={() => { setGuideOpen(true); localStorage.removeItem('clarify-guide-dismissed'); }}
              className="mb-4 text-[10px] text-primary/50 hover:text-primary/80 transition-colors"
            >
              Show GTD guide
            </button>
            )
          )}
          {/* Questions Section */}
          {needsInputCount > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-400">
                <MessageCircle className="h-4 w-4" />
                Needs Your Input ({needsInputCount})
              </h2>
              <div className="space-y-2">
                {tasks.map((task, i) => task.status === 'needs-input' && task.result && (
                  <QuestionCard
                    key={task.id}
                    task={task}
                    onSubmit={(answer) => submitAnswer(i, answer)}
                    onComplete={() => completeTaskInClarify(i)}
                    onReject={() => rejectTask(i)}
                    onEdit={() => startEditing(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Auto-Processed Section */}
          {(doneCount > 0 || approvedCount > 0 || splitCount > 0) && (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-green-400">
                  <Check className="h-4 w-4" />
                  Processed ({doneCount + approvedCount + splitCount})
                </h2>
                <div className="flex items-center gap-2">
                  <span className="hidden text-[10px] text-muted-foreground/60 sm:block">
                    j/k navigate · a approve · e edit · x reject · d done
                  </span>
                  {doneCount > 0 && (
                    <button
                      onClick={approveAllDone}
                      className="rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
                    >
                      Approve All ({doneCount})
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                {tasks.map((task, i) => task.status === 'done' && task.splitInto && (
                  <div key={task.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex items-center gap-2 sm:flex-1">
                        <GitBranch className="h-4 w-4 shrink-0 text-amber-400" />
                        <span className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{task.originalText}</span>
                          {' → split into '}<span className="font-semibold text-amber-400">{task.splitInto} tasks</span>
                        </span>
                      </div>
                      <div className="flex gap-2 sm:shrink-0">
                        <button
                          onClick={() => confirmSplit(i)}
                          className="flex-1 rounded-lg bg-green-500/20 px-3 py-2.5 text-xs font-medium text-green-400 hover:bg-green-500/30 sm:flex-initial sm:py-1.5"
                        >
                          <Check className="mr-1 inline h-3 w-3" /> Looks good
                        </button>
                        <button
                          onClick={() => keepOriginal(i)}
                          className="flex-1 rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:flex-initial sm:py-1.5"
                          title="Discard split children and keep as a single task"
                        >
                          Keep as One
                        </button>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1 pl-8">
                      {tasks.filter(t => t.splitFromId === task.id).map(child => (
                        <li key={child.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="text-amber-400/50">↳</span>
                          <span className="flex-1">{child.originalText}</span>
                          <button
                            onClick={() => deleteSplitChild(child.id, task.id)}
                            className="rounded p-1 text-muted-foreground/40 hover:bg-destructive/20 hover:text-destructive"
                            title="Remove this task"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {tasks.map((task, i) => (task.status === 'done' || task.status === 'approved') && task.result && !task.splitInto && (
                  <ProcessedCard
                    key={task.id}
                    task={task}
                    expanded={task.expanded}
                    focused={doneTasks[focusedDoneIdx]?.id === task.id}
                    onToggle={() => toggleExpand(i)}
                    onApprove={() => approveTask(i)}
                    onUnapprove={() => unapproveTask(i)}
                    onReject={() => rejectTask(i)}
                    onComplete={() => completeTaskInClarify(i)}
                    onEdit={() => startEditing(i)}
                    onUpdateDraft={(field, value) => updateDraft(i, field, value)}
                    onSaveEdits={() => saveEdits(i)}
                    onCancelEditing={() => cancelEditing(i)}
                    onReclarify={(instructions) => reclarifyWithInstructions(i, instructions)}
                    onSplit={(texts) => splitTask(i, texts)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Currently Streaming */}
          {tasks.some(t => t.status === 'processing' && t.streamText) && (
            <div className="mb-6" aria-live="polite">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI Thinking...
              </h2>
              {tasks.map(task => task.status === 'processing' && task.streamText && (
                <div key={task.id} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="mb-2 text-xs text-muted-foreground">{task.originalText}</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs font-mono text-muted-foreground">
                    {task.streamText}
                    <span className="animate-pulse">|</span>
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Completed / Rejected Summary */}
          {(completedCount > 0 || rejectedCount > 0) && (
            <div className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Resolved ({completedCount + rejectedCount})
              </h2>
              <div className="space-y-1">
                {tasks.map((task, i) => (task.status === 'completed' || task.status === 'rejected') && (
                  <div key={task.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground opacity-50 group">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <RotateCcw className="h-4 w-4 text-amber-400" />
                    )}
                    <span className={task.status === 'completed' ? 'line-through flex-1' : 'flex-1'}>{task.originalText}</span>
                    <span className="text-xs">
                      {task.status === 'completed' ? 'Completed' : task.splitInto ? `Split into ${task.splitInto} tasks` : 'Back to inbox'}
                    </span>
                    {task.status === 'completed' && (
                      <button
                        onClick={() => undoComplete(i)}
                        className="touch-show flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/60 opacity-0 transition-opacity hover:bg-amber-500/20 hover:text-amber-400 group-hover:opacity-100 sm:h-auto sm:w-auto sm:rounded sm:p-1"
                        title="Undo complete"
                      >
                        <Undo2 className="h-4 w-4 sm:h-3 sm:w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Section (also shows processing tasks) */}
          {(pendingTasks.length > 0 || processingTasks.length > 0) && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    {processingTasks.length > 0 ? `Processing (${processingTasks.length})` : `Pending (${pendingTasks.length})`}
                  </h2>
                  {selectedCount > 0 && selectedCount < pendingTasks.length && (
                    <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {selectedCount} selected
                    </span>
                  )}
                </div>
                <button
                  onClick={selectAll}
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-label={pendingTasks.every(t => t.selected) ? 'Deselect all pending tasks' : 'Select all pending tasks'}
                >
                  {pendingTasks.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <ul role="list" aria-label="Pending tasks" className="space-y-1">
                {tasks.map((task, i) => (task.status === 'pending' || task.status === 'error' || (task.status === 'processing' && !task.streamText)) && (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground"
                  >
                    {task.status === 'processing' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <button
                        onClick={() => toggleSelect(i)}
                        aria-label={`${task.selected ? 'Deselect' : 'Select'} task: ${task.originalText}`}
                        aria-pressed={task.selected}
                        className={cn(
                          'h-4 w-4 rounded border transition-colors shrink-0',
                          task.selected
                            ? 'border-primary bg-primary'
                            : 'border-border hover:border-muted-foreground',
                        )}
                      >
                        {task.selected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </button>
                    )}
                    <span className={cn('italic break-words', task.status === 'error' && 'text-destructive')}>
                      {task.originalText}
                      {task.status === 'error' && ' (failed — will retry)'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function QuestionCard({
  task,
  onSubmit,
  onComplete,
  onReject,
  onEdit,
}: {
  task: ProcessedTask;
  onSubmit: (answer: string) => void;
  onComplete: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('audio', blob);
          const res = await fetch('/api/voice', { method: 'POST', body: formData });
          if (res.ok) {
            const data = await res.json();
            if (data.transcript) {
              setAnswer(prev => prev ? `${prev} ${data.transcript}` : data.transcript);
            }
          }
        } catch (err) {
          console.error('Transcription failed:', err);
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      console.error('Microphone access denied:', error);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-2 text-xs font-medium text-amber-400/80">
        🔶 &ldquo;{task.originalText}&rdquo;
      </div>
      {task.result && (
        <>
          <p className="mb-2 text-sm">
            → I think this means: <span className="font-medium text-foreground">{task.result.title}</span>
          </p>
          {(task.result.questions || []).map((q, i) => (
            <p key={i} className="mb-2 text-sm text-muted-foreground">→ {q}</p>
          ))}
        </>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && answer.trim() && onSubmit(answer)}
          placeholder={transcribing ? 'Transcribing...' : 'Your answer...'}
          disabled={transcribing}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={recording ? stopRecording : startRecording}
          disabled={transcribing}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium transition-all',
            recording
              ? 'bg-destructive text-destructive-foreground animate-pulse'
              : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            transcribing && 'opacity-50',
          )}
          title={recording ? 'Stop recording' : 'Dictate answer'}
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : recording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => answer.trim() && onSubmit(answer)}
          disabled={!answer.trim() || transcribing}
          className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={onEdit} className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1">
          <Pencil className="mr-1 inline h-3 w-3" /> Edit & Approve
        </button>
        <button onClick={onComplete} className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1">
          <CheckCircle2 className="mr-1 inline h-3 w-3" /> Already Done
        </button>
        <button onClick={onReject} className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1">
          <X className="mr-1 inline h-3 w-3" /> Reject
        </button>
      </div>
    </div>
  );
}

function ProcessedCard({
  task,
  expanded,
  focused,
  onToggle,
  onApprove,
  onUnapprove,
  onReject,
  onComplete,
  onEdit,
  onUpdateDraft,
  onSaveEdits,
  onCancelEditing,
  onReclarify,
  onSplit,
}: {
  task: ProcessedTask;
  expanded: boolean;
  focused?: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onUnapprove: () => void;
  onReject: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onUpdateDraft: (field: string, value: any) => void;
  onSaveEdits: () => void;
  onCancelEditing: () => void;
  onReclarify: (instructions: string) => void;
  onSplit: (texts: string[]) => void;
}) {
  const r = task.result!;
  const draft = task.editDraft;
  const isApproved = task.status === 'approved';
  const isEditing = task.editing;
  const [reinstructMode, setReinstructMode] = useState(false);
  const [reinstructText, setReinstructText] = useState('');
  const [reinstructRecording, setReinstructRecording] = useState(false);
  const reinstructRecorder = useRef<MediaRecorder | null>(null);
  const reinstructChunks = useRef<Blob[]>([]);
  const [splitMode, setSplitMode] = useState(false);
  const [splitTexts, setSplitTexts] = useState(['', '']);

  const startReinstructRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      reinstructChunks.current = [];
      recorder.ondataavailable = (e) => reinstructChunks.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(reinstructChunks.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob);
        try {
          const res = await fetch('/api/voice', { method: 'POST', body: formData });
          if (res.ok) {
            const data = await res.json();
            const transcript = data.transcript || (data.tasks || []).map((t: any) => t.text).join('. ');
            setReinstructText(prev => prev ? `${prev} ${transcript}` : transcript);
          }
        } catch {}
      };
      recorder.start();
      reinstructRecorder.current = recorder;
      setReinstructRecording(true);
    } catch {}
  };

  const stopReinstructRecording = () => {
    reinstructRecorder.current?.stop();
    setReinstructRecording(false);
  };

  // Collapsed approved card
  if (isApproved && !expanded) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/5 px-3 py-2.5 opacity-70 sm:flex-nowrap sm:gap-3 sm:px-4">
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm text-muted-foreground line-through flex-1 min-w-0 truncate">{task.originalText}</span>
        <span className="hidden text-xs text-green-400 sm:inline">→ {r.title}</span>
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-medium',
          r.confidence >= 0.8 ? 'bg-green-500/20 text-green-400' : r.confidence >= 0.6 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400',
        )}>
          {Math.round(r.confidence * 100)}%
        </span>
        <button onClick={onToggle} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground sm:h-auto sm:w-auto sm:p-0">
          <ChevronDown className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        </button>
        <button onClick={onUnapprove} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground sm:h-auto sm:w-auto sm:p-0" title="Undo approval">
          <Undo2 className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-xl border p-3 transition-all sm:p-4',
      isApproved
        ? 'border-green-500/20 bg-green-500/5'
        : focused
        ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
        : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="space-y-2">
        <div className="flex-1 min-w-0">
          <div className="mb-1 text-xs text-muted-foreground line-through">{task.originalText}</div>
          {isEditing ? (
            <input
              value={draft?.title ?? r.title}
              onChange={(e) => onUpdateDraft('title', e.target.value)}
              className="w-full rounded border border-primary/50 bg-card px-2 py-1.5 text-sm font-medium focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="font-medium">{r.title}</div>
          )}
          {isEditing ? (
            <input
              value={draft?.nextAction ?? r.nextAction}
              onChange={(e) => onUpdateDraft('nextAction', e.target.value)}
              className="mt-1 w-full rounded border border-primary/50 bg-card px-2 py-1.5 text-sm text-muted-foreground focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">{r.nextAction}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEditing ? (
            <select
              value={draft?.priority ?? r.priority}
              onChange={(e) => onUpdateDraft('priority', Number(e.target.value))}
              className="rounded border border-primary/50 bg-card px-1.5 py-1 text-xs focus:outline-none"
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
              <option value={4}>P4</option>
            </select>
          ) : (
            <PriorityBadge priority={r.priority} />
          )}
          <EnergyBadge level={isEditing ? (draft?.energyLevel ?? r.energyLevel) : r.energyLevel} />
          <TimeEstimate minutes={r.timeEstimateMin} />
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isEditing ? (
          <input
            value={draft?.projectName ?? r.projectName}
            onChange={(e) => onUpdateDraft('projectName', e.target.value)}
            className="rounded border border-primary/50 bg-card px-2 py-0.5 text-xs focus:outline-none"
            placeholder="Project name"
          />
        ) : (
          <ProjectBadge name={r.projectName} />
        )}
        {(r.labels || []).map(l => (
          <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            @{l}
          </span>
        ))}
        {r.dueDate && (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
            📅 {r.dueDate}
          </span>
        )}
        <span className={cn(
          'ml-auto rounded px-1.5 py-0.5 text-xs font-medium',
          r.confidence >= 0.8 ? 'bg-green-500/10 text-green-400' : r.confidence >= 0.6 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400',
        )}>
          {Math.round(r.confidence * 100)}% confident
        </span>
      </div>

      {/* AI Reasoning Summary — always visible */}
      {!expanded && r.priorityReasoning && (
        <div className="mt-2 rounded-md bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/70">AI: </span>
          P{r.priority} — {r.priorityReasoning.length > 120 ? r.priorityReasoning.slice(0, 120) + '…' : r.priorityReasoning}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* AI Before/After Comparison */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="mb-2 text-xs font-semibold text-primary/80">🤖 What AI Changed</div>
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-3">
              <div>
                <div className="mb-1 font-medium text-muted-foreground">Before (raw capture)</div>
                <div className="rounded bg-secondary/80 p-2 italic text-muted-foreground">{task.originalText}</div>
              </div>
              <div>
                <div className="mb-1 font-medium text-foreground">After (AI clarified)</div>
                <div className="rounded bg-green-500/10 p-2 text-foreground">{r.title}</div>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground/80">Next action: </span>{r.nextAction}
              </div>
              <div>
                <span className="font-medium text-foreground/80">Project: </span>{r.projectName}{r.newProject ? ' (new)' : ''}
              </div>
              <div>
                <span className="font-medium text-foreground/80">Why P{r.priority}: </span>{r.priorityReasoning}
              </div>
              <div>
                <span className="font-medium text-foreground/80">Confidence: </span>
                <span className={cn(
                  r.confidence >= 0.8 ? 'text-green-400' : r.confidence >= 0.6 ? 'text-amber-400' : 'text-red-400',
                )}>
                  {Math.round(r.confidence * 100)}%
                </span>
              </div>
            </div>
          </div>

          {isEditing ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Context Notes</label>
              <textarea
                value={draft?.contextNotes ?? r.contextNotes}
                onChange={(e) => onUpdateDraft('contextNotes', e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border border-primary/50 bg-card px-2 py-1 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          ) : r.contextNotes ? (
            <div className="text-sm">
              <span className="font-medium text-muted-foreground">Context: </span>
              {r.contextNotes}
            </div>
          ) : null}
          {r.decompositionNeeded && r.subtasks?.length > 0 && (
            <div>
              <span className="text-sm font-medium text-muted-foreground">Subtasks:</span>
              <ul className="mt-1 space-y-1 pl-4">
                {r.subtasks.map((s, i) => (
                  <li key={i} className="text-sm">{s.title}</li>
                ))}
              </ul>
            </div>
          )}
          {r.relatedPeople?.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">People: </span>{r.relatedPeople.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Re-instruct AI mode */}
      {reinstructMode && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 text-xs font-medium text-primary/80">
            <MessageSquare className="mr-1 inline h-3 w-3" />
            Tell the AI what to do differently:
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={reinstructText}
              onChange={(e) => setReinstructText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && reinstructText.trim()) {
                  onReclarify(reinstructText);
                  setReinstructMode(false);
                  setReinstructText('');
                }
              }}
              placeholder='e.g. "This is a work task, not personal" or "Split into sub-tasks"'
              autoFocus
              className="flex-1 rounded border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <button
              onClick={reinstructRecording ? stopReinstructRecording : startReinstructRecording}
              className={cn(
                'shrink-0 rounded-lg px-2.5 py-2 text-xs transition-colors',
                reinstructRecording
                  ? 'bg-destructive text-destructive-foreground animate-pulse'
                  : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              title={reinstructRecording ? 'Stop recording' : 'Dictate instructions'}
            >
              {reinstructRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => { if (reinstructText.trim()) { onReclarify(reinstructText); setReinstructMode(false); setReinstructText(''); } }}
              disabled={!reinstructText.trim()}
              className="rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30 disabled:opacity-50"
            >
              Re-clarify
            </button>
            <button
              onClick={() => { setReinstructMode(false); setReinstructText(''); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Split task mode */}
      {splitMode && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 text-xs font-medium text-amber-400/80">
            <GitBranch className="mr-1 inline h-3 w-3" />
            Split &ldquo;{task.originalText}&rdquo; into separate tasks:
          </div>
          <div className="space-y-2">
            {splitTexts.map((text, si) => (
              <div key={si} className="flex gap-2">
                <span className="mt-2 text-xs text-muted-foreground">{si + 1}.</span>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setSplitTexts(prev => prev.map((t, j) => j === si ? e.target.value : t))}
                  placeholder={`Task ${si + 1}...`}
                  autoFocus={si === 0}
                  className="flex-1 rounded border border-border bg-card px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setSplitTexts(prev => [...prev, ''])}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              + Add another
            </button>
            <button
              onClick={() => { const valid = splitTexts.filter(t => t.trim()); if (valid.length > 0) { onSplit(valid); setSplitMode(false); setSplitTexts(['', '']); } }}
              disabled={splitTexts.every(t => !t.trim())}
              className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
            >
              Split & Create {splitTexts.filter(t => t.trim()).length} tasks
            </button>
            <button
              onClick={() => { setSplitMode(false); setSplitTexts(['', '']); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isEditing ? (
          <>
            <button
              onClick={onSaveEdits}
              className="rounded-lg bg-primary/20 px-3 py-2.5 text-xs font-medium text-primary hover:bg-primary/30 sm:py-1.5"
            >
              <Check className="mr-1 inline h-3 w-3" /> Save & Approve
            </button>
            <button
              onClick={onCancelEditing}
              className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1.5"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!isApproved && (
              <button
                onClick={onApprove}
                className="rounded-lg bg-green-500/20 px-3 py-2.5 text-xs font-medium text-green-400 hover:bg-green-500/30 sm:py-1.5"
              >
                <Check className="mr-1 inline h-3 w-3" /> Approve
              </button>
            )}
            {isApproved && (
              <button
                onClick={onUnapprove}
                className="rounded-lg bg-amber-500/20 px-3 py-2.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30 sm:py-1.5"
              >
                <Undo2 className="mr-1 inline h-3 w-3" /> Undo
              </button>
            )}
            {!isApproved && (
              <button
                onClick={onEdit}
                className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1.5"
              >
                <Pencil className="mr-1 inline h-3 w-3" /> Edit
              </button>
            )}
            {!isApproved && (
              <button
                onClick={() => setReinstructMode(true)}
                className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1.5"
              >
                <MessageSquare className="mr-1 inline h-3 w-3" /> Re-instruct
              </button>
            )}
            {!isApproved && (
              <button
                onClick={() => setSplitMode(true)}
                className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1.5"
              >
                <GitBranch className="mr-1 inline h-3 w-3" /> Split
              </button>
            )}
            {!isApproved && (
              <button
                onClick={onComplete}
                className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent sm:py-1.5"
              >
                <CheckCircle2 className="mr-1 inline h-3 w-3" /> Done
              </button>
            )}
            {!isApproved && r.timeEstimateMin > 0 && r.timeEstimateMin <= 2 && (
              <button
                onClick={onComplete}
                className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30"
                title="GTD 2-minute rule: if it takes less than 2 minutes, do it now"
              >
                <Zap className="mr-1 inline h-3 w-3" /> Do Now (&lt;2min)
              </button>
            )}
            {!isApproved && (
              <button
                onClick={onReject}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-destructive/70 hover:bg-destructive/10"
              >
                <X className="mr-1 inline h-3 w-3" /> Reject
              </button>
            )}
          </>
        )}
        <button
          onClick={onToggle}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent ml-auto"
        >
          {expanded ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
          {expanded ? ' Less' : ' More'}
        </button>
      </div>
    </div>
  );
}
