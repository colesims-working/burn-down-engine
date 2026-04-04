'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, Plus, Pencil, Trash2, User, Search, BarChart3 } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface KnowledgeEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number | null;
  source: string | null;
  timesReferenced: number | null;
  updatedAt: string | null;
}

interface Person {
  id: string;
  name: string;
  relationship: string | null;
  organization: string | null;
  role: string | null;
  contextNotes: string | null;
}

interface Stats {
  totalEntries: number;
  totalPeople: number;
  byCategory: Record<string, number>;
  avgConfidence: number;
  mostReferenced: { key: string; count: number };
}

const CATEGORIES = ['all', 'identity', 'preference', 'pattern', 'priority', 'schedule', 'decision', 'fact', 'workflow', 'other'] as const;

export default function KnowledgePage() {
  const [tab, setTab] = useState<'entries' | 'people'>('entries');
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; type: 'entry' | 'person' } | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const catParam = category !== 'all' ? `&category=${category}` : '';
      const [entriesRes, peopleRes, statsRes] = await Promise.all([
        fetch(`/api/todoist?action=knowledge${catParam}`),
        fetch('/api/todoist?action=people'),
        fetch('/api/todoist?action=knowledge-stats'),
      ]);
      if (entriesRes.ok) setEntries(await entriesRes.json());
      if (peopleRes.ok) setPeople(await peopleRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      setLoadError(null);
    } catch {
      setLoadError('Failed to load knowledge base.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = entries.filter(e =>
    search === '' ||
    e.key.toLowerCase().includes(search.toLowerCase()) ||
    e.value.toLowerCase().includes(search.toLowerCase())
  );

  const deleteEntry = async (id: string) => {
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-knowledge', id }),
      });
      if (!res.ok) toast({ title: 'Delete failed', description: 'Could not delete the entry.', duration: 4000 });
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 4000 });
    }
    setDeleteConfirm(null);
    await fetchData();
  };

  const deletePerson = async (id: string) => {
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-person', id }),
      });
      if (!res.ok) toast({ title: 'Delete failed', description: 'Could not delete the person.', duration: 4000 });
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the server.', duration: 4000 });
    }
    setDeleteConfirm(null);
    await fetchData();
  };

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        description="Everything the system knows — transparent and editable"
        action={
          <button
            onClick={() => tab === 'entries' ? setShowAddEntry(true) : setShowAddPerson(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add {tab === 'entries' ? 'Entry' : 'Person'}
          </button>
        }
      />

      {/* Stats Bar */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Entries" value={stats.totalEntries} />
          <StatCard label="People" value={stats.totalPeople} />
          <StatCard label="Avg Confidence" value={`${Math.round(stats.avgConfidence * 100)}%`} />
          <StatCard label="Most Used" value={stats.mostReferenced.key || 'N/A'} sub={stats.mostReferenced.count > 0 ? `${stats.mostReferenced.count}x` : ''} />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-4 border-b border-border">
        <button
          onClick={() => setTab('entries')}
          className={cn(
            'pb-2 text-sm font-medium transition-colors',
            tab === 'entries' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Brain className="mr-1.5 inline h-4 w-4" />
          Knowledge ({entries.length})
        </button>
        <button
          onClick={() => setTab('people')}
          className={cn(
            'pb-2 text-sm font-medium transition-colors',
            tab === 'people' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <User className="mr-1.5 inline h-4 w-4" />
          People ({people.length})
        </button>
      </div>

      {tab === 'entries' && (
        <>
          {/* Filters */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search knowledge..."
                className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none sm:py-2"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none sm:py-2"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
              ))}
            </select>
          </div>

          {/* Entry list */}
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />)}</div>
          ) : entries.length === 0 ? (
            <EmptyState icon={Brain} title="No entries yet" description="Knowledge accumulates as you use the system, or add entries manually." />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No results for &ldquo;{search}&rdquo;</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Try a different search term or clear the filter</p>
              <button
                onClick={() => setSearch('')}
                className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <>
              {search && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Showing {filtered.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </p>
              )}
              <div className="space-y-2">
              {filtered.map(entry => (
                <div key={entry.id} className="stagger-item rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">{entry.category}</span>
                        <span className="text-sm font-medium truncate" title={entry.key}>{entry.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.value}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground/60">
                      {entry.confidence !== null && (() => {
                        const pct = Math.round(entry.confidence * 100);
                        const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
                        return (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block h-1.5 w-12 rounded-full bg-secondary overflow-hidden">
                              <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                            </span>
                            {pct}%
                          </span>
                        );
                      })()}
                        {entry.source && <span>Source: {entry.source}</span>}
                        {(entry.timesReferenced || 0) > 0 && <span>Referenced: {entry.timesReferenced}x</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setEditingEntry(entry)} aria-label={`Edit ${entry.key} entry`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:h-auto sm:w-auto sm:rounded sm:p-1.5">
                        <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: entry.id, name: entry.key, type: 'entry' })} aria-label={`Delete ${entry.key} entry`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-auto sm:w-auto sm:rounded sm:p-1.5">
                        <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </>
      )}

      {tab === 'people' && (
        <>
          {people.length === 0 ? (
            <EmptyState icon={User} title="No people tracked" description="Add people manually, or they'll appear automatically when mentioned during task clarification." />
          ) : (
            <div className="space-y-2">
              {people.map(person => (
                <div key={person.id} className="stagger-item rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold">{person.name}</span>
                        {person.relationship && <span className="text-xs text-muted-foreground">({person.relationship})</span>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[person.role, person.organization].filter(Boolean).join(' at ')}
                      </div>
                      {person.contextNotes && <p className="mt-1 text-xs text-muted-foreground/70">{person.contextNotes}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => setEditingPerson(person)} aria-label={`Edit ${person.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:h-auto sm:w-auto sm:rounded sm:p-1.5">
                        <Pencil className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: person.id, name: person.name, type: 'person' })} aria-label={`Delete ${person.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-auto sm:w-auto sm:rounded sm:p-1.5">
                        <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Entry Modal */}
      {showAddEntry && (
        <FormModal
          title="Add Knowledge Entry"
          onClose={() => setShowAddEntry(false)}
          onSubmit={async (data) => {
            const res = await fetch('/api/todoist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create-knowledge', ...data }),
            });
            if (!res.ok) throw new Error('Failed to save');
            setShowAddEntry(false);
            await fetchData();
          }}
          fields={[
            { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.filter(c => c !== 'all').map(c => ({ value: c, label: c })) },
            { name: 'key', label: 'Key', type: 'text', placeholder: 'e.g. preferred_task_format' },
            { name: 'value', label: 'Value', type: 'textarea', placeholder: 'The knowledge content...' },
          ]}
        />
      )}

      {/* Add Person Modal */}
      {showAddPerson && (
        <FormModal
          title="Add Person"
          onClose={() => setShowAddPerson(false)}
          onSubmit={async (data) => {
            const res = await fetch('/api/todoist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create-person', ...data }),
            });
            if (!res.ok) throw new Error('Failed to save');
            setShowAddPerson(false);
            await fetchData();
          }}
          fields={[
            { name: 'name', label: 'Name', type: 'text', placeholder: 'Full name' },
            { name: 'relationship', label: 'Relationship', type: 'text', placeholder: 'e.g. manager, collaborator, wife' },
            { name: 'organization', label: 'Organization', type: 'text', placeholder: 'e.g. Microsoft' },
            { name: 'role', label: 'Role', type: 'text', placeholder: 'Their role/title' },
            { name: 'contextNotes', label: 'Notes', type: 'textarea', placeholder: 'How you interact, preferences, etc.' },
          ]}
        />
      )}

      {/* Edit Entry Modal */}
      {editingEntry && (
        <FormModal
          title="Edit Entry"
          initialData={{ category: editingEntry.category, key: editingEntry.key, value: editingEntry.value }}
          onClose={() => setEditingEntry(null)}
          onSubmit={async (data) => {
            const res = await fetch('/api/todoist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update-knowledge', id: editingEntry.id, data }),
            });
            if (!res.ok) throw new Error('Failed to save');
            setEditingEntry(null);
            await fetchData();
          }}
          fields={[
            { name: 'category', label: 'Category', type: 'select', options: CATEGORIES.filter(c => c !== 'all').map(c => ({ value: c, label: c })) },
            { name: 'key', label: 'Key', type: 'text' },
            { name: 'value', label: 'Value', type: 'textarea' },
          ]}
        />
      )}

      {/* Edit Person Modal */}
      {editingPerson && (
        <FormModal
          title="Edit Person"
          initialData={{ name: editingPerson.name, relationship: editingPerson.relationship || '', organization: editingPerson.organization || '', role: editingPerson.role || '', contextNotes: editingPerson.contextNotes || '' }}
          onClose={() => setEditingPerson(null)}
          onSubmit={async (data) => {
            const res = await fetch('/api/todoist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update-person', id: editingPerson.id, data }),
            });
            if (!res.ok) throw new Error('Failed to save');
            setEditingPerson(null);
            await fetchData();
          }}
          fields={[
            { name: 'name', label: 'Name', type: 'text' },
            { name: 'relationship', label: 'Relationship', type: 'text' },
            { name: 'organization', label: 'Organization', type: 'text' },
            { name: 'role', label: 'Role', type: 'text' },
            { name: 'contextNotes', label: 'Notes', type: 'textarea' },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title={`Delete ${deleteConfirm?.type === 'person' ? 'person' : 'entry'}?`}
        description={`"${deleteConfirm?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => deleteConfirm?.type === 'person' ? deletePerson(deleteConfirm.id) : deleteEntry(deleteConfirm!.id)}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold truncate" title={String(value)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface Field {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

function FormModal({
  title,
  fields,
  initialData,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  initialData?: Record<string, string>;
  onClose: () => void;
  onSubmit: (data: Record<string, string>) => Promise<void>;
}) {
  const [data, setData] = useState<Record<string, string>>(
    initialData || Object.fromEntries(fields.map(f => [f.name, f.type === 'select' && f.options ? f.options[0].value : '']))
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(data);
    } catch {
      setSubmitError('Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {fields.map(field => (
            <div key={field.name}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{field.label}</label>
              {field.type === 'select' ? (
                <select
                  value={data[field.name] || ''}
                  onChange={(e) => setData(prev => ({ ...prev, [field.name]: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={data[field.name] || ''}
                  onChange={(e) => setData(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              ) : (
                <input
                  value={data[field.name] || ''}
                  onChange={(e) => setData(prev => ({ ...prev, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
        {submitError && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{submitError}</div>
        )}
        <DialogFooter>
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
