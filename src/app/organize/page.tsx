'use client';

import { useState, useEffect } from 'react';
import { FolderKanban, AlertTriangle, Archive, Plus, MessageSquare, Loader2, Check, X, ChevronDown, ArrowRight } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';

interface Project {
  id: string;
  name: string;
  todoistId: string | null;
  parentTodoistId: string | null;
  category: string | null;
  goal: string | null;
  status: string | null;
  openActionCount: number | null;
  lastActivityAt: string | null;
  notes: string | null;
}

interface AuditRecommendation {
  type: string;
  projectNames: string[];
  observation: string;
  reasoning: string;
  options: { label: string; action: string; details: string }[];
  question?: string;
}

interface FilingSuggestion {
  taskId: string;
  taskTitle: string;
  issues: string[];
  suggestedProject: string | null;
  suggestedLabels: string[];
  suggestedPriority: number | null;
  confidence: number;
  reasoning: string;
}

export default function OrganizePage() {
  const [tab, setTab] = useState<'projects' | 'filing'>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<{ recommendations: AuditRecommendation[]; overallHealth: string } | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [chatting, setChatting] = useState(false);
  const [dismissedRecs, setDismissedRecs] = useState<Set<number>>(new Set());
  const [actioningRec, setActioningRec] = useState<number | null>(null);

  // Filing state
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingSuggestions, setFilingSuggestions] = useState<FilingSuggestion[]>([]);
  const [filingLoaded, setFilingLoaded] = useState(false);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, { projectId?: string }>>({});
  const [expandedFiling, setExpandedFiling] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/todoist?action=projects');
        if (res.ok) setProjects(await res.json());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const runAudit = async () => {
    setAuditing(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'project-audit' }),
      });
      if (res.ok) {
        setAudit(await res.json());
        setDismissedRecs(new Set());
      }
    } finally {
      setAuditing(false);
    }
  };

  const handleAuditAction = async (recIndex: number, rec: AuditRecommendation, action: string, details: string) => {
    setActioningRec(recIndex);
    try {
      const projectName = rec.projectNames[0];
      const project = projects.find(p => p.name.toLowerCase() === projectName?.toLowerCase());

      if (action === 'archive' && project) {
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'archive-project', projectId: project.id }),
        });
        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: 'archived' } : p));
      } else if (action === 'pause' && project) {
        await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update-project', projectId: project.id, data: { status: 'paused' } }),
        });
        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: 'paused' } : p));
      } else if (action === 'keep') {
        // Just dismiss the recommendation
      } else {
        // For complex actions (split, merge, create, move, rename), ask the chat for guidance
        setChatMessage(`${action}: ${details} (for ${rec.projectNames.join(', ')})`);
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'organize-chat',
            message: `I want to "${action}" for project(s): ${rec.projectNames.join(', ')}. Details: ${details}. What specific steps should I take?`,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setChatResponse(data.response);
          setChatMessage('');
        }
      }
      setDismissedRecs(prev => new Set([...prev, recIndex]));
    } finally {
      setActioningRec(null);
    }
  };

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    setChatting(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'organize-chat', message: chatMessage }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatResponse(data.response);
      }
    } finally {
      setChatting(false);
      setChatMessage('');
    }
  };

  const loadFilingSuggestions = async () => {
    setFilingLoading(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'filing-suggestions' }),
      });
      if (res.ok) {
        const data = await res.json();
        setFilingSuggestions(data.suggestions || []);
      }
    } finally {
      setFilingLoading(false);
      setFilingLoaded(true);
    }
  };

  const acceptSuggestion = async (s: FilingSuggestion) => {
    const projectId = overrides[s.taskId]?.projectId
      ?? projects.find(p => p.name === s.suggestedProject)?.id
      ?? null;

    const updateData: Record<string, any> = {};
    if (projectId) updateData.projectId = projectId;
    if (s.suggestedLabels?.length) updateData.labels = JSON.stringify(s.suggestedLabels);
    if (s.suggestedPriority != null) updateData.priority = s.suggestedPriority;

    if (Object.keys(updateData).length > 0) {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-task', taskId: s.taskId, data: updateData }),
      });
    }
    setAcceptedIds(prev => new Set(prev).add(s.taskId));
  };

  const acceptAllSuggestions = async () => {
    setAcceptingAll(true);
    const pending = filingSuggestions.filter(s => !acceptedIds.has(s.taskId) && !dismissedIds.has(s.taskId));
    for (const s of pending) {
      await acceptSuggestion(s);
    }
    setAcceptingAll(false);
  };

  const dismissSuggestion = (taskId: string) => {
    setDismissedIds(prev => new Set(prev).add(taskId));
  };

  // Auto-load filing when switching to that tab
  useEffect(() => {
    if (tab === 'filing' && !filingLoaded && !filingLoading) {
      loadFilingSuggestions();
    }
  }, [tab, filingLoaded, filingLoading]);

  const getHealthColor = (project: Project) => {
    if (!project.lastActivityAt) return 'text-red-400';
    const days = Math.floor((Date.now() - new Date(project.lastActivityAt).getTime()) / 86400000);
    if (days <= 7) return 'text-green-400';
    if (days <= 14) return 'text-amber-400';
    return 'text-red-400';
  };

  const getHealthLabel = (project: Project): string => {
    if (!project.lastActivityAt) return 'Stale';
    const days = Math.floor((Date.now() - new Date(project.lastActivityAt).getTime()) / 86400000);
    if (days <= 7) return 'Active';
    if (days <= 14) return 'Aging';
    return 'Stale';
  };

  const getHealthDot = (project: Project) => {
    const color = getHealthColor(project);
    const label = getHealthLabel(project);
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('inline-block h-2 w-2 rounded-full', color.replace('text-', 'bg-'))} aria-hidden="true" />
        <span className={cn('text-[10px] font-medium', color)}>{label}</span>
      </span>
    );
  };

  const active = projects.filter(p => p.status === 'active');
  const paused = projects.filter(p => p.status === 'paused');
  const archived = projects.filter(p => p.status === 'archived');

  return (
    <div>
      <PageHeader title="Organize" description="Manage project health and task organization" />

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg bg-secondary p-1">
        <button
          onClick={() => setTab('projects')}
          className={cn(
            'flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors sm:py-2',
            tab === 'projects' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Projects
        </button>
        <button
          onClick={() => setTab('filing')}
          className={cn(
            'flex-1 rounded-md px-4 py-2.5 text-sm font-medium transition-colors sm:py-2',
            tab === 'filing' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Filing
        </button>
      </div>

      {tab === 'projects' ? (
        <div className="space-y-6">
          {/* Project Health */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-4 text-xs font-medium text-muted-foreground">
              <span>Active ({active.length})</span>
              <span>Paused ({paused.length})</span>
              <span>Archived ({archived.length})</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded bg-secondary" />)}
              </div>
            ) : (
              <div className="space-y-1">
                {active.map(p => (
                  <div key={p.id} className="task-card flex flex-wrap items-center gap-2 rounded-lg px-3 py-3 sm:flex-nowrap sm:gap-3 sm:py-2.5">
                    {getHealthDot(p)}
                    <span className="flex-1 text-sm font-medium">{p.name}</span>
                    <div className="flex w-full items-center gap-2 pl-6 sm:w-auto sm:pl-0">
                      {p.category && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {p.category}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {p.openActionCount || 0} {(p.openActionCount || 0) === 1 ? 'task' : 'tasks'}
                      </span>
                      {p.lastActivityAt && (
                        <span className="text-xs text-muted-foreground">
                          {Math.floor((Date.now() - new Date(p.lastActivityAt).getTime()) / 86400000)}d ago
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* GTD Integrity Warning: Projects with no next action */}
          {!loading && (() => {
            // Build set of todoist IDs that are parents of other projects
            const parentIds = new Set(active.map(p => p.parentTodoistId).filter(Boolean));
            // Leaf projects: not a parent of any other project
            const leafWithNoActions = active.filter(p =>
              (p.openActionCount || 0) === 0 && !parentIds.has(p.todoistId)
            );
            return leafWithNoActions.length > 0 ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                  GTD: Projects Without Next Actions
                </h3>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                In GTD, every active project must have at least one next action. Consider adding actions or moving these to Someday/Maybe.
              </p>
              <div className="space-y-1">
                {leafWithNoActions.map(p => (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                    <span className="flex-1 font-medium">{p.name}</span>
                    <span className="text-xs text-amber-400">0 actions</span>
                  </div>
                ))}
              </div>
            </div>
            ) : null;
          })()}

          {/* Audit Section */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">LLM Project Audit</h3>
              <button
                onClick={runAudit}
                disabled={auditing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30 disabled:opacity-50"
              >
                {auditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                {auditing ? 'Auditing...' : 'Run Full Audit'}
              </button>
            </div>

            {audit && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{audit.overallHealth}</p>
                {audit.recommendations.map((rec, i) => dismissedRecs.has(i) ? null : (
                  <div key={i} className="rounded-lg border border-border p-3">
                    {rec.projectNames?.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {rec.projectNames.map((name, k) => (
                          <span key={k} className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {name}
                          </span>
                        ))}
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {rec.type}
                        </span>
                      </div>
                    )}
                    <p className="mb-1 text-sm">{rec.observation}</p>
                    <p className="mb-2 text-xs text-muted-foreground">{rec.reasoning}</p>
                    <div className="flex flex-wrap gap-2">
                      {rec.options.map((opt, j) => (
                        <button
                          key={j}
                          disabled={actioningRec === i}
                          onClick={() => handleAuditAction(i, rec, opt.action, opt.details)}
                          title={opt.details}
                          className="rounded bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        >
                          {actioningRec === i ? <Loader2 className="inline h-3 w-3 animate-spin" /> : opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Chat */}
            <div className="mt-4 border-t border-border pt-3">
              <div className="flex gap-2">
                <input
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="Ask about a project..."
                  aria-label="Chat about project organization"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={sendChat}
                  disabled={chatting || !chatMessage.trim()}
                  aria-label="Send chat message"
                  className="rounded-lg bg-primary/20 px-3 py-2 text-sm text-primary hover:bg-primary/30 disabled:opacity-50"
                >
                  {chatting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                </button>
              </div>
              {chatResponse && (
                <div className="mt-3 rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
                  {chatResponse}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Filing Queue Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Needs Filing</h3>
              <p className="text-xs text-muted-foreground">
                Tasks missing a project, labels, or with organization issues
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadFilingSuggestions}
                disabled={filingLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50 sm:py-1.5"
              >
                {filingLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderKanban className="h-3 w-3" />}
                {filingLoading ? 'Scanning...' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Loading State */}
          {filingLoading && !filingLoaded && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing tasks for filing issues...</p>
            </div>
          )}

          {/* Empty State */}
          {filingLoaded && filingSuggestions.length === 0 && (
            <EmptyState
              icon={Check}
              title="All tasks filed"
              description="Every task has a home. Nice work!"
            />
          )}

          {/* Suggestions List */}
          {filingLoaded && filingSuggestions.length > 0 && (
            <>
              {/* Batch Actions */}
              {filingSuggestions.some(s => !acceptedIds.has(s.taskId) && !dismissedIds.has(s.taskId)) && (
                <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <span className="text-sm text-muted-foreground">
                    {filingSuggestions.filter(s => !acceptedIds.has(s.taskId) && !dismissedIds.has(s.taskId)).length} suggestions remaining
                  </span>
                  <button
                    onClick={acceptAllSuggestions}
                    disabled={acceptingAll}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {acceptingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {acceptingAll ? 'Accepting...' : 'Accept All Suggestions'}
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {filingSuggestions.map(s => {
                  const isAccepted = acceptedIds.has(s.taskId);
                  const isDismissed = dismissedIds.has(s.taskId);
                  if (isDismissed) return null;

                  return (
                    <div
                      key={s.taskId}
                      className={cn(
                        'rounded-xl border bg-card transition-all',
                        isAccepted ? 'border-green-500/30 opacity-60' : 'border-border',
                      )}
                    >
                      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:p-4">
                        {/* Status indicator */}
                        <div className="hidden sm:block sm:mt-1">
                          {isAccepted ? (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
                              <Check className="h-3 w-3 text-green-400" />
                            </div>
                          ) : (
                            <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="mb-1 text-sm font-medium">
                            {isAccepted && <span className="mr-1 text-green-400">✓</span>}
                            {s.taskTitle}
                          </div>

                          {/* Issue badges */}
                          <div className="mb-2 flex flex-wrap gap-1">
                            {s.issues.map(issue => (
                              <span
                                key={issue}
                                className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
                              >
                                {issue.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>

                          {/* Suggested changes */}
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {s.suggestedProject && (
                              <div className="flex items-center gap-2">
                                <span>Suggested:</span>
                                {overrides[s.taskId]?.projectId ? (
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                                    📁 {projects.find(p => p.id === overrides[s.taskId]?.projectId)?.name || 'Unknown'}
                                  </span>
                                ) : (
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                                    📁 {s.suggestedProject}
                                  </span>
                                )}
                              </div>
                            )}
                            {s.suggestedLabels?.length > 0 && (
                              <div className="flex items-center gap-1">
                                <span>Labels:</span>
                                {s.suggestedLabels.map(l => (
                                  <span key={l} className="rounded bg-secondary px-1.5 py-0.5 font-medium">@{l}</span>
                                ))}
                              </div>
                            )}
                            {s.suggestedPriority != null && (
                              <div>Priority: P{s.suggestedPriority}</div>
                            )}
                          </div>

                          {/* Reasoning (expandable) */}
                          {expandedFiling === s.taskId && (
                            <div className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                              {s.reasoning}
                            </div>
                          )}

                          {/* Confidence */}
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  s.confidence >= 0.8 ? 'bg-green-400' : s.confidence >= 0.6 ? 'bg-amber-400' : 'bg-red-400',
                                )}
                                style={{ width: `${s.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{Math.round(s.confidence * 100)}%</span>
                            <button
                              onClick={() => setExpandedFiling(expandedFiling === s.taskId ? null : s.taskId)}
                              className="text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              {expandedFiling === s.taskId ? 'hide reasoning' : 'why?'}
                            </button>
                          </div>
                        </div>

                        {/* Actions */}
                        {!isAccepted && (
                          <div className="flex shrink-0 gap-2 sm:flex-col sm:gap-1.5">
                            <button
                              onClick={() => acceptSuggestion(s)}
                              aria-label={`Accept filing suggestion for ${s.taskTitle}`}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-green-500/20 px-3 py-2.5 text-xs font-medium text-green-400 hover:bg-green-500/30 sm:flex-initial sm:py-1.5"
                            >
                              <Check className="h-3.5 w-3.5 sm:h-3 sm:w-3" /> Accept
                            </button>
                            <button
                              onClick={() => setExpandedFiling(expandedFiling === s.taskId ? null : s.taskId)}
                              aria-label={`Change project for ${s.taskTitle}`}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent sm:flex-initial sm:py-1.5"
                            >
                              <ChevronDown className={cn('h-3 w-3 transition-transform', expandedFiling === s.taskId && 'rotate-180')} /> Change
                            </button>
                            <button
                              onClick={() => dismissSuggestion(s.taskId)}
                              aria-label={`Skip filing suggestion for ${s.taskTitle}`}
                              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-xs text-muted-foreground/50 hover:text-muted-foreground sm:flex-initial sm:py-1.5"
                            >
                              <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" /> Skip
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Override project picker */}
                      {expandedFiling === s.taskId && !isAccepted && (
                        <div className="border-t border-border px-4 py-3">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Choose a different project:</div>
                          <div className="flex flex-wrap gap-1.5">
                            {active.map(p => (
                              <button
                                key={p.id}
                                onClick={() => setOverrides(prev => ({ ...prev, [s.taskId]: { projectId: p.id } }))}
                                className={cn(
                                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                                  overrides[s.taskId]?.projectId === p.id
                                    ? 'bg-primary/20 text-primary'
                                    : 'bg-secondary text-muted-foreground hover:bg-accent',
                                )}
                              >
                                {p.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Summary of accepted */}
              {acceptedIds.size > 0 && (
                <div className="rounded-lg bg-green-500/5 border border-green-500/20 px-4 py-3">
                  <span className="text-xs font-medium text-green-400">
                    ✓ {acceptedIds.size} suggestion{acceptedIds.size !== 1 ? 's' : ''} applied
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
