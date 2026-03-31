import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Provider } from '@/lib/db/settings';

// ─── Types ───────────────────────────────────────────────────

export interface ModelPricing {
  inputPerMTok: number;   // $ per million input tokens
  outputPerMTok: number;  // $ per million output tokens
}

export interface ModelCapabilities {
  systemMessage: boolean;
  jsonMode: boolean;
  streaming: boolean;
  maxOutputTokens?: number;
}

export interface AvailableModel {
  id: string;
  name: string;
  provider: Provider;
  pricing?: ModelPricing;
  capabilities?: ModelCapabilities;
}

export interface ProviderModels {
  provider: Provider;
  label: string;
  available: boolean;
  models: AvailableModel[];
}

export interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
  response?: string;         // actual model output
  tokensIn?: number;
  tokensOut?: number;
  estimatedCost?: number;    // $ for this single call
}

// ─── Pricing Lookup ──────────────────────────────────────────
// No provider exposes pricing via API. This is maintained manually.
// Match by prefix — longest prefix wins.

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4':   { inputPerMTok: 5,    outputPerMTok: 25 },
  'claude-sonnet-4': { inputPerMTok: 3,    outputPerMTok: 15 },
  'claude-haiku-4':  { inputPerMTok: 1,    outputPerMTok: 5 },
  'claude-haiku-3':  { inputPerMTok: 0.25, outputPerMTok: 1.25 },
  'claude-3-7':      { inputPerMTok: 3,    outputPerMTok: 15 },
  'claude-3-5-sonnet': { inputPerMTok: 3,  outputPerMTok: 15 },
  'claude-3-5-haiku':  { inputPerMTok: 1,  outputPerMTok: 5 },
  // OpenAI
  'gpt-4.1-nano': { inputPerMTok: 0.10,  outputPerMTok: 0.40 },
  'gpt-4.1-mini': { inputPerMTok: 0.40,  outputPerMTok: 1.60 },
  'gpt-4.1':      { inputPerMTok: 2.00,  outputPerMTok: 8.00 },
  'gpt-4o-mini':   { inputPerMTok: 0.15,  outputPerMTok: 0.60 },
  'gpt-4o':        { inputPerMTok: 2.50,  outputPerMTok: 10 },
  'gpt-4-turbo':   { inputPerMTok: 10,    outputPerMTok: 30 },
  'gpt-4':         { inputPerMTok: 30,    outputPerMTok: 60 },
  'gpt-3.5':       { inputPerMTok: 0.50,  outputPerMTok: 1.50 },
  'o1-mini':       { inputPerMTok: 3,     outputPerMTok: 12 },
  'o1':            { inputPerMTok: 15,    outputPerMTok: 60 },
  'o3-mini':       { inputPerMTok: 1.10,  outputPerMTok: 4.40 },
  'o3':            { inputPerMTok: 2,     outputPerMTok: 8 },
  'o4-mini':       { inputPerMTok: 1.10,  outputPerMTok: 4.40 },
  // Gemini (paid tier)
  'gemini-2.5-pro':   { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash': { inputPerMTok: 0.15, outputPerMTok: 0.60 },
  'gemini-2.0-flash': { inputPerMTok: 0.10, outputPerMTok: 0.40 },
  'gemini-1.5-pro':   { inputPerMTok: 1.25, outputPerMTok: 5 },
  'gemini-1.5-flash': { inputPerMTok: 0.075, outputPerMTok: 0.30 },
  // Gemini 3.x (estimates — update when official pricing lands)
  'gemini-3':       { inputPerMTok: 0.15, outputPerMTok: 0.60 },
};

function lookupPricing(modelId: string): ModelPricing | undefined {
  // Find longest matching prefix
  let best: { key: string; pricing: ModelPricing } | undefined;
  for (const [prefix, pricing] of Object.entries(PRICING)) {
    if (modelId.startsWith(prefix) && (!best || prefix.length > best.key.length)) {
      best = { key: prefix, pricing };
    }
  }
  return best?.pricing;
}

