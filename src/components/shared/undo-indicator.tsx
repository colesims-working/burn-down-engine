'use client';

import { Undo2 } from 'lucide-react';
import { useUndo } from '@/components/providers/trust-provider';
import { cn } from '@/lib/utils';

/**
 * A small persistent floating button that shows the undo stack depth.
 * Visible whenever there are undoable actions. Clicking it undoes the last action.
 * Shows keyboard shortcut hint on hover.
 */
export function UndoIndicator() {
  const { undoStack, popUndo } = useUndo();

  if (undoStack.length === 0) return null;

  const lastAction = undoStack[0];
  const timeAgo = Math.floor((Date.now() - lastAction.timestamp) / 1000);
  const label = timeAgo < 60
    ? `Undo: ${lastAction.taskTitle}`
    : `${undoStack.length} undoable action${undoStack.length !== 1 ? 's' : ''}`;

  return (
    <button
      onClick={() => popUndo()}
      title={`${label} (Ctrl+Z)`}
      className={cn(
        'fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition-all hover:bg-accent',
        'md:bottom-4 md:left-auto md:right-4',
      )}
    >
      <Undo2 className="h-3.5 w-3.5 text-primary" />
      <span className="max-w-[180px] truncate text-muted-foreground">
        Undo{undoStack.length > 1 ? ` (${undoStack.length})` : ''}
      </span>
      <kbd className="hidden rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
        Ctrl+Z
      </kbd>
    </button>
  );
}
