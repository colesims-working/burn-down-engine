'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Plus, Mic, MicOff, RefreshCw, ArrowRight, Sparkles, Trash2, AlertTriangle, Keyboard, Check, ArrowUpDown } from 'lucide-react';
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
}

export default function InboxPage() {
  const [tasks, setTasks] = useState<InboxTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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
        const data = await res.json();
        setTasks(data);
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
    async function loadAndSync() {
      // Fetch local tasks and sync state in parallel
      const [tasksRes, stateRes] = await Promise.all([
        fetch('/api/todoist?action=inbox').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/todoist?action=sync-state').then(r => r.ok ? r.json() : null).catch(() => null),
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
      }
    }
    loadAndSync();
    return () => { cancelled = true; };
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
        // Clear removed IDs on manual sync — user is explicitly refreshing
        removedIdsRef.current.clear();
        await fetchTasks();
      }
    } finally {
      setSyncing(false);
      window.dispatchEvent(new Event('inbox-changed'));
    }
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
    if (selected.size === tasks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tasks.map(t => t.id)));
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

  // Keyboard navigation
  const [focusIdx, setFocusIdx] = useState(0);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  const sortedTasks = [...tasks].sort((a, b) => {
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
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            Sync
          </button>
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
                  aria-label={selected.size === tasks.length ? 'Deselect all tasks' : `Select all ${tasks.length} tasks`}
                >
                  {selected.size === tasks.length ? 'Deselect all' : `Select all (${tasks.length})`}
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
                <a
                  href={`/clarify?taskIds=${Array.from(selected).join(',')}`}
                  className="hidden items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:inline-flex"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Clarify Selected ({selected.size})
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
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
