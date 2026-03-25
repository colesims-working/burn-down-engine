import { geminiGenerate, geminiGenerateJSON, geminiStream } from './gemini';
import { claudeGenerate, claudeGenerateJSON } from './claude';

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

const OPUS_OPERATIONS: LLMOperation[] = [
  'project_audit',
  'weekly_review',
  'complex_decomposition',
  'priority_recalibration',
  'organize_conversation',
];

export function getModel(operation: LLMOperation): 'gemini-flash' | 'claude-opus' {
  return OPUS_OPERATIONS.includes(operation) ? 'claude-opus' : 'gemini-flash';
}

export async function llmGenerate(opts: {
  operation: LLMOperation;
  system: string;
  prompt: string;
}): Promise<string> {
  const model = getModel(opts.operation);
  if (model === 'claude-opus') {
    return claudeGenerate({ system: opts.system, prompt: opts.prompt, operation: opts.operation });
  }
  return geminiGenerate({ system: opts.system, prompt: opts.prompt, operation: opts.operation });
}

export async function llmGenerateJSON<T>(opts: {
  operation: LLMOperation;
  system: string;
  prompt: string;
}): Promise<T> {
  const model = getModel(opts.operation);
  if (model === 'claude-opus') {
    return claudeGenerateJSON<T>({ system: opts.system, prompt: opts.prompt, operation: opts.operation });
  }
  return geminiGenerateJSON<T>({ system: opts.system, prompt: opts.prompt, operation: opts.operation });
}
