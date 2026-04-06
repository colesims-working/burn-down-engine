'use client';

import { useState, useEffect } from 'react';
import { Check, X, Pencil, Inbox, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface ReviewItem {
  id: string;
  objectId: string | null;
  reviewType: string;
  proposedData: string;
  reason: string | null;
  status: string;
  createdAt: string;
}

export function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/todoist?action=knowledge-review');
        if (res.ok) setItems(await res.json());
      } catch {} finally { setLoading(false); }
    }
    load();
  }, []);

  const handleResolve = async (item: ReviewItem, resolution: 'approved' | 'rejected') => {
    setProcessingId(item.id);
    try {
      const proposed = JSON.parse(item.proposedData || '{}');
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'kg-review-resolve',
          id: item.id,
          objectId: item.objectId,
          resolution,
          proposedData: proposed,
        }),
      });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== item.id));
        toast({ title: resolution === 'approved' ? 'Approved' : 'Rejected', duration: 2000 });
      }
    } finally { setProcessingId(null); }
  };

  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading review queue...</div>;

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
        <div className="text-sm text-muted-foreground">Review queue empty</div>
        <div className="text-xs text-muted-foreground/60 mt-1">No pending proposals, conflicts, or merge candidates.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">{items.length} pending review{items.length !== 1 ? 's' : ''}</div>

      {items.map(item => {
        const proposed = JSON.parse(item.proposedData || '{}');
        const isProcessing = processingId === item.id;
        return (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-500/20 text-amber-400 px-2 py-0.5 text-[10px] font-medium">{item.reviewType}</span>
                <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleResolve(item, 'approved')}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-500/20 px-2.5 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/30 disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Approve
                </button>
                <button
                  onClick={() => handleResolve(item, 'rejected')}
                  disabled={isProcessing}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> Reject
                </button>
              </div>
            </div>

            {item.reason && <div className="text-xs text-muted-foreground">{item.reason}</div>}

            <div className="rounded-lg bg-secondary/30 p-3 text-xs">
              <div className="font-medium text-muted-foreground mb-1">Proposed changes:</div>
              {proposed.name && <div>Name: <span className="text-foreground">{proposed.name}</span></div>}
              {proposed.confidence && <div>Confidence: <span className="text-foreground">{Math.round(proposed.confidence * 100)}%</span></div>}
              {proposed.properties && (
                <div className="mt-1">
                  <span className="text-muted-foreground">Properties: </span>
                  <code className="text-[10px] break-all">{typeof proposed.properties === 'string' ? proposed.properties : JSON.stringify(proposed.properties)}</code>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
