import Anthropic from '@anthropic-ai/sdk';
import { trackLLMInteraction } from './tracking';
import { LLMOperation } from './router';
import { getAppSettings } from '@/lib/db/settings';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function claudeGenerate(opts: {
  system: string;
  prompt: string;
  operation?: LLMOperation;
  model?: string;
}): Promise<string> {
  const modelName = opts.model || (await getAppSettings()).heavyModel!;
  const startTime = Date.now();
  const message = await anthropic.messages.create({
    model: modelName,
    max_tokens: 4096,
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
  });
  const endTime = Date.now();

  const textBlock = message.content.find(b => b.type === 'text');
  const text = textBlock?.text || '';

  if (opts.operation) {
    trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: {
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      },
    });
  }

  return text;
}

export async function claudeGenerateJSON<T>(opts: {
  system: string;
  prompt: string;
  operation?: LLMOperation;
  model?: string;
}): Promise<T> {
  const raw = await claudeGenerate({
    system: opts.system + '\n\nRespond with valid JSON only. No markdown fences.',
    prompt: opts.prompt,
    operation: opts.operation,
    model: opts.model,
  });

  // Strip any markdown fences if present
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as T;
}
