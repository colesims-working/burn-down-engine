'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Brain, Inbox, FolderKanban, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  title: string;
  type: 'task' | 'project' | 'knowledge';
  subtitle?: string;
  href: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Ctrl+K / Cmd+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Cache projects and knowledge when palette opens (fetched once, filtered client-side)
  const projectsCacheRef = useRef<any[]>([]);
  const knowledgeCacheRef = useRef<any[]>([]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setQuery('');
      setResults([]);
      // Fetch projects and knowledge once on open
      fetch('/api/todoist?action=projects&status=active').then(r => r.ok ? r.json() : []).then(d => { projectsCacheRef.current = Array.isArray(d) ? d : []; }).catch(() => {});
      fetch('/api/todoist?action=knowledge&status=active').then(r => r.ok ? r.json() : []).then(d => { knowledgeCacheRef.current = d; }).catch(() => {});
    }
  }, [open]);

  // Search debounced — only task search hits the server per keystroke
  const searchControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(() => searchAll(query), 200);
    return () => clearTimeout(timer);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchAll = async (q: string) => {
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;

    setLoading(true);
    const searchResults: SearchResult[] = [];
    const signal = controller.signal;
    const ql = q.toLowerCase();

    try {
      // Only task search hits the server — projects/knowledge are cached
      const tasksRes = await fetch(`/api/todoist?action=search-tasks&q=${encodeURIComponent(q)}`, { signal }).then(r => r.ok ? r.json() : []);
      if (signal.aborted) return;

      // Tasks
      for (const t of tasksRes) {
        if (t.title) {
          searchResults.push({ id: t.id, title: t.title, type: 'task', subtitle: t.status || 'active', href: t.status === 'inbox' ? '/inbox' : '/engage' });
        }
      }

      // Projects (client-side filter from cache)
      for (const p of projectsCacheRef.current) {
        if (p.name?.toLowerCase().includes(ql)) {
          searchResults.push({ id: p.id, title: p.name, type: 'project', subtitle: `${p.openActionCount || 0} tasks`, href: '/organize' });
        }
      }

      // Knowledge objects (client-side filter from cache)
      for (const o of knowledgeCacheRef.current) {
        if (o.name?.toLowerCase().includes(ql)) {
          let props: Record<string, unknown> = {};
          try { props = JSON.parse(o.properties || '{}'); } catch {}
          searchResults.push({ id: o.id, title: o.name, type: 'knowledge', subtitle: String(props.value || o.type), href: '/knowledge' });
        }
      }
    } catch {
      if (signal.aborted) return;
    } finally { if (!signal.aborted) setLoading(false); }

    if (!signal.aborted) {
      setResults(searchResults.slice(0, 15));
      setSelectedIdx(0);
    }
  };

  const navigate = (result: SearchResult) => {
    setOpen(false);
    router.push(result.href);
  };

  // Keyboard nav within results
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[selectedIdx]) { navigate(results[selectedIdx]); }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'task': return <Inbox className="h-3.5 w-3.5 text-primary" />;
      case 'project': return <FolderKanban className="h-3.5 w-3.5 text-orange-400" />;
      case 'knowledge': return <Brain className="h-3.5 w-3.5 text-green-400" />;
      default: return <Search className="h-3.5 w-3.5" />;
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, knowledge..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd>
        </div>

        {results.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {results.map((r, i) => (
              <button
                key={r.id}
                onClick={() => navigate(r)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-left transition-colors',
                  i === selectedIdx ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
              >
                {typeIcon(r.type)}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{r.title}</div>
                  {r.subtitle && <div className="truncate text-[10px] text-muted-foreground">{r.subtitle}</div>}
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px]">{r.type}</span>
              </button>
            ))}
          </div>
        )}

        {query && results.length === 0 && !loading && (
          <div className="p-4 text-center text-sm text-muted-foreground">No results</div>
        )}
      </div>
    </div>
  );
}
