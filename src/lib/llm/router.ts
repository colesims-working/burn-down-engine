import { geminiGenerate, geminiGenerateJSON, geminiStream } from './gemini';
import { claudeGenerate, claudeGenerateJSON } from './claude';
import { openaiGenerate, openaiGenerateJSON } from './openai-chat';
import { openrouterGenerate, openrouterGenerateJSON } from './openrouter';
import { getAppSettings, getModelConfig, getModelForOperation } from '@/lib/db/settings';
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
  return getModelForOperation(config, operation);
}

/** Inject current date/time into system prompt so LLMs can handle relative dates */
function withDateContext(system: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${system}\n\n## Current Date & Time\nToday is ${dateStr}, ${timeStr}. Use this for interpreting relative dates like "tomorrow", "next week", "in 4 days", etc.`;
}

export function getModel(operation: LLMOperation): 'gemini-flash' | 'claude-opus' {
  // Legacy sync helper — still used by some callers for quick checks
  const OPUS_OPERATIONS: LLMOperation[] = [
    'project_audit', 'weekly_review', 'complex_decomposition',
    'priority_recalibration', 'organize_conversation',
  ];
  return OPUS_OPERATIONS.includes(operation) ? 'claude-opus' : 'gemini-flash';
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
  const assignment = await resolveModel(opts.operation);
  let system = withDateContext(opts.system);

  // Inline knowledge extraction: append extraction block to qualifying calls
  const inputTokenEstimate = Math.ceil(opts.prompt.length / 4);
  const shouldExtract = isExtractionEligible(opts.operation, inputTokenEstimate);
  if (shouldExtract) {
    try {
      const extractionBlock = await buildExtractionPromptBlock();
      system += extractionBlock;
    } catch {}
  }

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
