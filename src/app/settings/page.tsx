'use client';

import { useState, useEffect } from 'react';
import { Settings, Key, RefreshCw, Database, Cpu, Download, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const [syncState, setSyncState] = useState<{ lastFullSync: string | null; lastInboxSync: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail' | 'testing' | null>>({
    todoist: null,
    gemini: null,
    anthropic: null,
    openai: null,
  });

  useEffect(() => {
    fetch('/api/todoist?action=sync-state')
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setSyncState(data));
  }, []);

  const handleFullSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-all' }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Synced ${data.synced} tasks`);
        // Refresh sync state
        const stateRes = await fetch('/api/todoist?action=sync-state');
        if (stateRes.ok) setSyncState(await stateRes.json());
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (type: 'knowledge' | 'history') => {
    const action = type === 'knowledge' ? 'knowledge' : 'task-history';
    const res = await fetch(`/api/todoist?action=${action}`);
    if (res.ok) {
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `burn-down-${type}-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Configuration and system management" />

      <div className="space-y-8">
        {/* API Keys Status */}
        <Section
          icon={Key}
          title="API Connections"
          description="All keys are stored server-side as environment variables. Displayed status only."
        >
          <div className="space-y-3">
            <ApiKeyRow
              name="Todoist"
              envVar="TODOIST_API_TOKEN"
              status={testResults.todoist}
            />
            <ApiKeyRow
              name="Gemini (Primary LLM)"
              envVar="GEMINI_API_KEY"
              status={testResults.gemini}
            />
            <ApiKeyRow
              name="Anthropic (Heavy LLM)"
              envVar="ANTHROPIC_API_KEY"
              status={testResults.anthropic}
            />
            <ApiKeyRow
              name="OpenAI (Whisper Voice)"
              envVar="OPENAI_API_KEY"
              status={testResults.openai}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            To update keys, modify environment variables in your Vercel dashboard or .env.local file.
          </p>
        </Section>

        {/* Sync */}
        <Section icon={RefreshCw} title="Todoist Sync" description="Pull tasks and projects from Todoist">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {syncState?.lastFullSync
                ? `Last full sync: ${new Date(syncState.lastFullSync).toLocaleString()}`
                : 'Never synced'}
              {syncState?.lastInboxSync && (
                <span className="ml-3">
                  Inbox: {new Date(syncState.lastInboxSync).toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={handleFullSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
              {syncing ? 'Syncing...' : 'Full Sync'}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Sync mode: On-demand (syncs when you load pages). Full sync pulls all tasks and projects.
          </p>
        </Section>

        {/* LLM Config */}
        <Section icon={Cpu} title="LLM Configuration" description="Model routing and confidence thresholds">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
              <div>
                <div className="font-medium">Primary Model</div>
                <div className="text-xs text-muted-foreground">90% of operations — fast clarification, ranking, extraction</div>
              </div>
              <span className="text-muted-foreground">Gemini 2.5 Flash</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
              <div>
                <div className="font-medium">Heavy Model</div>
                <div className="text-xs text-muted-foreground">Project audits, weekly reviews, complex decomposition</div>
              </div>
              <span className="text-muted-foreground">Claude Opus</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
              <div>
                <div className="font-medium">Auto-Approve Threshold</div>
                <div className="text-xs text-muted-foreground">Tasks above this confidence are auto-approved in Clarify</div>
              </div>
              <span className="text-muted-foreground">80%</span>
            </div>
          </div>
        </Section>

        {/* Data Management */}
        <Section icon={Database} title="Data Management" description="Export and manage your data">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleExport('knowledge')}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              Export Knowledge Base
            </button>
            <button
              onClick={() => handleExport('history')}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              Export Task History
            </button>
          </div>
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Reset the knowledge base to start fresh. This cannot be undone.
            </p>
            <button
              onClick={() => {
                if (confirm('Are you sure? This deletes all knowledge entries permanently.')) {
                  // TODO: implement reset
                  alert('Not implemented yet — safety first!');
                }
              }}
              className="mt-2 rounded-lg border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              Reset Knowledge Base
            </button>
          </div>
        </Section>

        {/* Task Formatting */}
        <Section icon={Settings} title="Task Formatting" description="Default labels, priorities, and display preferences">
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-secondary/50 px-4 py-3">
              <div className="font-medium mb-1">Default Labels</div>
              <div className="flex flex-wrap gap-1">
                {['deep-work', 'quick-win', 'waiting', 'errand', 'home', 'work', 'personal'].map(l => (
                  <span key={l} className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">@{l}</span>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-secondary/50 px-4 py-3">
              <div className="font-medium mb-1">Priority Levels</div>
              <div className="text-xs text-muted-foreground">P0 (Fire) → P1 (Must) → P2 (Should) → P3 (This Week) → P4 (Backlog)</div>
            </div>
            <div className="rounded-lg bg-secondary/50 px-4 py-3">
              <div className="font-medium mb-1">Time Estimate Rounding</div>
              <div className="text-xs text-muted-foreground">5-minute increments</div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ApiKeyRow({
  name,
  envVar,
  status,
}: {
  name: string;
  envVar: string;
  status: 'ok' | 'fail' | 'testing' | null;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-4 py-3">
      <div>
        <div className="text-sm font-medium">{name}</div>
        <code className="text-xs text-muted-foreground">{envVar}</code>
      </div>
      <div className="flex items-center gap-2">
        {status === 'ok' && <span className="text-xs text-green-400">● Connected</span>}
        {status === 'fail' && <span className="text-xs text-destructive">● Failed</span>}
        {status === 'testing' && <span className="text-xs text-muted-foreground">Testing...</span>}
        {status === null && <span className="text-xs text-muted-foreground">● Set via env</span>}
      </div>
    </div>
  );
}
