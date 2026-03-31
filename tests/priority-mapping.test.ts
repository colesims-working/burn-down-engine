import { describe, it, expect } from 'vitest';
import { mapFromTodoistPriority, mapToTodoistPriority } from '@/lib/todoist/sync';

describe('Priority Mapping', () => {
  describe('mapFromTodoistPriority', () => {
    it('maps Todoist p4 (urgent) → our P1', () => {
      expect(mapFromTodoistPriority(4)).toBe(1);
    });

    it('maps Todoist p3 (high) → our P2', () => {
      expect(mapFromTodoistPriority(3)).toBe(2);
    });

    it('maps Todoist p2 (medium) → our P3', () => {
      expect(mapFromTodoistPriority(2)).toBe(3);
    });

    it('maps Todoist p1 (none) → our P4', () => {
      expect(mapFromTodoistPriority(1)).toBe(4);
    });

    it('defaults unknown values to P4', () => {
      expect(mapFromTodoistPriority(99)).toBe(4);
      expect(mapFromTodoistPriority(0)).toBe(4);
    });
  });

  describe('mapToTodoistPriority', () => {
    it('maps our P1 → Todoist p4 (urgent)', () => {
      expect(mapToTodoistPriority(1)).toBe(4);
    });

    it('maps our P2 → Todoist p3 (high)', () => {
      expect(mapToTodoistPriority(2)).toBe(3);
    });

    it('maps our P3 → Todoist p2 (medium)', () => {
      expect(mapToTodoistPriority(3)).toBe(2);
    });

    it('maps our P4 → Todoist p1 (none)', () => {
      expect(mapToTodoistPriority(4)).toBe(1);
    });

    it('maps P0 → Todoist p4 (urgent)', () => {
      expect(mapToTodoistPriority(0)).toBe(4);
    });

    it('defaults unknown values to p1 (none)', () => {
      expect(mapToTodoistPriority(99)).toBe(1);
    });
  });

  describe('round-trip consistency', () => {
    it('preserves priority through Todoist → local → Todoist', () => {
      for (const todoistP of [1, 2, 3, 4]) {
        const local = mapFromTodoistPriority(todoistP);
        const back = mapToTodoistPriority(local);
        expect(back).toBe(todoistP);
      }
    });
  });
});
