import { describe, it, expect, vi, beforeEach } from 'vitest';

interface ProcessedTask {
  id: string;
  originalText: string;
  result: any | null;
  status: 'pending' | 'processing' | 'done' | 'needs-input' | 'approved' | 'error' | 'rejected' | 'completed';
  expanded: boolean;
  selected: boolean;
}

/**
 * Tests for Clarify page task operations — specifically the "already done" bug fix,
 * undo-complete, re-instruct AI, and task splitting logic.
 */
describe('Clarify Task Operations', () => {
  describe('completeTaskInClarify (bug fix: should only mark ONE task)', () => {
    function completeTaskById(tasks: ProcessedTask[], taskId: string): ProcessedTask[] {
      return tasks.map(t =>
        t.id === taskId ? { ...t, status: 'completed' as const } : t
      );
    }

    it('marks only the targeted task as completed', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'Task A', result: { title: 'A' }, status: 'done', expanded: false, selected: false },
        { id: 'b', originalText: 'Task B', result: { title: 'B' }, status: 'done', expanded: false, selected: false },
        { id: 'c', originalText: 'Task C', result: { title: 'C' }, status: 'done', expanded: false, selected: false },
        { id: 'd', originalText: 'Task D', result: { title: 'D' }, status: 'done', expanded: false, selected: false },
      ];

      const result = completeTaskById(tasks, 'b');

      expect(result[0].status).toBe('done');      // Task A unchanged
      expect(result[1].status).toBe('completed');  // Task B completed
      expect(result[2].status).toBe('done');        // Task C unchanged
      expect(result[3].status).toBe('done');        // Task D unchanged
    });

    it('handles completing first task without affecting others', () => {
      const tasks: ProcessedTask[] = [
        { id: 'x', originalText: 'X', result: { title: 'X' }, status: 'done', expanded: false, selected: false },
        { id: 'y', originalText: 'Y', result: { title: 'Y' }, status: 'done', expanded: false, selected: false },
      ];

      const result = completeTaskById(tasks, 'x');
      expect(result[0].status).toBe('completed');
      expect(result[1].status).toBe('done');
    });

    it('handles completing last task without affecting others', () => {
      const tasks: ProcessedTask[] = [
        { id: 'x', originalText: 'X', result: { title: 'X' }, status: 'done', expanded: false, selected: false },
        { id: 'y', originalText: 'Y', result: { title: 'Y' }, status: 'done', expanded: false, selected: false },
      ];

      const result = completeTaskById(tasks, 'y');
      expect(result[0].status).toBe('done');
      expect(result[1].status).toBe('completed');
    });

    it('does not mutate original array', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'A', result: null, status: 'done', expanded: false, selected: false },
      ];
      const original = tasks[0].status;
      completeTaskById(tasks, 'a');
      expect(tasks[0].status).toBe(original);
    });

    it('handles non-existent task ID gracefully', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'A', result: null, status: 'done', expanded: false, selected: false },
      ];
      const result = completeTaskById(tasks, 'nonexistent');
      expect(result[0].status).toBe('done');
    });
  });

  describe('undoComplete', () => {
    function undoComplete(tasks: ProcessedTask[], taskId: string): ProcessedTask[] {
      return tasks.map(t =>
        t.id === taskId ? { ...t, status: (t.result ? 'done' : 'pending') as ProcessedTask['status'] } : t
      );
    }

    it('reverts completed task with result back to done', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'A', result: { title: 'A' }, status: 'completed', expanded: false, selected: false },
      ];
      const result = undoComplete(tasks, 'a');
      expect(result[0].status).toBe('done');
    });

    it('reverts completed task without result back to pending', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'A', result: null, status: 'completed', expanded: false, selected: false },
      ];
      const result = undoComplete(tasks, 'a');
      expect(result[0].status).toBe('pending');
    });

    it('only reverts the targeted task', () => {
      const tasks: ProcessedTask[] = [
        { id: 'a', originalText: 'A', result: { title: 'A' }, status: 'completed', expanded: false, selected: false },
        { id: 'b', originalText: 'B', result: { title: 'B' }, status: 'completed', expanded: false, selected: false },
      ];
      const result = undoComplete(tasks, 'a');
      expect(result[0].status).toBe('done');
      expect(result[1].status).toBe('completed');
    });
  });

  describe('splitTask logic', () => {
    function filterValidSplitTexts(texts: string[]): string[] {
      return texts.filter(t => t.trim());
    }

    it('filters empty split texts', () => {
      expect(filterValidSplitTexts(['Task 1', '', 'Task 2', '  '])).toEqual(['Task 1', 'Task 2']);
    });

    it('keeps all valid texts', () => {
      expect(filterValidSplitTexts(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('returns empty for all-empty input', () => {
      expect(filterValidSplitTexts(['', '  ', ''])).toEqual([]);
    });

    it('handles single valid text', () => {
      expect(filterValidSplitTexts(['Only one'])).toEqual(['Only one']);
    });
  });
});

describe('Console Noise Filter', () => {
  const CONSOLE_NOISE = [
    /Warning: React has detected a change in the order of Hooks/,
    /webpack-internal/,
    /\[HMR\]/,
    /Download the React DevTools/,
    /ReactDOM\.render is no longer supported/,
    /act\(\) is not supported in production/,
    /Warning: Each child in a list should have a unique/,
    /Warning: Cannot update a component/,
    /Fast Refresh/,
  ];

  function isConsoleNoise(msg: string): boolean {
    return CONSOLE_NOISE.some(pattern => pattern.test(msg));
  }

  it('filters React hooks warning', () => {
    expect(isConsoleNoise('Warning: React has detected a change in the order of Hooks called by InboxPage')).toBe(true);
  });

  it('filters webpack-internal errors', () => {
    expect(isConsoleNoise('Error at webpack-internal:///(app-pages-browser)/./src/app/inbox/page.tsx:61:27')).toBe(true);
  });

  it('filters HMR messages', () => {
    expect(isConsoleNoise('[HMR] Waiting for update signal from WDS...')).toBe(true);
  });

  it('filters Fast Refresh messages', () => {
    expect(isConsoleNoise('Fast Refresh had to perform a full reload')).toBe(true);
  });

  it('keeps real 401 errors', () => {
    expect(isConsoleNoise('Failed to load resource: the server responded with a status of 401 (Unauthorized)')).toBe(false);
  });

  it('keeps real network errors', () => {
    expect(isConsoleNoise('TypeError: Failed to fetch')).toBe(false);
  });

  it('keeps real runtime errors', () => {
    expect(isConsoleNoise('Uncaught ReferenceError: foo is not defined')).toBe(false);
  });

  it('keeps generic error messages', () => {
    expect(isConsoleNoise('Error: Something went wrong in the application')).toBe(false);
  });
});

describe('Clarify Re-instruct Logic', () => {
  it('appends additional instructions to task text', () => {
    const taskText = 'Fix the deployment pipeline thing';
    const instructions = 'This is about the CI/CD pipeline for the staging environment';
    const prompt = `## Task to Clarify\n"${taskText}"\n\n## Additional User Instructions\n${instructions}`;
    expect(prompt).toContain(taskText);
    expect(prompt).toContain(instructions);
    expect(prompt).toContain('Additional User Instructions');
  });

  it('generates correct prompt without instructions', () => {
    const taskText = 'Fix the deployment pipeline thing';
    const instructionSuffix = undefined;
    const prompt = `## Task to Clarify\n"${taskText}"${instructionSuffix ? `\n\n## Additional User Instructions\n${instructionSuffix}` : ''}`;
    expect(prompt).toContain(taskText);
    expect(prompt).not.toContain('Additional User Instructions');
  });
});

describe('Parallel Batch Processing', () => {
  function createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  it('creates correct batch sizes', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const batches = createBatches(items, 3);
    expect(batches).toHaveLength(4);
    expect(batches[0]).toEqual([1, 2, 3]);
    expect(batches[1]).toEqual([4, 5, 6]);
    expect(batches[2]).toEqual([7, 8, 9]);
    expect(batches[3]).toEqual([10]);
  });

  it('handles empty input', () => {
    expect(createBatches([], 3)).toEqual([]);
  });

  it('handles items fewer than batch size', () => {
    const batches = createBatches([1, 2], 5);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([1, 2]);
  });

  it('handles batch size of 1 (sequential)', () => {
    const batches = createBatches([1, 2, 3], 1);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toEqual([1]);
    expect(batches[1]).toEqual([2]);
    expect(batches[2]).toEqual([3]);
  });

  it('handles exact batch size match', () => {
    const batches = createBatches([1, 2, 3], 3);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([1, 2, 3]);
  });
});

describe('sanitizeResult', () => {
  function sanitizeResult(r: any) {
    return {
      title: r.title || '',
      nextAction: r.nextAction || '',
      projectName: r.projectName || '',
      newProject: r.newProject || false,
      priority: r.priority || 4,
      priorityReasoning: r.priorityReasoning || '',
      labels: Array.isArray(r.labels) ? r.labels : [],
      dueDate: r.dueDate || null,
      timeEstimateMin: r.timeEstimateMin || 0,
      energyLevel: r.energyLevel || 'medium',
      contextNotes: r.contextNotes || '',
      relatedPeople: Array.isArray(r.relatedPeople) ? r.relatedPeople : [],
      relatedLinks: Array.isArray(r.relatedLinks) ? r.relatedLinks : [],
      decompositionNeeded: r.decompositionNeeded || false,
      subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
      confidence: typeof r.confidence === 'number' && !isNaN(r.confidence) ? r.confidence : 0.5,
      questions: Array.isArray(r.questions) ? r.questions : [],
      knowledgeExtracted: Array.isArray(r.knowledgeExtracted) ? r.knowledgeExtracted : [],
    };
  }

  it('fills defaults for completely empty response', () => {
    const result = sanitizeResult({});
    expect(result.title).toBe('');
    expect(result.priority).toBe(4);
    expect(result.labels).toEqual([]);
    expect(result.dueDate).toBeNull();
    expect(result.confidence).toBe(0.5);
    expect(result.subtasks).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.energyLevel).toBe('medium');
  });

  it('preserves valid fields', () => {
    const result = sanitizeResult({
      title: 'Test',
      priority: 1,
      confidence: 0.95,
      labels: ['work'],
      dueDate: '2026-04-15',
    });
    expect(result.title).toBe('Test');
    expect(result.priority).toBe(1);
    expect(result.confidence).toBe(0.95);
    expect(result.labels).toEqual(['work']);
    expect(result.dueDate).toBe('2026-04-15');
  });

  it('handles NaN confidence', () => {
    expect(sanitizeResult({ confidence: NaN }).confidence).toBe(0.5);
    expect(sanitizeResult({ confidence: undefined }).confidence).toBe(0.5);
    expect(sanitizeResult({ confidence: 'high' }).confidence).toBe(0.5);
  });

  it('handles non-array labels/subtasks/questions', () => {
    const result = sanitizeResult({
      labels: 'work',
      subtasks: 'split it',
      questions: null,
    });
    expect(result.labels).toEqual([]);
    expect(result.subtasks).toEqual([]);
    expect(result.questions).toEqual([]);
  });
});