function estimateCost(pricing: ModelPricing | undefined, tokensIn: number, tokensOut: number): number | undefined {
  if (!pricing) return undefined;
  return (tokensIn / 1_000_000) * pricing.inputPerMTok + (tokensOut / 1_000_000) * pricing.outputPerMTok;
}

// ─── Capability defaults ─────────────────────────────────────

function defaultCapabilities(provider: Provider, modelId: string): ModelCapabilities {
  if (provider === 'openai') {
    // o-series reasoning models don't support system messages or json_mode the same way
    const isOSeries = /^o[134]/.test(modelId);
    return {
      systemMessage: !isOSeries,
      jsonMode: !isOSeries,
      streaming: true,
    };
  }
  if (provider === 'anthropic') {
    return { systemMessage: true, jsonMode: false, streaming: true };
  }
  // Gemini
  return { systemMessage: true, jsonMode: true, streaming: true };
}

// ─── List Models ─────────────────────────────────────────────

export async function listAvailableModels(): Promise<ProviderModels[]> {
  const results = await Promise.allSettled([
    fetchGeminiModels(),
    fetchAnthropicModels(),
    fetchOpenAIModels(),
  ]);

  return [
    results[0].status === 'fulfilled'
      ? results[0].value
      : { provider: 'gemini' as Provider, label: 'Google Gemini', available: false, models: [] },
    results[1].status === 'fulfilled'
      ? results[1].value
      : { provider: 'anthropic' as Provider, label: 'Anthropic', available: false, models: [] },
    results[2].status === 'fulfilled'
      ? results[2].value
      : { provider: 'openai' as Provider, label: 'OpenAI', available: false, models: [] },
  ];
}

// Models that should be excluded from text generation listing
const GEMINI_EXCLUDE_PATTERNS = [
  'embedding', 'aqa', 'tts', 'audio', 'image', 'video',
  'gemma',         // No system instruction support
  'computer-use',  // Requires Computer Use tool
  'deep-research', // Interactions API only
  'robotics',      // Robotics-specific
  'lyria',         // Music generation
  'veo',           // Video generation
  'imagen',        // Image generation
];

async function fetchGeminiModels(): Promise<ProviderModels> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { provider: 'gemini', label: 'Google Gemini', available: false, models: [] };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) {
    return { provider: 'gemini', label: 'Google Gemini', available: false, models: [] };
  }

  const data = await response.json();
  const models: AvailableModel[] = (data.models || [])
    .filter((m: any) => {
      const name = (m.name || '').toLowerCase();
      return (
        m.supportedGenerationMethods?.includes('generateContent') &&
        !GEMINI_EXCLUDE_PATTERNS.some(p => name.includes(p))
      );
    })
    .map((m: any) => {
      const id = m.name.replace('models/', '');
      return {
        id,
        name: m.displayName || id,
        provider: 'gemini' as Provider,
        pricing: lookupPricing(id),
        capabilities: {
          ...defaultCapabilities('gemini', id),
          maxOutputTokens: m.outputTokenLimit,
        },
      };
    });

  return { provider: 'gemini', label: 'Google Gemini', available: true, models };
}

async function fetchAnthropicModels(): Promise<ProviderModels> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { provider: 'anthropic', label: 'Anthropic', available: false, models: [] };

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const page = await anthropic.models.list({ limit: 100 });
    const models: AvailableModel[] = [];

    for (const m of page.data) {
      models.push({
        id: m.id,
        name: (m as any).display_name || m.id,
        provider: 'anthropic',
        pricing: lookupPricing(m.id),
        capabilities: {
          ...defaultCapabilities('anthropic', m.id),
          maxOutputTokens: (m as any).max_tokens,
        },
      });
    }

    return { provider: 'anthropic', label: 'Anthropic', available: true, models };
  } catch (err: any) {
    console.error('Anthropic models.list failed:', err.message);
    return { provider: 'anthropic', label: 'Anthropic', available: false, models: [] };
  }
}

