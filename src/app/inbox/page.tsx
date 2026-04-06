'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Plus, Mic, MicOff, RefreshCw, ArrowRight, Sparkles, Trash2, AlertTriangle, Keyboard, Check, ArrowUpDown, GitMerge, X } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { cn } from '@/lib/utils';
import { useUndo } from '@/components/providers/trust-provider';
import { toast } from '@/hooks/use-toast';
import type { TaskSnapshot } from '@/lib/undo/engine';

interface InboxTask {
  id: string;
  title: string;
  originalText: string;
  createdAt: string;
  duplicateSuspectOf: string | null;
  dupeSimilarity: number | null;
}

function DuplicateGroupCard({ group, groupKey, onMerge, onDismiss }: {
  group: InboxTask[];
  groupKey: string;
  onMerge: (suspectId: string, originalId: string, mergedTitle?: string) => void;
  onDismiss: (groupTaskIds: string[]) => void;
}) {
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [fetchedForKey, setFetchedForKey] = useState<string | null>(null);
  const firstSuspect = group.find(t => t.duplicateSuspectOf);

  // Fetch preview once per unique group (keyed by sorted task IDs)
  useEffect(() => {
    if (fetchedForKey === groupKey) return;
    let cancelled = false;

    async function fetchPreview() {
      setLoadingPreview(true);
      setSuggestedTitle(null);
      try {
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview-merge', titles: group.map(t => t.title) }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSuggestedTitle(data.suggestedTitle);
          setEditingTitle(data.suggestedTitle);
          setFetchedForKey(groupKey);
        }
      } catch {} finally { if (!cancelled) setLoadingPreview(false); }
    }

    fetchPreview();
    return () => { cancelled = true; };
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-lg border border-amber-500/20 bg-card p-3 space-y-2">
      <div className="space-y-1.5">
        {group.map((task, ti) => (
          <div key={task.id} className="flex items-start gap-2 text-sm">
            <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400 font-medium mt-0.5">{ti + 1}</span>
            <span className="break-words text-muted-foreground line-through decoration-amber-500/30">{task.title}</span>
          </div>
        ))}
      </div>

      {firstSuspect?.dupeSimilarity && (
        <div className="text-[10px] text-amber-400/70">{Math.round(firstSuspect.dupeSimilarity * 100)}% similar</div>
      )}

      {/* Merge preview */}
      <div className="rounded-lg bg-secondary/50 px-3 py-2">
        <div className="text-[10px] font-medium text-muted-foreground mb-1">Merge into:</div>
        {loadingPreview ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" /> Generating suggestion...
          </div>
        ) : (
          <input
            type="text"
            value={editingTitle}
            onChange={e => setEditingTitle(e.target.value)}
            className="w-full rounded border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none"
          />
        )}
      </div>

      <div className="flex gap-2">
        {firstSuspect && (
          <button
            onClick={() => onMerge(firstSuspect.id, firstSuspect.duplicateSuspectOf!, editingTitle || undefined)}
            disabled={loadingPreview}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
          >
            <GitMerge className="h-3 w-3" />
            Merge
          </button>
        )}
        {firstSuspect && (
          <button
            onClick={() => onDismiss(group.map(t => t.id))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            <X className="h-3 w-3" />
            Keep All
          </button>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const [tasks, setTasks] = useState<InboxTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const dismissPromiseRef = useRef<Promise<void> | null>(null);
  const [quickAddText, setQuickAddText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceTasks, setVoiceTasks] = useState<{ text: string; confidence: number }[]>([]);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist?action=inbox');
      if (res.ok) {
        const data: InboxTask[] = await res.json();
        // Filter out tasks the user has already completed/deleted in this session
        const filtered = data.filter(t => !removedIdsRef.current.has(t.id));
        setTasks(filtered);
      }
    } catch (error) {
      console.error('Failed to fetch inbox:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Track tasks that have been locally removed (completed/deleted) during this session
  const removedIdsRef = useRef<Set<string>>(new Set());

  // Auto-sync if stale (>5 min since last inbox sync)
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function loadAndSync() {
      // Fetch local tasks and sync state in parallel
      const [tasksRes, stateRes] = await Promise.all([
        fetch('/api/todoist?action=inbox', { signal: controller.signal }).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/todoist?action=sync-state', { signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (cancelled) return;
      setTasks(tasksRes);
      setLoading(false);

      // Check if sync is needed
      const lastSync = stateRes?.lastInboxSync || stateRes?.lastFullSync;
      if (!lastSync || (Date.now() - new Date(lastSync).getTime()) > 5 * 60 * 1000) {
        setSyncing(true);
        try {
          const syncRes = await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync-inbox' }),
            signal: controller.signal,
          });
          if (syncRes.ok && !cancelled) {
            const data = await syncRes.json();
            if (data.tasks) {
              // Merge: keep local-only tasks (temp), exclude removed tasks
              setTasks(prev => {
                const syncedIds = new Set((data.tasks as InboxTask[]).map((t: InboxTask) => t.id));
                const localOnly = prev.filter(t => t.id.startsWith('temp-') || !syncedIds.has(t.id));
                const synced = (data.tasks as InboxTask[]).filter(
                  (t: InboxTask) => !removedIdsRef.current.has(t.id)
                );
                return [...localOnly, ...synced];
              });
              window.dispatchEvent(new Event('inbox-changed'));
            }
          }
        } catch {} finally {
          if (!cancelled) setSyncing(false);
        }

        // Run dedup after sync — waits for any pending dismiss first
        if (!cancelled) {
          await runDedup(controller.signal);
        }
      }
    }
    loadAndSync();
    return () => { cancelled = true; controller.abort(); };
  }, [fetchTasks]);

  // Re-fetch when tasks change elsewhere (e.g. undo)
  useEffect(() => {
    const handler = () => fetchTasks();
    window.addEventListener('task-changed', handler);
    return () => window.removeEventListener('task-changed', handler);
  }, [fetchTasks]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-inbox' }),
      });
      if (res.ok) {
        await fetchTasks();
      }
    } finally {
      setSyncing(false);
      window.dispatchEvent(new Event('inbox-changed'));
    }

    // Run dedup after sync — waits for any pending dismiss first
    await runDedup();
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddText.trim()) return;

    const text = quickAddText.trim();
    // Optimistic: clear input and add placeholder immediately
    setQuickAddText('');
    const tempId = `temp-${Date.now()}`;
    setTasks(prev => [{
      id: tempId,
      title: text,
      originalText: text,
      createdAt: new Date().toISOString(),
      duplicateSuspectOf: null,
      dupeSimilarity: null,
    }, ...prev]);

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quick-add', content: text }),
      });
      if (res.ok) {
        const created = await res.json();
        // Replace temp task with real one
        setTasks(prev => prev.map(t => t.id === tempId ? { ...created } : t));
        window.dispatchEvent(new Event('inbox-changed'));
      } else {
        // Remove temp on failure
        setTasks(prev => prev.filter(t => t.id !== tempId));
      }
    } catch (error) {
      console.error('Quick add failed:', error);
      setTasks(prev => prev.filter(t => t.id !== tempId));
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === normalTasks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(normalTasks.map(t => t.id)));
    }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunks.current = [];

      recorder.ondataavailable = (e) => audioChunks.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        await processVoice(blob);
      };

      recorder.start();
      mediaRecorder.current = recorder;
      setRecording(true);
    } catch (error) {
      console.error('Microphone access denied:', error);
      toast({ title: 'Microphone access denied', description: 'Please allow microphone access in your browser settings.', duration: 5000 });
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setRecording(false);
  };

  const processVoice = async (blob: Blob) => {
    setVoiceProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob);

      const res = await fetch('/api/voice', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        setVoiceTasks(data.tasks || []);
      }
    } catch (error) {
      console.error('Voice processing failed:', error);
    } finally {
      setVoiceProcessing(false);
    }
  };

  const addVoiceTasks = async () => {
    let failed = 0;
    for (const task of voiceTasks) {
      try {
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'quick-add', content: task.text }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      toast({ title: 'Some tasks failed', description: `${failed} of ${voiceTasks.length} voice tasks could not be added.`, duration: 5000 });
    }
    setVoiceTasks([]);
    await fetchTasks();
    window.dispatchEvent(new Event('inbox-changed'));
  };

  const { pushUndo, isActionBusy, markBusy } = useUndo();

  // Two-Minute Rule: complete a task directly from inbox without full GTD workflow
  const quickComplete = async (taskId: string) => {
    if (isActionBusy(taskId)) return;
    markBusy(taskId);

    const task = tasks.find(t => t.id === taskId);
    removedIdsRef.current.add(taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setSelected(prev => { const next = new Set(prev); next.delete(taskId); return next; });
    window.dispatchEvent(new Event('inbox-changed'));
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', taskId }),
      });

      if (task) {
        pushUndo({
          action: 'completed',
          taskId,
          taskTitle: task.title,
          previousSnapshot: {
            status: 'inbox', priority: null, dueDate: null,
            bumpCount: null, labels: null, blockerNote: null,
            completedAt: null, todoistId: null,
          },
        });
      }
      window.dispatchEvent(new Event('task-changed'));
    } catch {
      // Revert on failure — re-fetch
      await fetchTasks();
      window.dispatchEvent(new Event('inbox-changed'));
    }
  };

  // Batch quick-complete: complete all selected tasks
  const batchQuickComplete = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    // Optimistically remove all
    for (const id of ids) {
      removedIdsRef.current.add(id);
    }
    setTasks(prev => prev.filter(t => !ids.includes(t.id)));
    setSelected(new Set());
    window.dispatchEvent(new Event('inbox-changed'));
    // Fire completions in parallel
    await Promise.all(ids.map(id =>
      fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', taskId: id }),
      }).catch(() => {})
    ));
    window.dispatchEvent(new Event('task-changed'));
  };

  // Duplicate management
  const handleMergeDuplicate = async (suspectId: string, originalId: string, mergedTitle?: string) => {
    // Optimistically remove both
    setTasks(prev => prev.filter(t => t.id !== suspectId && t.id !== originalId));
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge-duplicates', primaryTaskId: originalId, duplicateTaskId: suspectId, mergedTitle }),
      });
      if (res.ok) {
        const merged = await res.json();
        // Immediately add merged task to local state so it's visible right away
        setTasks(prev => [{
          id: merged.id,
          title: merged.title,
          originalText: merged.originalText || merged.title,
          createdAt: merged.createdAt || new Date().toISOString(),
          duplicateSuspectOf: null,
          dupeSimilarity: null,
        }, ...prev]);
        toast({ title: 'Tasks merged', description: merged.title, duration: 3000 });
        // Re-run dedup so the merged task is checked against remaining similar tasks
        await runDedup();
      } else {
        await fetchTasks();
      }
    } catch {
      await fetchTasks();
    }
    window.dispatchEvent(new Event('inbox-changed'));
  };

  // Centralized dedup runner — waits for any pending dismiss to complete first
  const runDedup = async (signal?: AbortSignal) => {
    // Wait for any in-flight dismiss to finish before scanning
    if (dismissPromiseRef.current) {
      await dismissPromiseRef.current;
    }
    setDeduping(true);
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-dedup' }),
        signal,
      });
      await fetchTasks();
    } catch {} finally {
      setDeduping(false);
    }
  };

  const handleDismissDuplicate = async (groupTaskIds: string[]) => {
    // Optimistically clear flags on all tasks in the group
    const idSet = new Set(groupTaskIds);
    setTasks(prev => prev.map(t =>
      idSet.has(t.id) ? { ...t, duplicateSuspectOf: null, dupeSimilarity: null } : t
    ));
    // Dismiss each on the server with the full group context
    // Track the promise so runDedup() waits for it to finish
    const dismissWork = Promise.all(groupTaskIds.map(taskId =>
      fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss-duplicate', taskId, groupTaskIds }),
      })
    )).then(() => {}).catch(() => {});
    dismissPromiseRef.current = dismissWork;
    await dismissWork;
    dismissPromiseRef.current = null;
  };

  // Derived: group duplicates into clusters (handles 2+ similar tasks)
  const duplicateGroups = (() => {
    const suspects = tasks.filter(t => t.duplicateSuspectOf);
    if (suspects.length === 0) return [];

    // Build clusters: group by shared original (union-find style)
    const parent = new Map<string, string>(); // task id → cluster root
    function find(id: string): string {
      while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id)!)!); id = parent.get(id)!; }
      return id;
    }
    function union(a: string, b: string) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    }

    // Initialize all involved IDs
    for (const s of suspects) {
      if (!parent.has(s.id)) parent.set(s.id, s.id);
      if (!parent.has(s.duplicateSuspectOf!)) parent.set(s.duplicateSuspectOf!, s.duplicateSuspectOf!);
      union(s.id, s.duplicateSuspectOf!);
    }

    // Group ALL tasks in the union-find into clusters (not just suspects)
    const clusters = new Map<string, InboxTask[]>();
    const seen = new Set<string>();
    for (const [id] of parent) {
      const root = find(id);
      if (!clusters.has(root)) clusters.set(root, []);
      if (seen.has(id)) continue;
      seen.add(id);
      const task = tasks.find(t => t.id === id);
      if (task) clusters.get(root)!.push(task);
    }

    return Array.from(clusters.values()).filter(c => c.length >= 2);
  })();
  const duplicateTaskIds = new Set(duplicateGroups.flatMap(g => g.map(t => t.id)));
  const normalTasks = tasks.filter(t => !duplicateTaskIds.has(t.id));

  // Keyboard navigation
  const [focusIdx, setFocusIdx] = useState(0);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const sortedTasks = [...normalTasks].sort((a, b) => {
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return sortNewestFirst ? db - da : da - db;
  });
  // Microphone cleanup on unmount (BUG-034)
  useEffect(() => {
    return () => {
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (sortedTasks.length === 0) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusIdx(prev => Math.min(prev + 1, sortedTasks.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusIdx(prev => Math.max(prev - 1, 0));
          break;
        case ' ':
          e.preventDefault();
          toggleSelect(sortedTasks[focusIdx]?.id);
          break;
        case 'a':
          e.preventDefault();
          selectAll();
          break;
        default:
          // Let browser handle other keys (End, Home, PageDown, etc.)
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sortedTasks, focusIdx]);

  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Unprocessed captures waiting to be clarified"
        action={
          <div className="flex items-center gap-2">
            {deduping && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Finding duplicates...
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || deduping}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        }
      />

      {/* Quick Add + Voice */}
      <div className="mb-6 flex gap-2">
        <form onSubmit={handleQuickAdd} className="flex flex-1 gap-2">
          <input
            type="text"
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            placeholder="Quick capture..."
            autoFocus
            className="flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:px-4"
          />
          <button
            type="submit"
            disabled={!quickAddText.trim()}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors',
              quickAddText.trim()
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-secondary text-muted-foreground/40 cursor-not-allowed',
            )}
          >
            <Plus className="h-4 w-4" />
          </button>
        </form>

        <button
          onClick={recording ? stopRecording : startRecording}
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all',
            recording
              ? 'bg-destructive text-destructive-foreground recording-indicator'
              : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>

      {/* Inbox Processing Banner */}
      {!loading && tasks.length > 20 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <div className="text-sm font-semibold text-amber-400">
              {tasks.length} items need processing
            </div>
            <p className="mt-1 text-xs text-amber-400/80">
              {tasks.length > 100
                ? 'Large inbox — select a batch and send to Clarify to keep your system trusted.'
                : tasks.length > 50
                ? 'Growing inbox — try processing 20-30 items today to stay on top of things.'
                : 'Select items and move to Clarify to turn captures into clear next actions.'}
            </p>
          </div>
        </div>
      )}

      {/* Voice Processing Results */}
      {voiceProcessing && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Processing voice dump...
          </div>
        </div>
      )}

      {voiceTasks.length > 0 && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <h3 className="mb-3 text-sm font-semibold">Extracted from voice ({voiceTasks.length} tasks)</h3>
          <div className="space-y-2">
            {voiceTasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{task.text}</span>
                <span className="text-xs text-muted-foreground">{Math.round(task.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addVoiceTasks}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Add All to Inbox
            </button>
            <button
              onClick={() => setVoiceTasks([])}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Duplicate Groups */}
      {duplicateGroups.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-400">
            <GitMerge className="h-4 w-4" />
            Possible Duplicates ({duplicateGroups.length} {duplicateGroups.length === 1 ? 'group' : 'groups'})
          </h3>
          <div className="space-y-3">
            {duplicateGroups.map((group) => {
              const groupKey = group.map(t => t.id).sort().join(':');
              return (
                <DuplicateGroupCard
                  key={groupKey}
                  groupKey={groupKey}
                  group={group}
                  onMerge={handleMergeDuplicate}
                  onDismiss={handleDismissDuplicate}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Task List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox zero!"
          description="No unprocessed tasks. Capture something new or sync with Todoist."
        />
      ) : (
        <>
          {/* Bulk actions */}
          <div className="mb-3 space-y-2 sm:space-y-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={selectAll}
                  className="min-h-[44px] text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0"
                  aria-label={selected.size === normalTasks.length ? 'Deselect all tasks' : `Select all ${normalTasks.length} tasks`}
                >
                  {selected.size === normalTasks.length ? 'Deselect all' : `Select all (${normalTasks.length})`}
                </button>
                {selected.size > 0 && (
                  <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {selected.size} selected
                  </span>
                )}
                <button
                  onClick={() => setSortNewestFirst(prev => !prev)}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground sm:text-xs"
                  aria-label={`Sort by ${sortNewestFirst ? 'oldest first' : 'newest first'}`}
                  title={`Sort by date added (${sortNewestFirst ? 'newest first' : 'oldest first'})`}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {sortNewestFirst ? 'Newest' : 'Oldest'}
                </button>
              </div>
              {selected.size > 0 && (
                <div className="hidden items-center gap-2 sm:flex">
                  <a
                    href={`/clarify?taskIds=${Array.from(selected).join(',')}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Clarify ({selected.size})
                  </a>
                  <button
                    onClick={batchQuickComplete}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm font-medium text-green-400 hover:bg-green-500/20"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Done ({selected.size})
                  </button>
                </div>
              )}
            </div>
            <div className="hidden text-[10px] text-muted-foreground/40 sm:block">
              j/k navigate · space select · a select all
            </div>
            {selected.size > 0 && (
              <a
                href={`/clarify?taskIds=${Array.from(selected).join(',')}`}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:hidden"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Clarify Selected ({selected.size})
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {/* Task items */}
          <ul role="list" aria-label="Inbox tasks" className="space-y-1">
            {sortedTasks.map((task, i) => (
              <li
                key={task.id}
                className={cn(
                  'stagger-item task-card group flex min-h-[48px] items-center gap-3 rounded-lg border border-transparent px-3 py-3',
                  selected.has(task.id) && 'border-primary/30 bg-primary/5',
                  i === focusIdx && 'ring-1 ring-primary/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(task.id)}
                  onChange={() => toggleSelect(task.id)}
                  aria-label={`Select task: ${task.title}`}
                  className="h-5 w-5 min-w-[20px] rounded border-border accent-primary"
                />
                <span className="flex-1 text-sm break-words">{task.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); quickComplete(task.id); }}
                  aria-label={`Quick done: ${task.title}`}
                  title="Two-Minute Rule: done!"
                  className="touch-show flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground/40 opacity-0 transition-opacity hover:bg-green-500/20 hover:text-green-400 group-hover:opacity-100 sm:h-9 sm:w-9"
                >
                  <Check className="h-4 w-4" />
                </button>
                <span className="hidden shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 sm:inline" title={`Added ${new Date(task.createdAt).toLocaleDateString()}`}>
                  {new Date(task.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>

          {/* Process All */}
          <div className="mt-6 flex justify-center">
            <a
              href={selected.size > 0 ? `/clarify?taskIds=${Array.from(selected).join(',')}` : '/clarify'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto sm:py-2.5"
            >
              <Sparkles className="h-4 w-4" />
              {selected.size > 0 ? `Process Selected (${selected.size})` : 'Process All'} → Clarify
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
