'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Pin, PinOff, Pencil, Trash2, RotateCcw, X, Check, Loader2, Link2, History, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const TYPE_COLORS: Record<string, string> = {
  person: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  concept: 'bg-green-500/20 text-green-400 border-green-500/30',
  project: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  event: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  organization: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

interface ObjectDetailProps {
  objectId: string;
  onBack: () => void;
  onRefresh: () => void;
}

export function ObjectDetail({ objectId, onBack, onRefresh }: ObjectDetailProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editProps, setEditProps] = useState('');
  const [editConfidence, setEditConfidence] = useState(0.7);
  const [saving, setSaving] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/todoist?action=knowledge-object&id=${objectId}`);
        if (res.ok) {
          const d = await res.json();
          setData(d);
          setEditName(d.object.name);
          setEditProps(d.object.properties || '{}');
          setEditConfidence(d.object.confidence ?? 0.7);
        }
      } catch {} finally { setLoading(false); }
    }
    load();
  }, [objectId]);

  const handleSave = async () => {
    // Validate JSON before sending
    try { JSON.parse(editProps); } catch {
      toast({ title: 'Invalid JSON in properties', duration: 4000 });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'kg-update-object', id: objectId,
          name: editName, properties: editProps, confidence: editConfidence,
        }),
      });
      if (res.ok) { setEditing(false); onRefresh(); toast({ title: 'Object updated', duration: 2000 }); }
    } finally { setSaving(false); }
  };

  const handlePin = async () => {
    const isPinned = data.object.pinned === 1;
    const res = await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kg-update-object', id: objectId, pinned: !isPinned }),
    });
    if (!res.ok) { toast({ title: 'Pin failed', duration: 3000 }); return; }
    onRefresh();
    setData((d: any) => ({ ...d, object: { ...d.object, pinned: isPinned ? 0 : 1 } }));
  };

  const handleReactivate = async () => {
    const res = await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kg-update-object', id: objectId, status: 'active' }),
    });
    if (!res.ok) { toast({ title: 'Reactivation failed', duration: 3000 }); return; }
    onRefresh();
    toast({ title: 'Object reactivated', duration: 2000 });
    onBack();
  };

  const handleTombstone = async () => {
    if (!confirm('Delete this knowledge object? It will be tombstoned (not permanently removed).')) return;
    const res = await fetch('/api/todoist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'kg-delete-object', id: objectId }),
    });
    if (!res.ok) { toast({ title: 'Delete failed', duration: 3000 }); return; }
    onRefresh();
    toast({ title: 'Object deleted', duration: 2000 });
    onBack();
  };

  if (loading) return <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>;
  if (!data) return <div className="py-8 text-center text-sm text-muted-foreground">Object not found.</div>;

  const { object: obj, links, linkedObjects, evidence, absorbedSources } = data;
  let props: Record<string, unknown> = {};
  try { props = JSON.parse(obj.properties || '{}'); } catch {}
  const linkedMap = new Map<string, any>(linkedObjects.map((o: any) => [o.id, o]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><ArrowLeft className="h-4 w-4" /></button>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium border', TYPE_COLORS[obj.type] || '')}>{obj.type}{obj.subtype ? `/${obj.subtype}` : ''}</span>
        <h2 className="text-lg font-semibold flex-1">{obj.name}</h2>
        <div className="flex gap-1">
          <button onClick={handlePin} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title={obj.pinned ? 'Unpin' : 'Pin'}>
            {obj.pinned ? <PinOff className="h-4 w-4 text-amber-400" /> : <Pin className="h-4 w-4" />}
          </button>
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><Pencil className="h-4 w-4" /></button>
          {obj.status === 'dormant' && <button onClick={handleReactivate} className="p-1.5 rounded-lg hover:bg-accent text-green-400" title="Reactivate"><RotateCcw className="h-4 w-4" /></button>}
          <button onClick={handleTombstone} className="p-1.5 rounded-lg hover:bg-accent text-destructive"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-secondary px-2.5 py-0.5">{obj.status}</span>
        <span className="rounded-full bg-secondary px-2.5 py-0.5">confidence: {Math.round((obj.confidence ?? 0.7) * 100)}%</span>
        <span className="rounded-full bg-secondary px-2.5 py-0.5">source: {obj.source}</span>
        {obj.pinned === 1 && <span className="rounded-full bg-amber-500/20 text-amber-400 px-2.5 py-0.5">pinned</span>}
      </div>

      {/* Edit mode */}
      {editing && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-secondary/30 px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Properties (JSON)</label>
            <textarea value={editProps} onChange={e => setEditProps(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-border bg-secondary/30 px-3 py-1.5 text-sm font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Confidence</label>
            <div className="flex items-center gap-2 mt-1">
              <input type="range" min="0" max="1" step="0.05" value={editConfidence} onChange={e => setEditConfidence(parseFloat(e.target.value))} className="flex-1" />
              <span className="text-sm font-mono w-10 text-right">{Math.round(editConfidence * 100)}%</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">Cancel</button>
          </div>
        </div>
      )}

      {/* Properties */}
      {!editing && Object.keys(props).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">Properties</h3>
          <dl className="space-y-1">
            {Object.entries(props).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-sm">
                <dt className="text-muted-foreground shrink-0 font-medium">{k}:</dt>
                <dd className="break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Linked Objects */}
      {links.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> Linked Objects ({links.length})</h3>
          <div className="space-y-1.5">
            {links.map((link: any) => {
              const isSource = link.sourceId === objectId;
              const otherId = isSource ? link.targetId : link.sourceId;
              const other = linkedMap.get(otherId);
              return (
                <div key={link.id} className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] text-muted-foreground shrink-0">{isSource ? '→' : '←'}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{link.linkType}</span>
                  <span className="font-medium truncate">{other?.name ?? otherId}</span>
                  {other && <span className={cn('text-[10px] rounded-full px-1.5 py-0.5', TYPE_COLORS[other.type])}>{other.type}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Absorbed Sources (synthesis provenance) */}
      {absorbedSources.length > 0 && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
          <h3 className="text-xs font-semibold text-purple-400 mb-2">Absorbed From ({absorbedSources.length} sources)</h3>
          <div className="space-y-1">
            {absorbedSources.map((src: any) => {
              let srcProps: Record<string, unknown> = {};
              try { srcProps = JSON.parse(src.properties || '{}'); } catch {}
              return (
                <div key={src.id} className="text-sm">
                  <span className="font-medium">{src.name}</span>
                  {srcProps.value && <span className="text-xs text-muted-foreground ml-2">— {srcProps.value}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Evidence Trail */}
      <div className="rounded-lg border border-border bg-card p-4">
        <button onClick={() => setShowEvidence(!showEvidence)} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-1"><History className="h-3.5 w-3.5" /> Evidence Trail ({evidence.length})</span>
          {showEvidence ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showEvidence && evidence.length > 0 && (
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            {evidence.map((e: any) => (
              <div key={e.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">{e.evidenceType}</span>
                <span className="mx-1">·</span>
                <span>{e.sourceContext}</span>
                {e.snippet && <span className="ml-1 italic">"{e.snippet}"</span>}
                <span className="ml-1 text-[10px]">{new Date(e.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
