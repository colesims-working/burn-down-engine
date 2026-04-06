import { describe, it, expect } from 'vitest';

describe('Usage stats day bucketing', () => {
  function extractDay(timestamp: string | null): string {
    return (timestamp ?? 'unknown').slice(0, 10);
  }

  it('extracts date from SQLite datetime format (space-separated)', () => {
    expect(extractDay('2026-04-05 14:30:22')).toBe('2026-04-05');
  });

  it('extracts date from ISO format (T-separated)', () => {
    expect(extractDay('2026-04-05T14:30:22.000Z')).toBe('2026-04-05');
  });

  it('handles null timestamp', () => {
    expect(extractDay(null)).toBe('unknown');
  });

  it('handles date-only string', () => {
    expect(extractDay('2026-04-05')).toBe('2026-04-05');
  });

  // Regression: the old bug used split('T')[0] which returned the full string for space-separated timestamps
  it('does NOT return full timestamp as a day key', () => {
    const day = extractDay('2026-04-05 14:30:22');
    expect(day).not.toContain(' ');
    expect(day).not.toContain(':');
    expect(day).toHaveLength(10);
  });
});
