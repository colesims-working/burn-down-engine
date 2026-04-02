import { db, schema } from '@/lib/db/client';
import { LLMOperation } from './router';
import { Langfuse } from 'langfuse';

// Langfuse client — only active when credentials are configured
const langfuse = process.env.LANGFUSE_SECRET_KEY
  ? new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
    })
  : null;

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

    // Simple cost estimation (USD)
    // Prices as of Feb 2026 (hypothetical/based on current trends)
    // Gemini Flash: $0.10 / 1M input, $0.30 / 1M output
    // Claude Opus: $15.00 / 1M input, $75.00 / 1M output
    let cost = 0;
    const inTokens = data.usage?.promptTokens || (data.input.length / 4);
    const outTokens = data.usage?.completionTokens || (data.output.length / 4);

    if (data.model.includes('gemini') || data.model.includes('flash')) {
      cost = (inTokens / 1_000_000) * 0.10 + (outTokens / 1_000_000) * 0.30;
    } else if (data.model.includes('claude') || data.model.includes('opus')) {
      cost = (inTokens / 1_000_000) * 15.00 + (outTokens / 1_000_000) * 75.00;
    }

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
    }
  } catch (error) {
    // Non-blocking error logging
    console.error('Failed to log LLM interaction:', error);
  }
}
