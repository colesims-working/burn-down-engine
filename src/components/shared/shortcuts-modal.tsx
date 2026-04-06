'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const SHORTCUTS = {
  'Global': [
    { keys: ['Ctrl', 'K'], description: 'Open command palette' },
    { keys: ['?'], description: 'Show keyboard shortcuts' },
  ],
  'Inbox': [
    { keys: ['j'], description: 'Move focus down' },
    { keys: ['k'], description: 'Move focus up' },
    { keys: ['Space'], description: 'Toggle selection' },
    { keys: ['a'], description: 'Select / deselect all' },
  ],
  'Clarify': [
    { keys: ['j'], description: 'Next processed task' },
    { keys: ['k'], description: 'Previous processed task' },
    { keys: ['a'], description: 'Approve focused task' },
    { keys: ['e'], description: 'Edit focused task' },
    { keys: ['x'], description: 'Reject focused task' },
    { keys: ['d'], description: 'Mark done (two-minute rule)' },
    { keys: ['Ctrl', 'Enter'], description: 'Process selected' },
  ],
  'Engage': [
    { keys: ['j'], description: 'Move focus down' },
    { keys: ['k'], description: 'Move focus up' },
    { keys: ['c'], description: 'Complete focused task' },
    { keys: ['d'], description: 'Defer focused task' },
    { keys: ['b'], description: 'Block focused task' },
    { keys: ['f'], description: 'Create fire / urgent task' },
  ],
};

export function ShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {Object.entries(SHORTCUTS).map(([section, shortcuts]) => (
            <div key={section}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{section}</h3>
              <div className="space-y-1">
                {shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.description}</span>
                    <div className="flex gap-1">
                      {s.keys.map(k => (
                        <kbd key={k} className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-mono">{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
