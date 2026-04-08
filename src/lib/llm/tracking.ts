import { db, schema } from '@/lib/db/client';
import { LLMOperation } from './router';
import { lookupPricing, estimateCost } from './providers';
import { langfuse } from '@/lib/langfuse';

export async function trackLLMInteraction(data: {
  operation: LLMOperation;
  model: string;
  input: string;
  output: string;
  startTime: number;
  endTime: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}) {
  try {
    const latencyMs = data.endTime - data.startTime;

    // Cost estimation using the full pricing table from providers.ts
    const inTokens = data.usage?.promptTokens || (data.input.length / 4);
    const outTokens = data.usage?.completionTokens || (data.output.length / 4);
    const pricing = lookupPricing(data.model);
    const cost = pricing ? estimateCost(pricing, Math.ceil(inTokens), Math.ceil(outTokens)) : 0;

    await db.insert(schema.llmInteractions).values({
      page: data.operation.split('_')[0] || 'core', // logical guess at page
      model: data.model,
      purpose: data.operation,
      inputSummary: data.input.slice(0, 500), // truncate for storage
      outputSummary: data.output.slice(0, 500),
      tokensIn: Math.ceil(inTokens),
      tokensOut: Math.ceil(outTokens),
      latencyMs,
      costEstimate: cost,
    });

    // Send to Langfuse if configured
    if (langfuse) {
      const trace = langfuse.trace({
        name: data.operation,
        input: { prompt: data.input.slice(0, 10000) },
        output: { completion: data.output.slice(0, 10000) },
        metadata: { page: data.operation.split('_')[0] || 'core', model: data.model },
      });
      trace.generation({
        name: data.operation,
        model: data.model,
        input: { prompt: data.input.slice(0, 10000) },
        output: { completion: data.output.slice(0, 10000) },
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        usage: {
          promptTokens: Math.ceil(inTokens),
          completionTokens: Math.ceil(outTokens),
          totalTokens: Math.ceil(inTokens + outTokens),
        },
        metadata: {
          costUsd: cost,
          latencyMs,
        },
      });
      // Best-effort flush — don't block user-facing operations
      void langfuse.flushAsync().catch(() => {});
    }
  } catch (error) {
    // Non-blocking error logging
    console.error('Failed to log LLM interaction:', error);
  }
}
