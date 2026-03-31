'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Key, RefreshCw, Database, Cpu, Download, AlertTriangle, Play, CheckCircle, XCircle, Loader2, Zap, ChevronDown, Shield, EyeOff, Eye } from 'lucide-react';
import { PageHeader } from '@/components/shared/ui-parts';
import { cn } from '@/lib/utils';

type Provider = 'gemini' | 'anthropic' | 'openai';

interface ModelAssignment {
  provider: Provider;
  model: string;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: Provider;
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

interface ProviderModels {
  provider: Provider;
  label: string;
  available: boolean;
  models: AvailableModel[];
}

type ModelConfig = Record<string, ModelAssignment>;

const OPERATION_LABELS: Record<string, { label: string; description: string }> = {
  clarify_task: { label: 'Clarify Task', description: 'Parse and enhance inbox tasks' },
  extract_tasks_from_voice: { label: 'Voice Extraction', description: 'Pull tasks from voice transcripts' },
  extract_knowledge: { label: 'Knowledge Extraction', description: 'Build knowledge base entries' },
  file_suggestions: { label: 'Filing Suggestions', description: 'Suggest project/label assignments' },
  rank_tasks: { label: 'Rank Tasks', description: 'Priority ranking and scoring' },
  fire_triage: { label: 'Fire Triage', description: 'Urgent task classification' },
  daily_observations: { label: 'Daily Observations', description: 'Generate daily review insights' },
  project_audit: { label: 'Project Audit', description: 'Deep project health analysis' },
  weekly_review: { label: 'Weekly Review', description: 'Weekly pattern and trend analysis' },
  complex_decomposition: { label: 'Task Decomposition', description: 'Break down complex tasks' },
  priority_recalibration: { label: 'Priority Recalibration', description: 'Re-evaluate priority scores' },
  organize_conversation: { label: 'Organize Conversation', description: 'Conversational organize flow' },
};

const OPERATIONS = Object.keys(OPERATION_LABELS);

export default function SettingsPage() {
  const [syncState, setSyncState] = useState<{ lastFullSync: string | null; lastInboxSync: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail' | 'testing' | null>>({
    todoist: null, gemini: null, anthropic: null, openai: null,
  });

