import { cn } from '@/lib/utils';
import { Flame, Target, ClipboardList, Pin, Archive, Clock, Zap, Coffee, Leaf, Calendar } from 'lucide-react';

// ─── Priority Badge ──────────────────────────────────────────

const priorityConfig = {
  0: { label: 'Fire', icon: Flame, className: 'priority-0' },
  1: { label: 'P1', icon: Target, className: 'priority-1' },
  2: { label: 'P2', icon: ClipboardList, className: 'priority-2' },
  3: { label: 'P3', icon: Pin, className: 'priority-3' },
  4: { label: 'P4', icon: Archive, className: 'priority-4' },
};

export function PriorityBadge({ priority, size = 'sm' }: { priority: number; size?: 'sm' | 'md' }) {
  const config = priorityConfig[priority as keyof typeof priorityConfig] || priorityConfig[4];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium',
        config.className,
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
      )}
      aria-label={`Priority ${config.label}`}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />
      {config.label}
    </span>
  );
}

// ─── Energy Indicator ────────────────────────────────────────

const energyConfig = {
  high: { icon: Zap, label: 'High', className: 'energy-high' },
  medium: { icon: Coffee, label: 'Med', className: 'energy-medium' },
  low: { icon: Leaf, label: 'Low', className: 'energy-low' },
};

export function EnergyBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const config = energyConfig[level as keyof typeof energyConfig];
  if (!config) return null;
  const Icon = config.icon;

  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px]', config.className)} aria-label={`Energy: ${config.label}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}

// ─── Time Estimate ───────────────────────────────────────────

export function TimeEstimate({ minutes }: { minutes: number | null }) {
  if (!minutes) return null;

  const display = minutes >= 60 ? `${Math.round(minutes / 60 * 10) / 10}h` : `${minutes}m`;

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" aria-label={`Estimated time: ${display}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      {display}
    </span>
  );
}

// ─── Due Date Badge ─────────────────────────────────────────

export function DueDateBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;

  const today = new Date().toISOString().slice(0, 10);
  const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isOverdue = dueDate < today;
  const isNearDeadline = !isOverdue && dueDate <= threeDaysOut;

  // Format: "Apr 10" or "Overdue: Apr 5"
  const dateObj = new Date(dueDate + 'T00:00:00');
  const formatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        isOverdue ? 'border-red-500/30 bg-red-500/10 text-red-400' :
        isNearDeadline ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
        'border-border text-muted-foreground',
      )}
    >
      <Calendar className="h-3 w-3" />
      {isOverdue ? `Overdue: ${formatted}` : formatted}
    </span>
  );
}

// ─── Labels Display ──────────────────────────────────────────

export function Labels({ labels }: { labels: string | null }) {
  if (!labels) return null;
  const parsed = JSON.parse(labels) as string[];
  if (parsed.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {parsed.map((label) => (
        <span
          key={label}
          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          @{label}
        </span>
      ))}
    </div>
  );
}

// ─── Project Badge ───────────────────────────────────────────

export function ProjectBadge({ name }: { name: string | null | undefined }) {
  if (!name) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary/80 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      📁 {name}
    </span>
  );
}

// ─── Page Header ─────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
