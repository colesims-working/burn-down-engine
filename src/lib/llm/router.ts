import { geminiGenerate, geminiGenerateJSON, geminiStream } from './gemini';
import { claudeGenerate, claudeGenerateJSON } from './claude';
import { openaiGenerate, openaiGenerateJSON } from './openai-chat';
import { getAppSettings, getModelConfig, getModelForOperation } from '@/lib/db/settings';
import type { ModelAssignment } from '@/lib/db/settings';

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

  switch (assignment.provider) {
    case 'anthropic':
      return claudeGenerate({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'openai':
      return openaiGenerate({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'gemini':
    default:
      return geminiGenerate({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
  }
}

export async function llmGenerateJSON<T>(opts: {
  operation: LLMOperation;
  system: string;
  prompt: string;
}): Promise<T> {
  const assignment = await resolveModel(opts.operation);

  switch (assignment.provider) {
    case 'anthropic':
      return claudeGenerateJSON<T>({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'openai':
      return openaiGenerateJSON<T>({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
    case 'gemini':
    default:
      return geminiGenerateJSON<T>({ system: opts.system, prompt: opts.prompt, operation: opts.operation, model: assignment.model });
  }
}
