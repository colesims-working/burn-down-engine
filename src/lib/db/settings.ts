import { db, schema } from './client';
import type { LLMOperation } from '@/lib/llm/router';

export type Provider = 'gemini' | 'anthropic' | 'openai' | 'openrouter';

export interface ModelAssignment {
  provider: Provider;
  model: string;
}

export type ModelConfig = Record<string, ModelAssignment>;

const DEFAULT_PRIMARY: ModelAssignment = { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' };
const DEFAULT_HEAVY: ModelAssignment = { provider: 'anthropic', model: 'claude-opus-4-20250514' };

const HEAVY_OPERATIONS: LLMOperation[] = [
  'project_audit',
  'weekly_review',
  'complex_decomposition',
  'priority_recalibration',
  'organize_conversation',
];

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  clarify_task: DEFAULT_PRIMARY,
  extract_tasks_from_voice: DEFAULT_PRIMARY,
  extract_knowledge: DEFAULT_PRIMARY,
  file_suggestions: DEFAULT_PRIMARY,
  rank_tasks: DEFAULT_PRIMARY,
  fire_triage: DEFAULT_PRIMARY,
  daily_observations: DEFAULT_PRIMARY,
  project_audit: DEFAULT_HEAVY,
  weekly_review: DEFAULT_HEAVY,
  complex_decomposition: DEFAULT_HEAVY,
  priority_recalibration: DEFAULT_HEAVY,
  organize_conversation: DEFAULT_HEAVY,
};

const DEFAULTS: schema.AppSettings = {
  id: 'singleton',
  primaryModel: 'gemini-3.1-flash-lite-preview',
  heavyModel: 'claude-opus-4-20250514',
  modelConfig: JSON.stringify(DEFAULT_MODEL_CONFIG),
  disabledModels: '[]',
  autoApproveThreshold: 0.8,
  dupeSimilarityThreshold: 0.65,
  monthlyBudget: null,
  updatedAt: null,
};

export async function getAppSettings(): Promise<schema.AppSettings> {
  const row = await db.query.appSettings.findFirst();
  if (!row) return DEFAULTS;
  return {
    ...DEFAULTS,
    ...row,
    primaryModel: row.primaryModel || DEFAULTS.primaryModel,
    heavyModel: row.heavyModel || DEFAULTS.heavyModel,
    modelConfig: row.modelConfig || DEFAULTS.modelConfig,
    disabledModels: row.disabledModels || DEFAULTS.disabledModels,
    autoApproveThreshold: row.autoApproveThreshold ?? DEFAULTS.autoApproveThreshold,
    dupeSimilarityThreshold: row.dupeSimilarityThreshold ?? DEFAULTS.dupeSimilarityThreshold,
  };
}

export function getModelConfig(settings: schema.AppSettings): ModelConfig {
  if (settings.modelConfig) {
    try {
      return { ...DEFAULT_MODEL_CONFIG, ...JSON.parse(settings.modelConfig) };
    } catch { /* fall through */ }
  }
  return DEFAULT_MODEL_CONFIG;
}

export function getModelForOperation(config: ModelConfig, operation: LLMOperation): ModelAssignment {
  return config[operation] || (HEAVY_OPERATIONS.includes(operation) ? DEFAULT_HEAVY : DEFAULT_PRIMARY);
}

export function getDisabledModels(settings: schema.AppSettings): string[] {
  if (settings.disabledModels) {
    try { return JSON.parse(settings.disabledModels); } catch { /* fall through */ }
  }
  return [];
}

export async function updateAppSettings(data: {
  primaryModel?: string;
  heavyModel?: string;
  modelConfig?: ModelConfig;
  disabledModels?: string[];
  autoApproveThreshold?: number;
  dupeSimilarityThreshold?: number;
  monthlyBudget?: number | null;
}): Promise<schema.AppSettings> {
  const current = await getAppSettings();
  const modelConfigStr = data.modelConfig ? JSON.stringify(data.modelConfig) : current.modelConfig;
  const disabledStr = data.disabledModels ? JSON.stringify(data.disabledModels) : current.disabledModels;
  const merged = {
    ...current,
    ...data,
    modelConfig: modelConfigStr,
    disabledModels: disabledStr,
    updatedAt: new Date().toISOString(),
  };

  await db.insert(schema.appSettings)
    .values(merged)
    .onConflictDoUpdate({
      target: schema.appSettings.id,
      set: {
        primaryModel: merged.primaryModel,
        heavyModel: merged.heavyModel,
        modelConfig: merged.modelConfig,
        disabledModels: merged.disabledModels,
        autoApproveThreshold: merged.autoApproveThreshold,
        dupeSimilarityThreshold: merged.dupeSimilarityThreshold,
        monthlyBudget: merged.monthlyBudget,
        updatedAt: merged.updatedAt,
      },
    });

  return merged;
}