  const [providers, setProviders] = useState<ProviderModels[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({});
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(0.8);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [modelTests, setModelTests] = useState<Record<string, {
    status: 'testing' | 'ok' | 'fail';
    latency?: number;
    error?: string;
    response?: string;
    tokensIn?: number;
    tokensOut?: number;
    estimatedCost?: number;
  }>>({});
  const [disabledModels, setDisabledModels] = useState<string[]>([]);
  const [adminOpen, setAdminOpen] = useState(false);
  const [savingDisabled, setSavingDisabled] = useState(false);

  const loadSettings = useCallback(async () => {
    const [settingsRes, modelsRes, syncRes] = await Promise.all([
      fetch('/api/todoist?action=app-settings'),
      fetch('/api/todoist?action=available-models'),
      fetch('/api/todoist?action=sync-state'),
    ]);

    if (settingsRes.ok) {
      const data = await settingsRes.json();
      if (data.modelConfig && typeof data.modelConfig === 'object') {
        setModelConfig(data.modelConfig);
      }
      setAutoApproveThreshold(data.autoApproveThreshold ?? 0.8);
      if (Array.isArray(data.disabledModels)) {
        setDisabledModels(data.disabledModels);
      }
    }

    if (modelsRes.ok) {
      const data = await modelsRes.json();
      setProviders(data);
    }
    setLoadingModels(false);

    if (syncRes.ok) {
      const data = await syncRes.json();
      setSyncState(data);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const modelsForProvider = (provider: Provider): AvailableModel[] => {
    return (providers.find(p => p.provider === provider)?.models || [])
      .filter(m => !disabledModels.includes(`${m.provider}:${m.id}`));
  };

  const handleProviderChange = (operation: string, provider: Provider) => {
    const models = modelsForProvider(provider);
    setModelConfig(prev => ({
      ...prev,
      [operation]: { provider, model: models[0]?.id || '' },
    }));
  };

  const handleModelChange = (operation: string, model: string) => {
    setModelConfig(prev => ({
      ...prev,
      [operation]: { ...prev[operation], model },
    }));
  };

  const handleTestModel = async (provider: Provider, model: string) => {
    const key = `${provider}:${model}`;
    setModelTests(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-model', provider, model }),
      });
      if (res.ok) {
        const data = await res.json();
        setModelTests(prev => ({
          ...prev,
          [key]: data.success
            ? { status: 'ok', latency: data.latencyMs, response: data.response, tokensIn: data.tokensIn, tokensOut: data.tokensOut, estimatedCost: data.estimatedCost }
            : { status: 'fail', error: data.error, latency: data.latencyMs },
        }));
      } else {
        setModelTests(prev => ({ ...prev, [key]: { status: 'fail', error: 'Request failed' } }));
      }
    } catch {
      setModelTests(prev => ({ ...prev, [key]: { status: 'fail', error: 'Network error' } }));
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-settings',
          data: { modelConfig, autoApproveThreshold, disabledModels },
        }),
      });
      if (res.ok) setSettingsSaved(true);
    } finally {
      setSavingSettings(false);
      setTimeout(() => setSettingsSaved(false), 3000);
    }
  };

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

  // Deduplicate models currently in use for quick testing
  const uniqueModelsInUse = (): { provider: Provider; model: string }[] => {
    const seen = new Set<string>();
    const result: { provider: Provider; model: string }[] = [];
    for (const op of OPERATIONS) {
      const a = modelConfig[op];
      if (a) {
        const key = `${a.provider}:${a.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(a);
        }
      }
    }
    return result;
  };

  const [testAllRunning, setTestAllRunning] = useState(false);
  const [testAllProgress, setTestAllProgress] = useState({ done: 0, total: 0 });

  const handleTestAll = async () => {
    const allModels = providers.flatMap(p => p.models);
    if (allModels.length === 0) return;

    setTestAllRunning(true);
    setTestAllProgress({ done: 0, total: allModels.length });

    // Mark all as testing
    const initial: typeof modelTests = {};
    for (const m of allModels) initial[`${m.provider}:${m.id}`] = { status: 'testing' };
    setModelTests(prev => ({ ...prev, ...initial }));

    // Fire all tests in parallel — each resolves independently
    let done = 0;
    await Promise.all(allModels.map(async (m) => {
      const key = `${m.provider}:${m.id}`;
      try {
        const res = await fetch('/api/todoist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'test-model', provider: m.provider, model: m.id }),
        });
        if (res.ok) {
          const data = await res.json();
          setModelTests(prev => ({
            ...prev,
            [key]: data.success
              ? { status: 'ok', latency: data.latencyMs, response: data.response, tokensIn: data.tokensIn, tokensOut: data.tokensOut, estimatedCost: data.estimatedCost }
              : { status: 'fail', error: data.error, latency: data.latencyMs },
          }));
        } else {
          setModelTests(prev => ({ ...prev, [key]: { status: 'fail', error: 'Request failed' } }));
        }
      } catch {
        setModelTests(prev => ({ ...prev, [key]: { status: 'fail', error: 'Network error' } }));
      }
      done++;
      setTestAllProgress({ done, total: allModels.length });
    }));

    setTestAllRunning(false);
  };

  const handleToggleModel = (provider: Provider, modelId: string) => {
    const key = `${provider}:${modelId}`;
    setDisabledModels(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSaveDisabled = async () => {
    setSavingDisabled(true);
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-settings',
          data: { disabledModels },
        }),
      });
    } finally {
      setSavingDisabled(false);
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
          description="All keys are stored server-side as environment variables."
        >
          <div className="space-y-3">
            <ApiKeyRow name="Todoist" envVar="TODOIST_API_TOKEN" status={testResults.todoist} />
            <ApiKeyRow name="Google Gemini" envVar="GEMINI_API_KEY" status={testResults.gemini} />
            <ApiKeyRow name="Anthropic" envVar="ANTHROPIC_API_KEY" status={testResults.anthropic} />
            <ApiKeyRow name="OpenAI" envVar="OPENAI_API_KEY" status={testResults.openai} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            To update keys, modify environment variables in your .env.local file.
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
                <span className="ml-3">Inbox: {new Date(syncState.lastInboxSync).toLocaleString()}</span>
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
        </Section>

        {/* LLM Configuration — Per-Operation */}
        <Section icon={Cpu} title="LLM Configuration" description="Per-operation model assignment with provider selection">
          {loadingModels ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading available models...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Quick test all unique models */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">Quick test:</span>
                {uniqueModelsInUse().map(({ provider, model }) => {
                  const key = `${provider}:${model}`;
                  const test = modelTests[key];
                  return (
                    <button
                      key={key}
                      onClick={() => handleTestModel(provider, model)}
                      disabled={test?.status === 'testing'}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        test?.status === 'ok' && 'border-green-500/50 bg-green-500/10 text-green-400',
                        test?.status === 'fail' && 'border-destructive/50 bg-destructive/10 text-destructive',
                        !test?.status && 'border-border text-muted-foreground hover:bg-accent',
                        test?.status === 'testing' && 'border-border text-muted-foreground opacity-50',
                      )}
                    >
                      {test?.status === 'testing' && <Loader2 className="h-3 w-3 animate-spin" />}
                      {test?.status === 'ok' && <CheckCircle className="h-3 w-3" />}
                      {test?.status === 'fail' && <XCircle className="h-3 w-3" />}
                      {!test?.status && <Play className="h-3 w-3" />}
                      {model}
                      {test?.latency != null && <span className="opacity-60">{test.latency}ms</span>}
                    </button>
                  );
                })}
              </div>

              {/* Provider availability */}
              <div className="flex gap-3 text-xs">
                {providers.map(p => (
                  <span
                    key={p.provider}
                    className={cn(
                      'inline-flex items-center gap-1',
                      p.available ? 'text-green-400' : 'text-muted-foreground'
                    )}
                  >
                    <span className={cn('inline-block h-1.5 w-1.5 rounded-full', p.available ? 'bg-green-400' : 'bg-muted-foreground')} />
                    {p.label} ({p.models.length})
                  </span>
                ))}
              </div>

              {/* Per-operation config table */}
              <div className="space-y-1.5">
                {OPERATIONS.map((op) => {
                  const assignment = modelConfig[op] || { provider: 'gemini', model: '' };
                  const info = OPERATION_LABELS[op];
                  const availModels = modelsForProvider(assignment.provider);
                  const testKey = `${assignment.provider}:${assignment.model}`;
                  const test = modelTests[testKey];

                  return (
                    <div key={op} className="grid grid-cols-[1fr_140px_1fr_36px] gap-2 items-center rounded-lg bg-secondary/50 px-3 py-2">
                      {/* Operation label */}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{info.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{info.description}</div>
                      </div>

                      {/* Provider dropdown */}
                      <select
                        value={assignment.provider}
                        onChange={(e) => handleProviderChange(op, e.target.value as Provider)}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      >
                        {providers.filter(p => p.available).map(p => (
                          <option key={p.provider} value={p.provider}>{p.label}</option>
                        ))}
                      </select>

                      {/* Model dropdown */}
                      <select
                        value={assignment.model}
                        onChange={(e) => handleModelChange(op, e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none truncate"
                      >
                        {availModels.length === 0 && (
                          <option value="">No models loaded</option>
                        )}
                        {availModels.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>

                      {/* Status indicator */}
                      <div className="flex justify-center">
                        {test?.status === 'ok' && <CheckCircle className="h-4 w-4 text-green-400" />}
                        {test?.status === 'fail' && (
                          <span title={test.error}><XCircle className="h-4 w-4 text-destructive" /></span>
                        )}
                        {test?.status === 'testing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Auto-approve threshold */}
              <div className="rounded-lg bg-secondary/50 px-4 py-3">
                <label className="block text-sm font-medium mb-1">Auto-Approve Threshold</label>
                <p className="text-xs text-muted-foreground mb-2">Tasks above this confidence are auto-approved in Clarify</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={autoApproveThreshold}
                    onChange={(e) => setAutoApproveThreshold(parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12 text-right">{Math.round(autoApproveThreshold * 100)}%</span>
                </div>
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingSettings ? 'Saving...' : 'Save Model Settings'}
                </button>
                {settingsSaved && (
                  <span className="text-xs text-green-400">Saved — takes effect on next LLM call</span>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* Admin Panel — collapsible */}
        <div className="rounded-xl border border-border bg-card">
          <button
            onClick={() => setAdminOpen(o => !o)}
            className="flex w-full items-center justify-between p-5"
          >
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div className="text-left">
                <h2 className="text-sm font-semibold">Admin Panel</h2>
                <p className="text-xs text-muted-foreground">Model health check, enable/disable models, diagnostics</p>
              </div>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', adminOpen && 'rotate-180')} />
          </button>

          {adminOpen && (
            <div className="border-t border-border p-5 space-y-6">
              {/* Test prompt preview */}
              <div className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-3 text-xs space-y-1">
                <div className="font-medium text-muted-foreground">Test prompt (Responses API)</div>
                <div className="text-foreground/80"><span className="text-muted-foreground">System:</span> You are a task management assistant. Clarify this task into an actionable next step with a clear title.</div>
                <div className="text-foreground/80"><span className="text-muted-foreground">User:</span> Fix the deployment pipeline thing that broke last week</div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleTestAll}
                  disabled={testAllRunning || loadingModels}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {testAllRunning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Testing {testAllProgress.done}/{testAllProgress.total}...</>
                  ) : (
                    <><Zap className="h-4 w-4" /> Test All Models</>
                  )}
                </button>
                <button
                  onClick={handleSaveDisabled}
                  disabled={savingDisabled}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {savingDisabled ? 'Saving...' : `Save Disabled (${disabledModels.length})`}
                </button>
                {!testAllRunning && Object.keys(modelTests).length > 0 && (() => {
                  const passed = Object.values(modelTests).filter(t => t.status === 'ok').length;
                  const failed = Object.values(modelTests).filter(t => t.status === 'fail').length;
                  const total = passed + failed;
                  if (total === 0) return null;
                  const totalCost = Object.values(modelTests).reduce((s, t) => s + (t.estimatedCost || 0), 0);
                  return (
                    <span className="text-xs text-muted-foreground">
                      {passed}/{total} passed
                      {failed > 0 && <span className="text-destructive ml-1">({failed} failed)</span>}
                      {totalCost > 0 && <span className="ml-2">Total: ${totalCost.toFixed(6)}</span>}
                    </span>
                  );
                })()}
              </div>

              {providers.filter(p => p.available && p.models.length > 0).map(p => (
                <div key={p.provider}>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">{p.label} ({p.models.length})</div>
                  <div className="space-y-1.5">
                    {p.models.map(m => {
                      const key = `${m.provider}:${m.id}`;
                      const test = modelTests[key];
                      const isDisabled = disabledModels.includes(key);
                      return (
                        <ModelTestCard
                          key={m.id}
                          model={m}
                          test={test}
                          testAllRunning={testAllRunning}
                          disabled={isDisabled}
                          onTest={() => handleTestModel(m.provider, m.id)}
                          onToggle={() => handleToggleModel(m.provider, m.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {!loadingModels && providers.every(p => p.models.length === 0) && (
                <p className="text-xs text-muted-foreground">No models loaded. Check your API keys above.</p>
              )}
            </div>
          )}
        </div>

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

function ModelTestCard({
  model,
  test,
  testAllRunning,
  disabled,
  onTest,
  onToggle,
}: {
  model: AvailableModel;
  test?: { status: 'testing' | 'ok' | 'fail'; latency?: number; error?: string; response?: string; tokensIn?: number; tokensOut?: number; estimatedCost?: number };
  testAllRunning: boolean;
  disabled: boolean;
  onTest: () => void;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = test?.response || test?.tokensIn != null;

  return (
    <div
      className={cn(
        'rounded-md border text-xs transition-colors',
        disabled && 'opacity-50',
        test?.status === 'ok' && !disabled && 'border-green-500/30 bg-green-500/5',
        test?.status === 'fail' && !disabled && 'border-destructive/30 bg-destructive/5',
        (!test || test.status === 'testing') && 'border-border bg-secondary/30',
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {test?.status === 'testing' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
          {test?.status === 'ok' && <CheckCircle className="h-3 w-3 text-green-400 shrink-0" />}
          {test?.status === 'fail' && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
          {!test && <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />}
          <span className={cn('truncate font-medium', disabled && 'line-through')}>{model.name}</span>
          {disabled && <span className="text-[10px] text-muted-foreground">(disabled)</span>}
          {model.pricing && (
            <span className="text-[10px] text-muted-foreground shrink-0" title={`$${model.pricing.inputPerMTok}/MTok in, $${model.pricing.outputPerMTok}/MTok out`}>
              ${model.pricing.inputPerMTok}/${model.pricing.outputPerMTok}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {test?.latency != null && (
            <span className="text-[10px] text-muted-foreground font-mono">{test.latency}ms</span>
          )}
          {test?.tokensIn != null && (
            <span className="text-[10px] text-muted-foreground font-mono" title="Tokens in/out">{test.tokensIn}/{test.tokensOut}</span>
          )}
          {test?.estimatedCost != null && (
            <span className="text-[10px] text-green-400 font-mono" title="Estimated cost for this call">${test.estimatedCost.toFixed(6)}</span>
          )}
          {test?.status === 'fail' && test.error && !hasDetails && (
            <span title={test.error} className="text-[10px] text-destructive truncate max-w-[120px]">{test.error}</span>
          )}
          {hasDetails && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-muted-foreground hover:text-foreground"
              title="Show response"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
          <button
            onClick={onToggle}
            className={cn('transition-colors', disabled ? 'text-muted-foreground hover:text-foreground' : 'text-foreground/60 hover:text-destructive')}
            title={disabled ? 'Enable model' : 'Disable model'}
          >
            {disabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          {!testAllRunning && (
            <button
              onClick={onTest}
              disabled={test?.status === 'testing'}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Test this model"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {/* Expandable details */}
      {expanded && hasDetails && (
        <div className="border-t border-border/50 px-3 py-2 space-y-1">
          {test?.status === 'fail' && test.error && (
            <div className="text-[11px] text-destructive">{test.error}</div>
          )}
          {test?.response && (
            <div className="text-[11px] text-foreground/70 whitespace-pre-wrap break-words max-h-32 overflow-auto font-mono bg-background/50 rounded p-1.5">
              {test.response}
            </div>
          )}
        </div>
      )}
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
