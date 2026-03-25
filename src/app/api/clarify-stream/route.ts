import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth/session';
import { db, schema } from '@/lib/db/client';
import { geminiStream } from '@/lib/llm/gemini';
import { buildContext } from '@/lib/llm/context';
import { CLARIFY_SYSTEM_PROMPT } from '@/lib/llm/prompts/clarify';
import { trackLLMInteraction } from '@/lib/llm/tracking';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { taskId } = await request.json();
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const context = await buildContext(task.originalText, 'clarify');
  const prompt = `## Knowledge Context\n${context}\n\n## Task to Clarify\n"${task.originalText}"`;

  const startTime = Date.now();
  const stream = await geminiStream({
    system: CLARIFY_SYSTEM_PROMPT + '\n\nRespond with valid JSON only. No markdown fences.',
    prompt,
  });

  let fullText = '';

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream.stream) {
          const text = chunk.text();
          fullText += text;
          controller.enqueue(new TextEncoder().encode(text));
        }

        // Track the LLM interaction after stream completes
        trackLLMInteraction({
          operation: 'clarify_task',
          model: 'gemini-2.5-flash-preview-05-20',
          input: prompt,
          output: fullText,
          startTime,
          endTime: Date.now(),
        });

        // Store result on task
        try {
          const cleaned = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const result = JSON.parse(cleaned);
          await db.update(schema.tasks)
            .set({
              clarifyConfidence: result.confidence,
              clarifyQuestions: result.questions?.length > 0 ? JSON.stringify(result.questions) : null,
              llmNotes: JSON.stringify(result),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.tasks.id, taskId));
        } catch {
          // JSON parse may fail on malformed stream — non-blocking
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
