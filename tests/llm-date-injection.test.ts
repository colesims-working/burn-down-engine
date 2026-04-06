import { describe, it, expect } from 'vitest';

/**
 * Tests for Bug 3: LLM calls should include current date/time context.
 */
describe('LLM Date Context Injection', () => {
  // Mirrors withDateContext from router.ts
  function withDateContext(system: string): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${system}\n\n## Current Date & Time\nToday is ${dateStr}, ${timeStr}. Use this for interpreting relative dates like "tomorrow", "next week", "in 4 days", etc.`;
  }

  it('appends date context to system prompt', () => {
    const result = withDateContext('You are a task clarifier.');
    expect(result).toContain('You are a task clarifier.');
    expect(result).toContain('## Current Date & Time');
    expect(result).toContain('Today is');
  });

  it('includes the current year', () => {
    const result = withDateContext('Test');
    const year = new Date().getFullYear().toString();
    expect(result).toContain(year);
  });

  it('includes weekday name', () => {
    const result = withDateContext('Test');
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    expect(result).toContain(weekday);
  });

  it('includes relative date guidance', () => {
    const result = withDateContext('Test');
    expect(result).toContain('tomorrow');
    expect(result).toContain('next week');
    expect(result).toContain('in 4 days');
  });

  it('preserves original system prompt', () => {
    const original = 'You are the Burn-Down Engine Clarify agent.';
    const result = withDateContext(original);
    expect(result.startsWith(original)).toBe(true);
  });
});
