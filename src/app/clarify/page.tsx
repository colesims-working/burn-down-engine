'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sparkles, Check, ChevronDown, ChevronUp, Loader2, MessageCircle, Mic, MicOff, X, RotateCcw, Pencil, CheckCircle2, Undo2 } from 'lucide-react';
import { PriorityBadge, EnergyBadge, TimeEstimate, ProjectBadge, PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';

interface ClarifyResult {
  title: string;
  nextAction: string;
  projectName: string;
  newProject: boolean;
  priority: number;
  priorityReasoning: string;
  labels: string[];
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
}

export default function ClarifyPage() {
  const searchParams = useSearchParams();
  const filterTaskIds = searchParams.get('taskIds')?.split(',').filter(Boolean) || [];

  const [tasks, setTasks] = useState<ProcessedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

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
      } catch (e) {
        console.error('syncIfStale failed:', e);
      }
    }
    syncIfStale();
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
          setTasks(filtered.map((t: any) => ({
            id: t.id,
            originalText: t.title || t.originalText,
            result: null,
            status: 'pending',
            expanded: false,
            selected: true,
          })));
        }
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
    const allSelected = tasks.filter(t => t.status === 'pending').every(t => t.selected);
    setTasks(prev => prev.map(t =>
      t.status === 'pending' ? { ...t, selected: !allSelected } : t
    ));
  };

  const processSelected = async () => {
    setProcessing(true);
    setProcessedCount(0);

    const toProcess = tasks
      .map((t, i) => ({ task: t, index: i }))
      .filter(({ task }) => task.selected && (task.status === 'pending' || task.status === 'error'));

    for (const { task, index } of toProcess) {
      setTasks(prev => prev.map((t, idx) =>
        idx === index ? { ...t, status: 'processing', streamText: '' } : t
      ));

      try {
        const res = await fetch('/api/clarify-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: task.id }),
        });

        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            setTasks(prev => prev.map((t, idx) =>
              idx === index ? { ...t, streamText: accumulated } : t
            ));
          }

          const cleaned = accumulated.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const result: ClarifyResult = JSON.parse(cleaned);
          const needsInput = result.confidence < 0.7 && result.questions.length > 0;

          setTasks(prev => prev.map((t, idx) =>
            idx === index ? {
              ...t,
              result,
              status: needsInput ? 'needs-input' : 'done',
              expanded: needsInput,
              streamText: undefined,
            } : t
          ));
          setProcessedCount(prev => prev + 1);
        } else {
          const fallback = await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clarify', taskId: task.id }),
          });

          if (fallback.ok) {
            const result: ClarifyResult = await fallback.json();
            const needsInput = result.confidence < 0.7 && result.questions.length > 0;
            setTasks(prev => prev.map((t, idx) =>
              idx === index ? { ...t, result, status: needsInput ? 'needs-input' : 'done', expanded: needsInput, streamText: undefined } : t
            ));
            setProcessedCount(prev => prev + 1);
          } else {
            setTasks(prev => prev.map((t, idx) =>
              idx === index ? { ...t, status: 'error', streamText: undefined } : t
            ));
          }
        }
      } catch {
        setTasks(prev => prev.map((t, idx) =>
          idx === index ? { ...t, status: 'error', streamText: undefined } : t
        ));
      }
    }

    setProcessing(false);
  };

  const approveTask = async (index: number) => {
    const task = tasks[index];
    if (!task.result) return;

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
      if (!res.ok) {
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

  const rejectTask = (index: number) => {
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, status: 'rejected', result: null, expanded: false, editing: false, editDraft: undefined } : t
    ));
  };

  const completeTaskInClarify = async (index: number) => {
    const task = tasks[index];
    setTasks(prev => prev.map((t, idx) =>
      idx === index ? { ...t, status: 'completed' } : t
    ));

    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete-in-clarify', taskId: task.id }),
      });
    } catch (error) {
      console.error('Complete in clarify failed:', error);
    }
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
    const doneTasks = tasks.filter(t => t.status === 'done');
    for (const task of doneTasks) {
      const idx = tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) await approveTask(idx);
    }
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

  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'error');
  const selectedCount = pendingTasks.filter(t => t.selected).length;
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const needsInputCount = tasks.filter(t => t.status === 'needs-input').length;
  const approvedCount = tasks.filter(t => t.status === 'approved').length;
  const rejectedCount = tasks.filter(t => t.status === 'rejected').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

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
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing {processedCount}/{selectedCount}...
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
          {(doneCount > 0 || approvedCount > 0) && (
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-green-400">
                  <Check className="h-4 w-4" />
                  Processed ({doneCount + approvedCount})
                </h2>
                {doneCount > 0 && (
                  <button
                    onClick={approveAllDone}
                    className="rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
                  >
                    Approve All ({doneCount})
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {tasks.map((task, i) => (task.status === 'done' || task.status === 'approved') && task.result && (
                  <ProcessedCard
                    key={task.id}
                    task={task}
                    expanded={task.expanded}
                    onToggle={() => toggleExpand(i)}
                    onApprove={() => approveTask(i)}
                    onUnapprove={() => unapproveTask(i)}
                    onReject={() => rejectTask(i)}
                    onComplete={() => completeTaskInClarify(i)}
                    onEdit={() => startEditing(i)}
                    onUpdateDraft={(field, value) => updateDraft(i, field, value)}
                    onSaveEdits={() => saveEdits(i)}
                    onCancelEditing={() => cancelEditing(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Currently Streaming */}
          {tasks.some(t => t.status === 'processing' && t.streamText) && (
            <div className="mb-6">
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
                {tasks.map(task => (task.status === 'completed' || task.status === 'rejected') && (
                  <div key={task.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground opacity-50">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <RotateCcw className="h-4 w-4 text-amber-400" />
                    )}
                    <span className={task.status === 'completed' ? 'line-through' : ''}>{task.originalText}</span>
                    <span className="ml-auto text-xs">
                      {task.status === 'completed' ? 'Completed' : 'Back to inbox'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending Section */}
          {pendingTasks.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Pending ({pendingTasks.length})
                </h2>
                <button
                  onClick={selectAll}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {pendingTasks.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="space-y-1">
                {tasks.map((task, i) => (task.status === 'pending' || task.status === 'error' || (task.status === 'processing' && !task.streamText)) && (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground"
                  >
                    {task.status === 'processing' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <button
                        onClick={() => toggleSelect(i)}
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
                    <span className={cn('italic', task.status === 'error' && 'text-destructive')}>
                      {task.originalText}
                      {task.status === 'error' && ' (failed — will retry)'}
                    </span>
                  </div>
                ))}
              </div>
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
          {task.result.questions.map((q, i) => (
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
      <div className="mt-2 flex gap-2">
        <button onClick={onEdit} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent">
          <Pencil className="mr-1 inline h-3 w-3" /> Edit & Approve
        </button>
        <button onClick={onComplete} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent">
          <CheckCircle2 className="mr-1 inline h-3 w-3" /> Already Done
        </button>
        <button onClick={onReject} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent">
          <X className="mr-1 inline h-3 w-3" /> Reject
        </button>
      </div>
    </div>
  );
}

function ProcessedCard({
  task,
  expanded,
  onToggle,
  onApprove,
  onUnapprove,
  onReject,
  onComplete,
  onEdit,
  onUpdateDraft,
  onSaveEdits,
  onCancelEditing,
}: {
  task: ProcessedTask;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onUnapprove: () => void;
  onReject: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onUpdateDraft: (field: string, value: any) => void;
  onSaveEdits: () => void;
  onCancelEditing: () => void;
}) {
  const r = task.result!;
  const draft = task.editDraft;
  const isApproved = task.status === 'approved';
  const isEditing = task.editing;

  // Collapsed approved card
  if (isApproved && !expanded) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-2.5 opacity-70">
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm text-muted-foreground line-through flex-1">{task.originalText}</span>
        <span className="text-xs text-green-400">→ {r.title}</span>
        <button onClick={onToggle} className="text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-3 w-3" />
        </button>
        <button onClick={onUnapprove} className="text-xs text-muted-foreground hover:text-foreground" title="Undo approval">
          <Undo2 className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-xl border p-4 transition-all',
      isApproved
        ? 'border-green-500/20 bg-green-500/5'
        : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="mb-1 text-xs text-muted-foreground line-through">{task.originalText}</div>
          {isEditing ? (
            <input
              value={draft?.title ?? r.title}
              onChange={(e) => onUpdateDraft('title', e.target.value)}
              className="w-full rounded border border-primary/50 bg-card px-2 py-1 text-sm font-medium focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="font-medium">{r.title}</div>
          )}
          {isEditing ? (
            <input
              value={draft?.nextAction ?? r.nextAction}
              onChange={(e) => onUpdateDraft('nextAction', e.target.value)}
              className="mt-1 w-full rounded border border-primary/50 bg-card px-2 py-1 text-sm text-muted-foreground focus:outline-none focus:border-primary"
            />
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">{r.nextAction}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isEditing ? (
            <select
              value={draft?.priority ?? r.priority}
              onChange={(e) => onUpdateDraft('priority', Number(e.target.value))}
              className="rounded border border-primary/50 bg-card px-1.5 py-0.5 text-xs focus:outline-none"
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
        {r.labels.map(l => (
          <span key={l} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            @{l}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {Math.round(r.confidence * 100)}% confident
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
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
          {r.decompositionNeeded && r.subtasks.length > 0 && (
            <div>
              <span className="text-sm font-medium text-muted-foreground">Subtasks:</span>
              <ul className="mt-1 space-y-1 pl-4">
                {r.subtasks.map((s, i) => (
                  <li key={i} className="text-sm">• {s.title}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Priority reasoning: {r.priorityReasoning}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isEditing ? (
          <>
            <button
              onClick={onSaveEdits}
              className="rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30"
            >
              <Check className="mr-1 inline h-3 w-3" /> Save & Approve
            </button>
            <button
              onClick={onCancelEditing}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {!isApproved && (
              <button
                onClick={onApprove}
                className="rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/30"
              >
                <Check className="mr-1 inline h-3 w-3" /> Approve
              </button>
            )}
            {isApproved && (
              <button
                onClick={onUnapprove}
                className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30"
              >
                <Undo2 className="mr-1 inline h-3 w-3" /> Undo
              </button>
            )}
            {!isApproved && (
              <button
                onClick={onEdit}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                <Pencil className="mr-1 inline h-3 w-3" /> Edit
              </button>
            )}
            {!isApproved && (
              <button
                onClick={onComplete}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                <CheckCircle2 className="mr-1 inline h-3 w-3" /> Already Done
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
