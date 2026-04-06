import { geminiGenerate, geminiGenerateJSON } from './gemini';
import { claudeGenerate, claudeGenerateJSON } from './claude';
import { openaiGenerate, openaiGenerateJSON } from './openai-chat';
import { openrouterGenerate, openrouterGenerateJSON } from './openrouter';
import { getAppSettings, getModelConfig, getModelForOperation, getDisabledModels } from '@/lib/db/settings';
import type { ModelAssignment } from '@/lib/db/settings';
import { isExtractionEligible, buildExtractionPromptBlock, processExtractedKnowledge } from '@/lib/knowledge/extraction';

export type LLMOperation =
  | 'clarify_task'
  | 'extract_tasks_from_voice'
  | 'extract_knowledge'
  | 'file_suggestions'
  | 'rank_tasks'
  | 'fire_triage'
  | 'daily_observations'
  | 'project_audit'
  | 'weekly_review'
  | 'complex_decomposition'
  | 'priority_recalibration'
  | 'organize_conversation';

async function resolveModel(operation: LLMOperation): Promise<ModelAssignment> {
  const settings = await getAppSettings();
  const config = getModelConfig(settings);
  const assignment = getModelForOperation(config, operation);

  // Issue 20: Enforce disabled models — fall back to default if assigned model is disabled
  const disabled = getDisabledModels(settings);
  const assignedKey = `${assignment.provider}:${assignment.model}`;
  if (disabled.includes(assignedKey)) {
    console.warn(`Model ${assignedKey} is disabled, falling back to default for ${operation}`);
    const defaults = getModelConfig({ ...settings, modelConfig: null });
    return getModelForOperation(defaults, operation);
  }

  // Issue 19: Enforce monthly budget — reject if exceeded
  if (settings.monthlyBudget != null && settings.monthlyBudget > 0) {
    try {
      const { db, schema } = await import('@/lib/db/client');
      const { sql } = await import('drizzle-orm');
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const spent = await db.select({ total: sql<number>`COALESCE(SUM(cost_estimate), 0)` })
        .from(schema.llmInteractions)
        .where(sql`${schema.llmInteractions.timestamp} >= ${monthStart}`);
      if ((spent[0]?.total ?? 0) >= settings.monthlyBudget) {
        throw new Error(`Monthly LLM budget of $${settings.monthlyBudget} exceeded`);
      }
    } catch (e) {
      if ((e as Error).message.includes('budget')) throw e;
      // DB error — don't block the call
    }
  }

  return assignment;
}

/** Inject current date/time into system prompt so LLMs can handle relative dates */
function withDateContext(system: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${system}\n\n## Current Date & Time\nToday is ${dateStr}, ${timeStr}. Use this for interpreting relative dates like "tomorrow", "next week", "in 4 days", etc.`;
}


export async function llmGenerate(opts: {
  operation: LLMOperation;
  system: string;
  prompt: string;
}): Promise<string> {
  const assignment = await resolveModel(opts.operation);
  const system = withDateContext(opts.system);

  switch (assignment.provider) {
    case 'anthropic':
      return claudeGenerate({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'openai':
      return openaiGenerate({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'openrouter':
      return openrouterGenerate({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'gemini':
    default:
      return geminiGenerate({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
  }
}

export async function llmGenerateJSON<T>(opts: {
  operation: LLMOperation;
  system: string;
  prompt: string;
  /** Caller-provided context for extraction provenance */
  taskId?: string;
}): Promise<T> {
  // Parallelize: model resolution + extraction block build are independent
  const inputTokenEstimate = Math.ceil(opts.prompt.length / 4);
  const shouldExtract = isExtractionEligible(opts.operation, inputTokenEstimate);

  const [assignment, extractionBlock] = await Promise.all([
    resolveModel(opts.operation),
    shouldExtract ? buildExtractionPromptBlock().catch(() => '') : Promise.resolve(''),
  ]);

  let system = withDateContext(opts.system);
  if (extractionBlock) system += extractionBlock;

  let result: T;
  const interactionId = crypto.randomUUID();

  switch (assignment.provider) {
    case 'anthropic':
      result = await claudeGenerateJSON<T>({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
      break;
    case 'openai':
      result = await openaiGenerateJSON<T>({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
      break;
    case 'openrouter':
      result = await openrouterGenerateJSON<T>({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
      break;
    case 'gemini':
    default:
      result = await geminiGenerateJSON<T>({ system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
      break;
  }

  // Async extraction processing — never blocks the primary response
  if (shouldExtract && result && typeof result === 'object') {
    const extracted = (result as any).extracted_knowledge;
    if (extracted) {
      const sourceContext = opts.operation.split('_')[0] || 'core';
      void processExtractedKnowledge(extracted, sourceContext, interactionId, opts.taskId).catch(() => {});
      // Remove from primary response to keep it clean
      delete (result as any).extracted_knowledge;
    }
  }

  return result;
}
