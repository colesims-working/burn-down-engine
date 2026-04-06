'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Learning indicator: shows a small toast when the knowledge system
 * extracts new facts from LLM interactions. Listens for 'llm-complete'
 * events (fired by pages after LLM calls) and checks recent extractions.
 */
export function LearningIndicator() {
  const [visible, setVisible] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState(0);

  const checkRecentExtractions = useCallback(async () => {
    // Debounce: don't check more than once per 10 seconds
    if (Date.now() - lastCheckTime < 10000) return;
    setLastCheckTime(Date.now());

    try {
      const res = await fetch('/api/todoist?action=extraction-recent');
      if (!res.ok) return;
      const data = await res.json();
      if (data.count > 0) {
        setCount(data.count);
        setItems(data.items);
        setVisible(true);
        // Auto-hide after 8 seconds
        setTimeout(() => setVisible(false), 8000);
      }
    } catch {}
  }, [lastCheckTime]);

  useEffect(() => {
    // Check after LLM calls complete (pages fire this event)
    const handler = () => {
      // Small delay to let async extraction finish
      setTimeout(() => checkRecentExtractions(), 3000);
    };
    window.addEventListener('llm-complete', handler);
    return () => window.removeEventListener('llm-complete', handler);
  }, [checkRecentExtractions]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        'fixed bottom-20 right-4 z-50 rounded-lg border border-purple-500/30 bg-purple-500/10 backdrop-blur-sm',
        'px-3 py-2 shadow-lg transition-all duration-300',
        'md:bottom-4',
        expanded ? 'max-w-xs' : 'max-w-fit',
      )}
    >
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 text-xs text-purple-300"
      >
        <Brain className="h-3.5 w-3.5" />
        <span>Learned {count} new {count === 1 ? 'fact' : 'facts'}</span>
      </button>

      {expanded && items.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-purple-500/20 pt-2">
          {items.map(item => (
            <div key={item.id} className="text-[11px] text-purple-300/80">
              {item.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
