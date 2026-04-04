import OpenAI from 'openai';
import { trackLLMInteraction } from './tracking';
import { LLMOperation } from './router';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY || '',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://burn-down-engine.vercel.app',
    'X-Title': 'Burn-Down Engine',
  },
});

// OpenRouter uses the standard Chat Completions API
export async function openrouterGenerate(opts: {
  system: string;
  prompt: string;
  model?: string;
  operation?: LLMOperation;
}): Promise<string> {
  const modelName = opts.model || 'openrouter/auto';
  const startTime = Date.now();

  const response = await openrouter.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.prompt },
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const endTime = Date.now();

  if (opts.operation) {
    trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    });
  }

  return text;
}

export async function openrouterGenerateJSON<T>(opts: {
  system: string;
  prompt: string;
  model?: string;
  operation?: LLMOperation;
}): Promise<T> {
  const modelName = opts.model || 'openrouter/auto';
  const startTime = Date.now();

  const response = await openrouter.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: opts.system + '\n\nRespond with valid JSON only. No markdown fences.' },
      { role: 'user', content: opts.prompt },
    ],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content || '{}';
  const endTime = Date.now();

  if (opts.operation) {
    trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    });
  }

  return JSON.parse(text) as T;
}
