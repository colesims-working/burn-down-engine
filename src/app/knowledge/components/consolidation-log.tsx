'use client';

import { useState, useEffect } from 'react';
import { RotateCcw, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface ConsolidationRun {
  id: string;
  scope: string;
  startedAt: string;
  completedAt: string | null;
  dormancyTransitions: number | null;
  reactivations: number | null;
  mergesPerformed: number | null;
  synthesesCreated: number | null;
  objectsAbsorbed: number | null;
  referencesPurged: number | null;
  status: string;
  errorLog: string | null;
}

export function ConsolidationLog() {
  const [runs, setRuns] = useState<ConsolidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/todoist?action=knowledge-consolidation-log');
        if (res.ok) setRuns(await res.json());
      } catch {} finally { setLoading(false); }
    }
    load();
  }, []);

  const handleRevert = async (runId: string) => {
    if (!confirm('Revert this consolidation run? Absorbed objects will be restored.')) return;
    setReverting(runId);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert-consolidation', runId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.reverted) {
          setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'reverted' } : r));
          toast({ title: 'Consolidation reverted', duration: 3000 });
        } else {
          toast({ title: 'Revert failed', description: data.error, duration: 5000 });
        }
      }
    } finally { setReverting(null); }
  };

  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading consolidation log...</div>;

  if (runs.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No consolidation runs yet.</div>;
  }

  return (
    <div className="space-y-3">
      {runs.map(run => {
        const errors = run.errorLog ? JSON.parse(run.errorLog) : [];
        return (
          <div key={run.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {run.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                {run.status === 'failed' && <XCircle className="h-4 w-4 text-destructive" />}
                {run.status === 'reverted' && <RotateCcw className="h-4 w-4 text-amber-400" />}
                {run.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <span className="text-sm font-medium">{run.scope} run</span>
                <span className="text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</span>
              </div>
              {(run.status === 'completed' || run.status === 'failed') && (
                <button
                  onClick={() => handleRevert(run.id)}
                  disabled={reverting === run.id}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {reverting === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Revert
                </button>
              )}
              {run.status === 'reverted' && (
                <span className="text-xs text-amber-400">Reverted</span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
              <div><span className="text-muted-foreground">Dormant</span><div className="font-medium">{run.dormancyTransitions ?? 0}</div></div>
              <div><span className="text-muted-foreground">Merges</span><div className="font-medium">{run.mergesPerformed ?? 0}</div></div>
              <div><span className="text-muted-foreground">Syntheses</span><div className="font-medium">{run.synthesesCreated ?? 0}</div></div>
              <div><span className="text-muted-foreground">Absorbed</span><div className="font-medium">{run.objectsAbsorbed ?? 0}</div></div>
              <div><span className="text-muted-foreground">Refs purged</span><div className="font-medium">{run.referencesPurged ?? 0}</div></div>
              <div><span className="text-muted-foreground">Duration</span><div className="font-medium">{run.completedAt ? `${Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s` : '—'}</div></div>
            </div>

            {errors.length > 0 && (
              <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                {errors[0]}{errors.length > 1 && ` (+${errors.length - 1} more)`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
