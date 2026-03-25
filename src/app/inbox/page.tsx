'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Plus, Mic, MicOff, RefreshCw, ArrowRight, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';

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

  // Auto-sync if stale (>5 min since last inbox sync)
  useEffect(() => {
    let cancelled = false;
    async function syncIfStale() {
      try {
        const res = await fetch('/api/todoist?action=sync-state');
        if (!res.ok) return;
        const state = await res.json();
        const lastSync = state?.lastInboxSync || state?.lastFullSync;
        if (!lastSync || (Date.now() - new Date(lastSync).getTime()) > 5 * 60 * 1000) {
          if (cancelled) return;
          setSyncing(true);
          await fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync-inbox' }),
          });
        }
      } catch (e) {
        console.error('syncIfStale failed:', e);
      } finally {
        if (!cancelled) {
          setSyncing(false);
          fetchTasks();
        }
      }
    }
    syncIfStale();
    return () => { cancelled = true; };
  }, [fetchTasks]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-inbox' }),
      });
      if (res.ok) await fetchTasks();
    } finally {
      setSyncing(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddText.trim()) return;

    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quick-add', content: quickAddText }),
      });
      if (res.ok) {
        setQuickAddText('');
        await fetchTasks();
      }
    } catch (error) {
      console.error('Quick add failed:', error);
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
    for (const task of voiceTasks) {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quick-add', content: task.text }),
      });
    }
    setVoiceTasks([]);
    await fetchTasks();
  };

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
            className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!quickAddText.trim()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </form>

        <button
          onClick={recording ? stopRecording : startRecording}
          className={cn(
            'rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
            recording
              ? 'bg-destructive text-destructive-foreground recording-indicator'
              : 'border border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>

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
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={selectAll}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {selected.size === tasks.length ? 'Deselect all' : `Select all (${tasks.length})`}
            </button>
            {selected.size > 0 && (
              <a
                href={`/clarify?taskIds=${Array.from(selected).join(',')}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Clarify Selected ({selected.size})
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {/* Task items */}
          <div className="space-y-1">
            {tasks.map((task, i) => (
              <div
                key={task.id}
                className={cn(
                  'stagger-item task-card group flex items-center gap-3 rounded-lg border border-transparent px-3 py-3',
                  selected.has(task.id) && 'border-primary/30 bg-primary/5',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(task.id)}
                  onChange={() => toggleSelect(task.id)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="flex-1 text-sm">{task.title}</span>
                <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {new Date(task.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>

          {/* Process All */}
          <div className="mt-6 flex justify-center">
            <a
              href={selected.size > 0 ? `/clarify?taskIds=${Array.from(selected).join(',')}` : '/clarify'}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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
