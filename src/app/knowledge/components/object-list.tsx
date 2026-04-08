'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronDown, Pin, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KGObject {
  id: string;
  type: string;
  subtype: string | null;
  name: string;
  properties: string;
  status: string;
  pinned: number;
  confidence: number | null;
  source: string;
  updatedAt: string | null;
  createdAt: string;
}

const TYPE_COLORS: Record<string, string> = {
  person: 'bg-blue-500/20 text-blue-400',
  concept: 'bg-green-500/20 text-green-400',
  project: 'bg-orange-500/20 text-orange-400',
  event: 'bg-purple-500/20 text-purple-400',
  organization: 'bg-gray-500/20 text-gray-400',
};

const TYPES = ['all', 'person', 'project', 'organization', 'concept', 'event'] as const;
const STATUSES = ['active', 'dormant', 'absorbed'] as const;
const SORT_OPTIONS = ['name', 'confidence', 'recency'] as const;

interface ObjectListProps {
  objects: KGObject[];
  loading: boolean;
  onSelectObject: (id: string) => void;
  onStatusFilterChange?: (status: string) => void;
}

export function ObjectList({ objects, loading, onSelectObject, onStatusFilterChange }: ObjectListProps) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [subtypeFilter, setSubtypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<typeof SORT_OPTIONS[number]>('recency');

  const subtypes = useMemo(() => {
    const set = new Set(objects.map(o => o.subtype).filter(Boolean));
    return ['all', ...Array.from(set).sort()] as string[];
  }, [objects]);

  const filtered = useMemo(() => {
    let result = objects;
    if (typeFilter !== 'all') result = result.filter(o => o.type === typeFilter);
    if (statusFilter) result = result.filter(o => o.status === statusFilter);
    if (subtypeFilter !== 'all') result = result.filter(o => o.subtype === subtypeFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(o => o.name.toLowerCase().includes(q));
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'confidence') return (b.confidence ?? 0) - (a.confidence ?? 0);
      return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
    });

    return result;
  }, [objects, typeFilter, statusFilter, subtypeFilter, search, sortBy]);

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-card" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search objects..."
            className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          {TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); onStatusFilterChange?.(e.target.value); }} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {subtypes.length > 2 && (
          <select value={subtypeFilter} onChange={e => setSubtypeFilter(e.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
            {subtypes.map(s => <option key={s} value={s}>{s === 'all' ? 'All Subtypes' : s}</option>)}
          </select>
        )}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          {SORT_OPTIONS.map(s => <option key={s} value={s}>Sort: {s}</option>)}
        </select>
      </div>

      {/* Count */}
      <div className="text-xs text-muted-foreground">
        {filtered.length} object{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* Object List */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No objects match your filters.</div>
      ) : (
        <ul className="space-y-1">
          {filtered.map(obj => {
            let props: Record<string, unknown> = {};
            try { props = JSON.parse(obj.properties || '{}'); } catch {}
            const detail = String(props.value || props.contextNotes || props.goal || props.role || '');
            return (
              <li
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 cursor-pointer hover:bg-accent/50 hover:border-border transition-colors"
              >
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', TYPE_COLORS[obj.type] || TYPE_COLORS.concept)}>
                  {obj.type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{obj.name}</span>
                    {obj.pinned === 1 && <Pin className="h-3 w-3 text-amber-400 shrink-0" />}
                    {obj.subtype && <span className="text-[10px] text-muted-foreground shrink-0">({obj.subtype})</span>}
                  </div>
                  {detail && <div className="text-xs text-muted-foreground truncate">{detail}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] text-muted-foreground">{Math.round((obj.confidence ?? 0.7) * 100)}%</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
