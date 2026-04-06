'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Key, RefreshCw, Database, Cpu, Download, AlertTriangle, Play, CheckCircle, XCircle, Loader2, Zap, ChevronDown, Shield, EyeOff, Eye, BarChart3, Archive, ArrowRight, Brain } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/ui-parts';
import { toast } from '@/hooks/use-toast';
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
  const router = useRouter();
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

  // Usage dashboard state
  const [usageStats, setUsageStats] = useState<{
    totalCalls: number; totalCost: number; totalTokensIn: number; totalTokensOut: number;
    byOperation: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number; avgLatency: number }>;
    byDay: Record<string, { calls: number; cost: number }>;
    period: number;
  } | null>(null);
  const [usagePeriod, setUsagePeriod] = useState('30');
  const [usageLoading, setUsageLoading] = useState(false);

  // Diagnostics log state
  const [appLogs, setAppLogs] = useState<{ id: string; level: string; category: string; message: string; details: string | null; timestamp: string | null }[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logCategory, setLogCategory] = useState<string>('all');

  // Budget state
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(null);
  const [savingDisabled, setSavingDisabled] = useState(false);

  // Legacy onboarding state
  const [legacyCount, setLegacyCount] = useState<number | null>(null);
  const [dupeSimilarityThreshold, setDupeSimilarityThreshold] = useState(0.92);

  // Knowledge migration state
  const [knowledgeMigrated, setKnowledgeMigrated] = useState<boolean | null>(null);
  const [migratingKnowledge, setMigratingKnowledge] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ objectsMigrated: number; peopleMigrated: number; embeddingsGenerated: number; errors: string[] } | null>(null);

  // Knowledge embedding/export state
  const [embeddingStats, setEmbeddingStats] = useState<{ withEmbedding: number; withoutEmbedding: number; embeddingModel: string } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [importing, setImporting] = useState(false);

  // Knowledge consolidation state
  const [consolidating, setConsolidating] = useState(false);
  const [consolidationResult, setConsolidationResult] = useState<{
    runId: string; dormancyTransitions: number; mergesPerformed: number;
    synthesesCreated: number; objectsAbsorbed: number; referencesPurged: number; errors: string[];
  } | null>(null);

  const [settingsError, setSettingsError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, modelsRes, syncRes, legacyRes] = await Promise.all([
        fetch('/api/todoist?action=app-settings'),
        fetch('/api/todoist?action=available-models'),
        fetch('/api/todoist?action=sync-state'),
        fetch('/api/todoist?action=legacy-count'),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        if (data.modelConfig && typeof data.modelConfig === 'object') {
          setModelConfig(data.modelConfig);
        }
        setAutoApproveThreshold(data.autoApproveThreshold ?? 0.8);
        setDupeSimilarityThreshold(data.dupeSimilarityThreshold ?? 0.92);
        setMonthlyBudget(data.monthlyBudget ?? null);
        if (Array.isArray(data.disabledModels)) {
          setDisabledModels(data.disabledModels);
        }
      }

      if (legacyRes.ok) {
        const data = await legacyRes.json();
        setLegacyCount(data.count ?? 0);
      }

      // Check knowledge migration status and embedding stats (best-effort)
      try {
        const [kgRes, embRes] = await Promise.all([
          fetch('/api/todoist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'knowledge-migration-status' }),
          }),
          fetch('/api/todoist?action=knowledge-stats'),
        ]);
        if (kgRes.ok) {
          const data = await kgRes.json();
          setKnowledgeMigrated(data.migrated);
        }
        if (embRes.ok) {
          const data = await embRes.json();
          setEmbeddingStats({ withEmbedding: data.withEmbedding ?? 0, withoutEmbedding: data.withoutEmbedding ?? 0, embeddingModel: data.embeddingModel ?? 'unknown' });
        }
      } catch {}

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setProviders(data);
      }

      if (syncRes.ok) {
        const data = await syncRes.json();
        setSyncState(data);
      }
      setSettingsError(null);
    } catch {
      setSettingsError('Failed to load settings. Check your connection.');
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Refresh legacy count when tasks change (e.g., after onboarding)
  useEffect(() => {
    const handler = () => {
      fetch('/api/todoist?action=legacy-count').then(r => r.ok ? r.json() : null).then(d => {
        if (d) setLegacyCount(d.count ?? 0);
      }).catch(() => {});
    };
    window.addEventListener('task-changed', handler);
    return () => window.removeEventListener('task-changed', handler);
  }, []);

  const loadUsageStats = useCallback(async (period: string) => {
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/todoist?action=usage-stats&period=${period}`);
      if (res.ok) setUsageStats(await res.json());
    } catch {} finally {
      setUsageLoading(false);
    }
  }, []);

  const loadAppLogs = useCallback(async (category?: string) => {
    setLogsLoading(true);
    try {
      const params = category && category !== 'all' ? `&category=${category}` : '';
      const res = await fetch(`/api/todoist?action=app-log&limit=200${params}`);
      if (res.ok) setAppLogs(await res.json());
    } catch {} finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => { loadUsageStats(usagePeriod); }, [usagePeriod, loadUsageStats]);

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
      const res = await fetch('/api/model-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
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

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaved(false);
    setSaveError(null);
    try {
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-settings',
          data: { modelConfig, autoApproveThreshold, dupeSimilarityThreshold, disabledModels },
        }),
      });
      if (res.ok) {
        setSettingsSaved(true);
      } else {
        setSaveError('Failed to save settings.');
      }
    } catch {
      setSaveError('Network error — could not save.');
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
        toast({ title: 'Sync complete', description: `Synced ${data.synced} tasks.`, duration: 4000 });
        const stateRes = await fetch('/api/todoist?action=sync-state');
        if (stateRes.ok) setSyncState(await stateRes.json());
        window.dispatchEvent(new Event('task-changed'));
        window.dispatchEvent(new Event('inbox-changed'));
      } else {
        toast({ title: 'Sync failed', description: 'Server error during sync.', duration: 5000 });
      }
    } catch {
      toast({ title: 'Sync failed', description: 'Network error during sync.', duration: 5000 });
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (type: 'knowledge' | 'history') => {
    try {
      const action = type === 'knowledge' ? 'knowledge' : 'task-history';
      const res = await fetch(`/api/todoist?action=${action}`);
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `burn-down-${type}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 200);
      } else {
        toast({ title: 'Export failed', description: 'Could not fetch data for export.', duration: 4000 });
      }
    } catch {
      toast({ title: 'Export failed', description: 'Network error during export.', duration: 4000 });
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {syncState?.lastFullSync
                ? `Last full sync: ${new Date(syncState.lastFullSync).toLocaleString()}`
                : 'Never synced'}
              {syncState?.lastInboxSync && (
                <div className="mt-0.5 sm:mt-0 sm:ml-3 sm:inline">Inbox: {new Date(syncState.lastInboxSync).toLocaleString()}</div>
              )}
            </div>
            <button
              onClick={handleFullSync}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:py-2"
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
              {/* Preset buttons */}
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">Quick Presets</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const geminiModels = modelsForProvider('gemini');
                      const fast = geminiModels.find(m => m.id.includes('3.1-flash-lite')) || geminiModels.find(m => m.id.includes('flash')) || geminiModels[0];
                      if (fast) {
                        const config: ModelConfig = {};
                        for (const op of OPERATIONS) config[op] = { provider: 'gemini', model: fast.id };
                        setModelConfig(config);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Zap className="h-3 w-3 text-amber-400" /> Fast — All Gemini Flash
                  </button>
                  <button
                    onClick={() => {
                      const anthropicModels = modelsForProvider('anthropic');
                      const smart = anthropicModels.find(m => m.id.includes('sonnet') || m.id.includes('opus')) || anthropicModels[0];
                      if (smart) {
                        const config: ModelConfig = {};
                        for (const op of OPERATIONS) config[op] = { provider: 'anthropic', model: smart.id };
                        setModelConfig(config);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Cpu className="h-3 w-3 text-purple-400" /> Smart — All Claude
                  </button>
                  <button
                    onClick={() => {
                      const geminiModels = modelsForProvider('gemini');
                      const anthropicModels = modelsForProvider('anthropic');
                      const fast = geminiModels.find(m => m.id.includes('3.1-flash-lite')) || geminiModels.find(m => m.id.includes('flash')) || geminiModels[0];
                      const smart = anthropicModels.find(m => m.id.includes('sonnet') || m.id.includes('opus')) || anthropicModels[0];
                      if (fast && smart) {
                        const complexOps = ['clarify_task', 'complex_decomposition', 'weekly_review', 'project_audit', 'priority_recalibration'];
                        const config: ModelConfig = {};
                        for (const op of OPERATIONS) {
                          config[op] = complexOps.includes(op)
                            ? { provider: 'anthropic', model: smart.id }
                            : { provider: 'gemini', model: fast.id };
                        }
                        setModelConfig(config);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="h-3 w-3 text-blue-400" /> Balanced — Claude for complex, Gemini for quick
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">Presets change selections below. Click &quot;Save Model Settings&quot; to apply.</p>
              </div>
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
                    <div key={op} className="rounded-lg bg-secondary/50 px-3 py-3 sm:py-2">
                      {/* Operation label */}
                      <div className="mb-2 min-w-0 sm:mb-0 sm:float-none">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium truncate">{info.label}</div>
                          <div className="flex justify-center sm:hidden">
                            {test?.status === 'ok' && <CheckCircle className="h-4 w-4 text-green-400" />}
                            {test?.status === 'fail' && (
                              <span title={test.error}><XCircle className="h-4 w-4 text-destructive" /></span>
                            )}
                            {test?.status === 'testing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{info.description}</div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {/* Provider dropdown */}
                        <select
                          value={assignment.provider}
                          onChange={(e) => handleProviderChange(op, e.target.value as Provider)}
                          aria-label={`${info.label} provider`}
                          className="w-full rounded-md border border-border bg-background px-2 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none sm:w-[140px] sm:py-1.5"
                        >
                          {providers.filter(p => p.available).map(p => (
                            <option key={p.provider} value={p.provider}>{p.label}</option>
                          ))}
                        </select>

                        {/* Model dropdown */}
                        <select
                          value={assignment.model}
                          onChange={(e) => handleModelChange(op, e.target.value)}
                          aria-label={`${info.label} model`}
                          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none sm:py-1.5"
                        >
                          {availModels.length === 0 && !assignment.model && (
                            <option value="">No models loaded</option>
                          )}
                          {/* Show current model even if not in available list */}
                          {assignment.model && !availModels.some(m => m.id === assignment.model) && (
                            <option value={assignment.model}>{assignment.model}</option>
                          )}
                          {availModels.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>

                        {/* Status indicator — desktop */}
                        <div className="hidden w-9 justify-center sm:flex">
                          {test?.status === 'ok' && <CheckCircle className="h-4 w-4 text-green-400" />}
                          {test?.status === 'fail' && (
                            <span title={test.error}><XCircle className="h-4 w-4 text-destructive" /></span>
                          )}
                          {test?.status === 'testing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
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
                    aria-label="Auto-approve confidence threshold"
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12 text-right">{Math.round(autoApproveThreshold * 100)}%</span>
                </div>
              </div>

              {/* Duplicate similarity threshold */}
              <div className="rounded-lg bg-secondary/50 px-4 py-3">
                <label className="block text-sm font-medium mb-1">Duplicate Detection Threshold</label>
                <p className="text-xs text-muted-foreground mb-2">Tasks with embedding similarity above this are flagged as possible duplicates. Lower = more aggressive (more false positives but fewer missed duplicates).</p>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.5"
                    max="0.95"
                    step="0.05"
                    value={dupeSimilarityThreshold}
                    onChange={(e) => setDupeSimilarityThreshold(parseFloat(e.target.value))}
                    aria-label="Duplicate similarity threshold"
                    className="flex-1"
                  />
                  <span className="text-sm font-mono w-12 text-right">{Math.round(dupeSimilarityThreshold * 100)}%</span>
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

        {/* Legacy Task Onboarding */}
        <Section icon={Archive} title="Legacy Task Onboarding" description="Enrich imported Todoist tasks that were never clarified">
          <p className="text-xs text-muted-foreground mb-3">
            Tasks imported from Todoist via full sync that have no LLM enrichment (no next action, time estimate, or energy level).
            Onboarding runs the clarify process on them in bulk, using their existing Todoist metadata as context.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/onboard')}
              disabled={legacyCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:py-2"
            >
              Start Onboarding {legacyCount != null && legacyCount > 0 && `(${legacyCount})`}
              <ArrowRight className="h-4 w-4" />
            </button>
            {legacyCount === 0 && (
              <span className="text-xs text-green-400">All tasks enriched</span>
            )}
            {legacyCount == null && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </Section>

        {/* Knowledge Graph Migration */}
        <Section icon={Brain} title="Knowledge Graph Migration" description="Migrate legacy knowledge entries and people to the new knowledge graph">
          <p className="text-xs text-muted-foreground mb-3">
            Copies your existing knowledge entries and people into the new ontology-driven knowledge graph with typed objects, relationships, and semantic embeddings. This is a one-time operation.
          </p>
          {migrationResult && (
            <div className={cn(
              'mb-3 rounded-lg p-3 text-xs',
              migrationResult.errors.length > 0 ? 'border border-amber-500/30 bg-amber-500/5' : 'border border-green-500/30 bg-green-500/5'
            )}>
              <div className="font-medium">
                Migrated {migrationResult.objectsMigrated} knowledge entries, {migrationResult.peopleMigrated} people, generated {migrationResult.embeddingsGenerated} embeddings
              </div>
              {migrationResult.errors.length > 0 && (
                <div className="mt-1 text-amber-400">
                  {migrationResult.errors.length} warning(s): {migrationResult.errors[0]}
                  {migrationResult.errors.length > 1 && ` (+${migrationResult.errors.length - 1} more)`}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setMigratingKnowledge(true);
                setMigrationResult(null);
                try {
                  const res = await fetch('/api/todoist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'migrate-knowledge' }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setMigrationResult(data);
                    setKnowledgeMigrated(true);
                  } else {
                    setMigrationResult({ objectsMigrated: 0, peopleMigrated: 0, embeddingsGenerated: 0, errors: ['Migration request failed'] });
                  }
                } catch {
                  setMigrationResult({ objectsMigrated: 0, peopleMigrated: 0, embeddingsGenerated: 0, errors: ['Network error'] });
                } finally {
                  setMigratingKnowledge(false);
                }
              }}
              disabled={migratingKnowledge || knowledgeMigrated === true}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:py-2"
            >
              {migratingKnowledge ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {migratingKnowledge ? 'Migrating...' : knowledgeMigrated ? 'Migration Complete' : 'Migrate Legacy Knowledge'}
            </button>
            {knowledgeMigrated && !migrationResult && (
              <span className="text-xs text-green-400">Already migrated</span>
            )}
          </div>
        </Section>

        {/* Knowledge Consolidation */}
        <Section icon={Brain} title="Knowledge Consolidation" description="Compress the knowledge graph: fade stale objects, merge duplicates, synthesize patterns">
          <p className="text-xs text-muted-foreground mb-3">
            Runs automatically as a weekly review pre-step. Manual trigger here for immediate consolidation.
            Dormant objects are faded (not deleted). Duplicate merges and pattern syntheses are LLM-evaluated.
          </p>
          {consolidationResult && (
            <div className={cn(
              'mb-3 rounded-lg p-3 text-xs',
              consolidationResult.errors.length > 0 ? 'border border-amber-500/30 bg-amber-500/5' : 'border border-green-500/30 bg-green-500/5'
            )}>
              <div className="font-medium">
                {consolidationResult.dormancyTransitions} dormant, {consolidationResult.mergesPerformed} merges, {consolidationResult.synthesesCreated} syntheses, {consolidationResult.objectsAbsorbed} absorbed, {consolidationResult.referencesPurged} refs purged
              </div>
              {consolidationResult.errors.length > 0 && (
                <div className="mt-1 text-amber-400">
                  {consolidationResult.errors.length} warning(s): {consolidationResult.errors[0]}
                  {consolidationResult.errors.length > 1 && ` (+${consolidationResult.errors.length - 1} more)`}
                </div>
              )}
              <button
                onClick={async () => {
                  if (!confirm('Revert this consolidation run? This will restore absorbed objects and delete syntheses.')) return;
                  try {
                    const res = await fetch('/api/todoist', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'revert-consolidation', runId: consolidationResult.runId }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.reverted) {
                        setConsolidationResult(null);
                        toast({ title: 'Consolidation reverted', duration: 3000 });
                      } else {
                        toast({ title: 'Revert failed', description: data.error, duration: 5000 });
                      }
                    }
                  } catch {}
                }}
                className="mt-2 text-[10px] text-muted-foreground underline hover:text-foreground"
              >
                Revert this run
              </button>
            </div>
          )}
          <button
            onClick={async () => {
              setConsolidating(true);
              setConsolidationResult(null);
              try {
                const res = await fetch('/api/todoist', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'consolidate-knowledge', scope: 'full' }),
                });
                if (res.ok) {
                  setConsolidationResult(await res.json());
                }
              } catch {
                toast({ title: 'Consolidation failed', duration: 5000 });
              } finally {
                setConsolidating(false);
              }
            }}
            disabled={consolidating}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:py-2"
          >
            {consolidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {consolidating ? 'Consolidating...' : 'Consolidate Knowledge'}
          </button>
        </Section>

        {/* Knowledge Embeddings */}
        <Section icon={Brain} title="Knowledge Embeddings" description="Embedding status and backfill for vector search">
          {embeddingStats && (
            <div className="flex flex-wrap gap-3 mb-3 text-xs">
              <div className="rounded-lg bg-secondary px-3 py-2"><span className="text-muted-foreground">With embeddings:</span> <span className="font-medium">{embeddingStats.withEmbedding}</span></div>
              <div className="rounded-lg bg-secondary px-3 py-2"><span className="text-muted-foreground">Without:</span> <span className="font-medium">{embeddingStats.withoutEmbedding}</span></div>
              <div className="rounded-lg bg-secondary px-3 py-2"><span className="text-muted-foreground">Model:</span> <span className="font-mono">{embeddingStats.embeddingModel}</span></div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setBackfilling(true);
                try {
                  const res = await fetch('/api/todoist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kg-backfill-embeddings' }) });
                  if (res.ok) { const d = await res.json(); toast({ title: `Backfill complete`, description: `${d.generated} embeddings generated`, duration: 4000 }); }
                } finally { setBackfilling(false); loadSettings(); }
              }}
              disabled={backfilling || (embeddingStats?.withoutEmbedding ?? 0) === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Backfill Missing ({embeddingStats?.withoutEmbedding ?? 0})
            </button>
            <button
              onClick={async () => {
                if (!confirm('Regenerate ALL embeddings? This will re-embed every object and may take a while.')) return;
                setBackfilling(true);
                try {
                  const res = await fetch('/api/todoist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kg-backfill-embeddings', regenerateAll: true }) });
                  if (res.ok) { const d = await res.json(); toast({ title: `Regeneration complete`, description: `${d.generated} embeddings regenerated`, duration: 4000 }); }
                } finally { setBackfilling(false); loadSettings(); }
              }}
              disabled={backfilling}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Regenerate All
            </button>
          </div>
        </Section>

        {/* Knowledge Export/Import */}
        <Section icon={Database} title="Knowledge Export / Import" description="Full knowledge graph export and additive import">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/todoist?action=knowledge-export');
                  if (res.ok) {
                    const data = await res.json();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `knowledge-graph-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 200);
                  }
                } catch { toast({ title: 'Export failed', duration: 4000 }); }
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Download className="h-4 w-4" /> Export Knowledge Graph
            </button>
            <label className={cn('inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer', importing && 'opacity-50 pointer-events-none')}>
              <Download className="h-4 w-4 rotate-180" /> Import (Additive)
              <input type="file" accept=".json" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImporting(true);
                try {
                  const text = await file.text();
                  const data = JSON.parse(text);
                  const res = await fetch('/api/todoist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kg-import', data }) });
                  if (res.ok) { const d = await res.json(); toast({ title: 'Import complete', description: `${d.objectsImported} objects, ${d.linksImported} links imported`, duration: 4000 }); }
                } catch { toast({ title: 'Import failed', duration: 4000 }); }
                finally { setImporting(false); e.target.value = ''; }
              }} />
            </label>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Import is additive — objects are matched by dedup key. Duplicates are merged, not overwritten.</p>
        </Section>

        {/* Usage Dashboard */}
        <Section icon={BarChart3} title="LLM Usage" description="Token consumption, cost, and operational breakdown">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <select
                value={usagePeriod}
                onChange={(e) => setUsagePeriod(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <button
                onClick={() => loadUsageStats(usagePeriod)}
                disabled={usageLoading}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {usageLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </button>
            </div>

            {usageStats && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-xs text-muted-foreground">Total Calls</div>
                    <div className="mt-1 text-lg font-semibold">{usageStats.totalCalls.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-xs text-muted-foreground">Total Cost</div>
                    <div className="mt-1 text-lg font-semibold">${usageStats.totalCost.toFixed(4)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-xs text-muted-foreground">Tokens In</div>
                    <div className="mt-1 text-lg font-semibold">{(usageStats.totalTokensIn / 1000).toFixed(1)}k</div>
                  </div>
                  <div className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-xs text-muted-foreground">Tokens Out</div>
                    <div className="mt-1 text-lg font-semibold">{(usageStats.totalTokensOut / 1000).toFixed(1)}k</div>
                  </div>
                </div>

                {/* Budget status */}
                {monthlyBudget && monthlyBudget > 0 && (() => {
                  // Calculate current month's spend from byDay
                  const now = new Date();
                  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                  const monthSpend = Object.entries(usageStats.byDay)
                    .filter(([day]) => day.startsWith(monthPrefix))
                    .reduce((sum, [, d]) => sum + d.cost, 0);
                  const pct = (monthSpend / monthlyBudget) * 100;
                  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-green-500';
                  return (
                    <div className={cn('rounded-lg border p-3', pct >= 80 ? 'border-amber-500/30 bg-amber-500/5' : 'border-border')}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Monthly budget</span>
                        <span className={pct >= 100 ? 'text-red-400 font-medium' : pct >= 80 ? 'text-amber-400 font-medium' : 'text-muted-foreground'}>
                          ${monthSpend.toFixed(4)} / ${monthlyBudget.toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      {pct >= 80 && (
                        <p className="mt-1.5 text-[10px] text-amber-400">
                          {pct >= 100 ? 'Budget exceeded for this month.' : `${Math.round(pct)}% of monthly budget used.`}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* By operation breakdown */}
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">By Operation</div>
                  <div className="space-y-1">
                    {Object.entries(usageStats.byOperation)
                      .sort(([, a], [, b]) => b.cost - a.cost)
                      .map(([op, stats]) => (
                        <div key={op} className="flex items-center gap-3 rounded-lg bg-secondary/30 px-3 py-2 text-xs">
                          <span className="flex-1 font-medium">{op.replace(/_/g, ' ')}</span>
                          <span className="text-muted-foreground">{stats.calls} calls</span>
                          <span className="text-muted-foreground">{stats.avgLatency}ms avg</span>
                          <span className="font-medium">${stats.cost.toFixed(4)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Daily trend (simple text chart) */}
                {Object.keys(usageStats.byDay).length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Daily Activity</div>
                    <div className="space-y-0.5">
                      {Object.entries(usageStats.byDay)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .slice(-14) // Show last 14 days
                        .map(([day, stats]) => {
                          const maxCalls = Math.max(...Object.values(usageStats.byDay).map(d => d.calls));
                          const width = maxCalls > 0 ? (stats.calls / maxCalls) * 100 : 0;
                          return (
                            <div key={day} className="flex items-center gap-2 text-[10px]">
                              <span className="w-16 shrink-0 text-muted-foreground">{day.slice(5)}</span>
                              <div className="flex-1 h-3 rounded bg-secondary/50 overflow-hidden">
                                <div className="h-full rounded bg-primary/60" style={{ width: `${width}%` }} />
                              </div>
                              <span className="w-8 text-right text-muted-foreground">{stats.calls}</span>
                              <span className="w-16 text-right text-muted-foreground">${stats.cost.toFixed(4)}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        {/* Budget Settings */}
        <Section icon={Shield} title="Budget" description="Monthly cost limit with warnings">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground">Monthly budget (USD)</label>
              <input
                type="number"
                step="0.50"
                min="0"
                value={monthlyBudget ?? ''}
                onChange={(e) => setMonthlyBudget(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder="No limit"
                className="w-32 rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              />
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/todoist', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'update-settings', data: { monthlyBudget } }),
                    });
                    toast({ title: 'Budget saved', duration: 3000 });
                  } catch {
                    toast({ title: 'Failed to save budget', duration: 4000 });
                  }
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {monthlyBudget ? `Warning shown at 80% ($${(monthlyBudget * 0.8).toFixed(2)}) and 100% ($${monthlyBudget.toFixed(2)}).` : 'No budget set — all LLM operations will run without cost limits.'}
            </p>
          </div>
        </Section>

        {/* Diagnostics Log */}
        <Section icon={Database} title="Diagnostics Log" description="System events, sync activity, and errors">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <select
                value={logCategory}
                onChange={(e) => { setLogCategory(e.target.value); loadAppLogs(e.target.value); }}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
              >
                <option value="all">All Categories</option>
                <option value="sync">Sync</option>
                <option value="task">Task</option>
                <option value="llm">LLM</option>
                <option value="auth">Auth</option>
                <option value="system">System</option>
              </select>
              <button
                onClick={() => loadAppLogs(logCategory)}
                disabled={logsLoading}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {logsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load'}
              </button>
            </div>

            {appLogs.length > 0 ? (
              <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg border border-border bg-secondary/20 p-2">
                {appLogs.map(log => (
                  <div key={log.id} className="flex items-start gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-secondary/50">
                    <span className={cn(
                      'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      log.level === 'error' ? 'bg-red-400' : log.level === 'warn' ? 'bg-amber-400' : 'bg-green-400',
                    )} />
                    <span className="w-12 shrink-0 text-muted-foreground/60">{log.timestamp?.split('T')[1]?.slice(0, 8) || ''}</span>
                    <span className="w-12 shrink-0 rounded bg-secondary px-1 py-0.5 text-center text-[9px] text-muted-foreground">{log.category}</span>
                    <span className="flex-1 text-muted-foreground">{log.message}</span>
                    {log.details && (
                      <span className="shrink-0 text-[9px] text-muted-foreground/40" title={log.details}>
                        [details]
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {logsLoading ? 'Loading...' : 'No log entries. Click "Load" to fetch diagnostics.'}
              </p>
            )}
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