async function fetchOpenAIModels(): Promise<ProviderModels> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { provider: 'openai', label: 'OpenAI', available: false, models: [] };

  const openai = new OpenAI({ apiKey: key });
  const list = await openai.models.list();

  const chatModels: AvailableModel[] = [];
  for await (const model of list) {
    if (
      (model.id.startsWith('gpt-') || model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) &&
      !model.id.includes('instruct') &&
      !model.id.includes('realtime') &&
      !model.id.includes('audio') &&
      !model.id.includes('search') &&
      !model.id.includes('transcribe') &&
      !model.id.includes('tts')
    ) {
      chatModels.push({
        id: model.id,
        name: model.id,
        provider: 'openai',
        pricing: lookupPricing(model.id),
        capabilities: defaultCapabilities('openai', model.id),
      });
    }
  }

  chatModels.sort((a, b) => a.id.localeCompare(b.id));

  return { provider: 'openai', label: 'OpenAI', available: true, models: chatModels };
}

// ─── Test Model ──────────────────────────────────────────────

const TEST_PROMPT = 'You are a task management assistant. Clarify this task into an actionable next step with a clear title.';
const TEST_INPUT = 'Fix the deployment pipeline thing that broke last week';

export async function testModel(provider: Provider, model: string): Promise<TestResult> {
  const start = Date.now();
  const pricing = lookupPricing(model);

  try {
    switch (provider) {
      case 'gemini': {
        const key = process.env.GEMINI_API_KEY;
        if (!key) return { success: false, latencyMs: 0, error: 'GEMINI_API_KEY not set' };
        const genai = new GoogleGenerativeAI(key);
        const m = genai.getGenerativeModel({ model, systemInstruction: TEST_PROMPT });
        const result = await m.generateContent(TEST_INPUT);
        const text = result.response.text();
        const usage = result.response.usageMetadata;
        const tokensIn = usage?.promptTokenCount ?? 0;
        const tokensOut = usage?.candidatesTokenCount ?? 0;
        return {
          success: text.length > 0,
          latencyMs: Date.now() - start,
          response: text.slice(0, 500),
          tokensIn,
          tokensOut,
          estimatedCost: estimateCost(pricing, tokensIn, tokensOut),
        };
      }

      case 'anthropic': {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return { success: false, latencyMs: 0, error: 'ANTHROPIC_API_KEY not set' };
        const anthropic = new Anthropic({ apiKey: key });
        const message = await anthropic.messages.create({
          model,
          max_tokens: 256,
          system: TEST_PROMPT,
          messages: [{ role: 'user', content: TEST_INPUT }],
        });
        const textBlock = message.content.find(b => b.type === 'text');
        const text = textBlock?.text || '';
        return {
          success: text.length > 0,
          latencyMs: Date.now() - start,
          response: text.slice(0, 500),
          tokensIn: message.usage.input_tokens,
          tokensOut: message.usage.output_tokens,
          estimatedCost: estimateCost(pricing, message.usage.input_tokens, message.usage.output_tokens),
        };
      }

      case 'openai': {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return { success: false, latencyMs: 0, error: 'OPENAI_API_KEY not set' };
        const openai = new OpenAI({ apiKey: key });

        // Responses API — uniform for all models (gpt-4.1, o-series, etc.)
        const response = await openai.responses.create({
          model,
          instructions: TEST_PROMPT,
          input: TEST_INPUT,
          max_output_tokens: 256,
        });

        const text = response.output_text || '';
        const tokensIn = response.usage?.input_tokens ?? 0;
        const tokensOut = response.usage?.output_tokens ?? 0;
        return {
          success: text.length > 0,
          latencyMs: Date.now() - start,
          response: text.slice(0, 500),
          tokensIn,
          tokensOut,
          estimatedCost: estimateCost(pricing, tokensIn, tokensOut),
        };
      }

      default:
        return { success: false, latencyMs: 0, error: `Unknown provider: ${provider}` };
    }
  } catch (err: any) {
    return { success: false, latencyMs: Date.now() - start, error: err.message || 'Unknown error' };
  }
}
