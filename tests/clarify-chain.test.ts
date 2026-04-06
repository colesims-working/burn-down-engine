import { describe, it, expect } from 'vitest';

/**
 * Tests for Bug 4: Re-instructions should chain, including previous clarification context.
 */
describe('Clarify Re-instruction Chaining', () => {
  // Mirrors the prompt-building logic in clarifyTask
  function buildClarifyPrompt(opts: {
    originalText: string;
    llmNotes: string | null;
    additionalInstructions?: string;
    context: string;
  }): string {
    const instructionSuffix = opts.additionalInstructions
      ? `\n\n## Additional User Instructions\n${opts.additionalInstructions}`
      : '';

    let previousClarification = '';
    if (opts.llmNotes && opts.additionalInstructions) {
      try {
        const prev = JSON.parse(opts.llmNotes);
        previousClarification = `\n\n## Previous Clarification Result\nIMPORTANT: Start from this result. Only change the specific fields the user asked to change. Keep ALL other fields exactly as they are — do not rewrite title, nextAction, priority, labels, timeEstimate, energyLevel, contextNotes, or any other field unless the user's instruction specifically targets it.\n\n${JSON.stringify(prev, null, 2)}`;
      } catch {}
    }

    return `## Knowledge Context\n${opts.context}\n\n## Task to Clarify\n"${opts.originalText}"${previousClarification}${instructionSuffix}`;
  }

  it('includes previous clarification when re-instructing', () => {
    const prevResult = { title: 'Fixed Title', priority: 2, dueDate: '2026-04-10' };
    const prompt = buildClarifyPrompt({
      originalText: 'fix the thing',
      llmNotes: JSON.stringify(prevResult),
      additionalInstructions: 'change the date to next week',
      context: 'test context',
    });
    expect(prompt).toContain('Previous Clarification Result');
    expect(prompt).toContain('Fixed Title');
    expect(prompt).toContain('2026-04-10');
    expect(prompt).toContain('change the date to next week');
  });

  it('instructs LLM to only change targeted fields, not rewrite everything', () => {
    const prevResult = { title: 'Fixed Title', priority: 2, projectName: 'OldProject' };
    const prompt = buildClarifyPrompt({
      originalText: 'fix the thing',
      llmNotes: JSON.stringify(prevResult),
      additionalInstructions: 'change the project to NewProject',
      context: 'test',
    });
    expect(prompt).toContain('Only change the specific fields the user asked to change');
    expect(prompt).toContain('Keep ALL other fields exactly as they are');
  });

  it('does NOT include previous clarification on first clarify (no instructions)', () => {
    const prompt = buildClarifyPrompt({
      originalText: 'fix the thing',
      llmNotes: JSON.stringify({ title: 'Old' }),
      context: 'test context',
    });
    expect(prompt).not.toContain('Previous Clarification Result');
  });

  it('does NOT include previous clarification when llmNotes is null', () => {
    const prompt = buildClarifyPrompt({
      originalText: 'fix the thing',
      llmNotes: null,
      additionalInstructions: 'put it in project X',
      context: 'test context',
    });
    expect(prompt).not.toContain('Previous Clarification Result');
    expect(prompt).toContain('put it in project X');
  });

  it('handles malformed llmNotes gracefully', () => {
    const prompt = buildClarifyPrompt({
      originalText: 'fix the thing',
      llmNotes: 'not valid json {{{',
      additionalInstructions: 'change priority',
      context: 'test context',
    });
    // Should not crash, just skip the previous context
    expect(prompt).not.toContain('Previous Clarification Result');
    expect(prompt).toContain('change priority');
  });
});
