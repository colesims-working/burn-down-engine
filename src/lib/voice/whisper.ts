import OpenAI from 'openai';
import { geminiGenerateJSON } from '@/lib/llm/gemini';
import { LLMOperation } from '@/lib/llm/router';
import { VOICE_EXTRACTION_PROMPT } from '@/lib/llm/prompts/clarify';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

interface ExtractedVoiceTask {
  text: string;
  confidence: number;
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  // Convert buffer to File object for OpenAI API
  const file = new File([audioBuffer], 'recording.webm', { type: mimeType });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'en',
  });

  return transcription.text;
}

export async function extractTasksFromTranscript(transcript: string): Promise<ExtractedVoiceTask[]> {
  const tasks = await geminiGenerateJSON<ExtractedVoiceTask[]>({
    system: VOICE_EXTRACTION_PROMPT,
    prompt: transcript,
    operation: 'extract_tasks_from_voice',
  });

  return Array.isArray(tasks) ? tasks : [];
}

export async function processVoiceDump(audioBuffer: Buffer, mimeType: string): Promise<{
  transcript: string;
  tasks: ExtractedVoiceTask[];
}> {
  const transcript = await transcribeAudio(audioBuffer, mimeType);
  const tasks = await extractTasksFromTranscript(transcript);
  return { transcript, tasks };
}
