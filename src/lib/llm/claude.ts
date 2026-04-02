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
    max_tokens: 8192,
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
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt to repair truncated JSON by closing open structures
    let repaired = cleaned;
    // Close any unterminated string
    const quotes = (repaired.match(/"/g) || []).length;
    if (quotes % 2 !== 0) repaired += '"';
    // Close open arrays and objects
    const opens = (repaired.match(/[\[{]/g) || []).length;
    const closes = (repaired.match(/[\]}]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      // Walk backwards to find the last opener and match it
      const lastOpen = Math.max(repaired.lastIndexOf('['), repaired.lastIndexOf('{'));
      const lastClose = Math.max(repaired.lastIndexOf(']'), repaired.lastIndexOf('}'));
      if (lastOpen > lastClose) {
        repaired += repaired[lastOpen] === '[' ? ']' : '}';
      } else {
        repaired += '}';
      }
    }
    return JSON.parse(repaired) as T;
  }
}
