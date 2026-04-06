import OpenAI from 'openai';
import { trackLLMInteraction } from './tracking';
import { LLMOperation } from './router';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

// Uses the Responses API — cleaner than Chat Completions, uniform across all models
// (including o-series), and avoids the max_tokens vs max_completion_tokens split.

export async function openaiGenerate(opts: {
  system: string;
  prompt: string;
  model?: string;
  operation?: LLMOperation;
}): Promise<string> {
  const modelName = opts.model || 'gpt-4o-mini';
  const startTime = Date.now();

  const response = await openai.responses.create({
    model: modelName,
    instructions: opts.system,
    input: opts.prompt,
  });

  const text = response.output_text || '';
  const endTime = Date.now();

  if (opts.operation) {
    void trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    });
  }

  return text;
}

export async function openaiGenerateJSON<T>(opts: {
  system: string;
  prompt: string;
  model?: string;
  operation?: LLMOperation;
}): Promise<T> {
  const modelName = opts.model || 'gpt-4o-mini';
  const startTime = Date.now();

  const response = await openai.responses.create({
    model: modelName,
    instructions: opts.system + '\n\nRespond with valid JSON only.',
    input: opts.prompt,
    text: { format: { type: 'json_object' } },
  });

  const text = response.output_text || '{}';
  const endTime = Date.now();

  if (opts.operation) {
    void trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    });
  }

  return JSON.parse(text) as T;
}