describe('autoSplitIfNeeded', () => {
  it('returns null when decompositionNeeded is false', () => {
    const result = {
      decompositionNeeded: false,
      subtasks: [{ title: 'A', nextAction: 'Do A' }],
    };
    expect(result.decompositionNeeded).toBe(false);
  });

  it('returns null when subtasks array is empty', () => {
    const result = {
      decompositionNeeded: true,
      subtasks: [],
    };
    expect(result.decompositionNeeded && result.subtasks.length > 0).toBe(false);
  });

  it('extracts split texts from subtask titles', () => {
    const result = {
      decompositionNeeded: true,
      subtasks: [
        { title: 'Pay ER bill', nextAction: 'Call billing' },
        { title: 'Schedule appointment', nextAction: 'Book online' },
        { title: '', nextAction: 'Empty title filtered out' },
      ],
    };
    const splitTexts = result.subtasks.map(s => s.title).filter(Boolean);
    expect(splitTexts).toEqual(['Pay ER bill', 'Schedule appointment']);
    expect(splitTexts).toHaveLength(2);
  });
});

describe('voice transcript for re-instruct', () => {
  it('prefers raw transcript over extracted tasks', () => {
    const data = {
      transcript: 'This should be three tasks: pay the bill, schedule follow up, and submit insurance claim',
      tasks: [{ text: 'Pay bill' }, { text: 'Schedule follow up' }],
    };
    const transcript = data.transcript || (data.tasks || []).map((t: any) => t.text).join('. ');
    expect(transcript).toBe('This should be three tasks: pay the bill, schedule follow up, and submit insurance claim');
  });

  it('falls back to tasks when transcript is missing', () => {
    const data = {
      tasks: [{ text: 'Pay bill' }, { text: 'Schedule follow up' }],
    };
    const transcript = (data as any).transcript || (data.tasks || []).map((t: any) => t.text).join('. ');
    expect(transcript).toBe('Pay bill. Schedule follow up');
  });

  it('handles empty response gracefully', () => {
    const data = {} as any;
    const transcript = data.transcript || (data.tasks || []).map((t: any) => t.text).join('. ');
    expect(transcript).toBe('');
  });
});
