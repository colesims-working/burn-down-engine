import { GoogleGenerativeAI, GenerateContentStreamResult } from '@google/generative-ai';
import { trackLLMInteraction } from './tracking';
import { LLMOperation } from './router';

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function geminiGenerate(opts: {
  system: string;
  prompt: string;
  json?: boolean;
  operation?: LLMOperation;
}): Promise<string> {
  const modelName = 'gemini-2.5-flash-preview-05-20';
  const startTime = Date.now();
  const model = genai.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.system,
    generationConfig: opts.json
      ? { responseMimeType: 'application/json' }
      : undefined,
  });

  const result = await model.generateContent(opts.prompt);
  const text = result.response.text();
  const endTime = Date.now();

  if (opts.operation) {
    trackLLMInteraction({
      operation: opts.operation,
      model: modelName,
      input: opts.prompt,
      output: text,
      startTime,
      endTime,
      usage: result.response.usageMetadata ? {
        promptTokens: result.response.usageMetadata.promptTokenCount,
        completionTokens: result.response.usageMetadata.candidatesTokenCount,
        totalTokens: result.response.usageMetadata.totalTokenCount,
      } : undefined,
    });
  }

  return text;
}

export async function geminiStream(opts: {
  system: string;
  prompt: string;
}): Promise<GenerateContentStreamResult> {
  const model = genai.getGenerativeModel({
    model: 'gemini-2.5-flash-preview-05-20',
    systemInstruction: opts.system,
  });

  return model.generateContentStream(opts.prompt);
}

export async function geminiEmbed(text: string): Promise<Float32Array> {
  const model = genai.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return new Float32Array(result.embedding.values);
}

export async function geminiGenerateJSON<T>(opts: {
  system: string;
  prompt: string;
  operation?: LLMOperation;
}): Promise<T> {
  const raw = await geminiGenerate({ ...opts, json: true });
  return JSON.parse(raw) as T;
}
