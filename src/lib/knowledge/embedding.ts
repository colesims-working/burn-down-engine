/**
 * Knowledge System — Embedding Generation
 *
 * Uses Qwen3-Embedding-8B via OpenRouter. Instruction-aware:
 * - Storage: bare text (no prefix)
 * - Queries: task-specific instruction prefix
 *
 * All calls are traced to Langfuse for observability.
 */

import { langfuse } from '@/lib/langfuse';
import { KNOWLEDGE_CONFIG } from './config';
import { EMBEDDING_INSTRUCTIONS } from './config';

// OpenRouter embedding pricing (per million tokens)
const EMBEDDING_COST_PER_MTOK = 0.018; // Qwen3-Embedding-8B

export interface EmbeddingOptions {
  /** If true, prepend a task instruction for query-side embedding */
  isQuery?: boolean;
  /** Instruction to use for query-side embedding */
  taskInstruction?: string;
  /** Source context for Langfuse logging */
  sourceContext?: string;
}

/**
 * Generate an embedding vector for the given text.
 *
 * For storage: call with just text (no options or isQuery: false).
 * For queries: call with isQuery: true and a taskInstruction.
 */
export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions,
): Promise<number[]> {
  let input = text;
  if (options?.isQuery && options?.taskInstruction) {
    input = `Instruct: ${options.taskInstruction}\nQuery: ${text}`;
  }

  const startTime = Date.now();
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: KNOWLEDGE_CONFIG.EMBEDDING_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Embedding API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const endTime = Date.now();
  const embedding: number[] = data.data[0].embedding;

  // Langfuse tracing (best-effort, never blocks)
  trackEmbeddingCall({
    inputText: input,
    dimensions: embedding.length,
    startTime,
    endTime,
    sourceContext: options?.sourceContext,
    isQuery: options?.isQuery ?? false,
    usage: data.usage,
  }).catch(() => {});

  return embedding;
}

/**
 * Build the text to embed for a knowledge object (storage-side, no instruction prefix).
 * Format: "{type}: {name} — {value or contextNotes or goal}"
 */
export function buildEmbeddingText(obj: {
  type: string;
  name: string;
  properties: Record<string, unknown>;
}): string {
  const detail =
    (obj.properties.value as string) ||
    (obj.properties.contextNotes as string) ||
    (obj.properties.goal as string) ||
    (obj.properties.notes as string) ||
    (obj.properties.role as string) ||
    '';

  if (detail) {
    return `${obj.type}: ${obj.name} — ${detail}`;
  }
  return `${obj.type}: ${obj.name}`;
}

/**
 * Generate a query embedding with the appropriate instruction prefix.
 */
export async function generateQueryEmbedding(
  text: string,
  purpose: keyof typeof EMBEDDING_INSTRUCTIONS = 'retrieval',
  sourceContext?: string,
): Promise<number[]> {
  return generateEmbedding(text, {
    isQuery: true,
    taskInstruction: EMBEDDING_INSTRUCTIONS[purpose],
    sourceContext,
  });
}

// ─── Langfuse Tracking ──────────────────────────────────────

async function trackEmbeddingCall(data: {
  inputText: string;
  dimensions: number;
  startTime: number;
  endTime: number;
  sourceContext?: string;
  isQuery: boolean;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}) {
  if (!langfuse) return;

  try {
    const latencyMs = data.endTime - data.startTime;
    const tokens = data.usage?.prompt_tokens || Math.ceil(data.inputText.length / 4);
    const cost = (tokens / 1_000_000) * EMBEDDING_COST_PER_MTOK;

    const trace = langfuse.trace({
      name: 'knowledge_embedding',
      input: { text: data.inputText.slice(0, 2000) },
      metadata: {
        type: 'embedding',
        model: KNOWLEDGE_CONFIG.EMBEDDING_MODEL,
        dimensions: data.dimensions,
        isQuery: data.isQuery,
        sourceContext: data.sourceContext || 'unknown',
      },
    });

    trace.generation({
      name: 'knowledge_embedding',
      model: KNOWLEDGE_CONFIG.EMBEDDING_MODEL,
      input: { text: data.inputText.slice(0, 2000) },
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      usage: {
        promptTokens: tokens,
        completionTokens: 0,
        totalTokens: tokens,
      },
      metadata: {
        type: 'embedding',
        costUsd: cost,
        latencyMs,
        dimensions: data.dimensions,
        isQuery: data.isQuery,
        sourceContext: data.sourceContext || 'unknown',
      },
    });

    void langfuse.flushAsync().catch(() => {});
  } catch (error) {
    console.error('Failed to log embedding to Langfuse:', error);
  }
}
