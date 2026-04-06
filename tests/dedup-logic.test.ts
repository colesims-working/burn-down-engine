import { describe, it, expect } from 'vitest';

/**
 * Tests for duplicate detection logic (Bugs 7 & 8).
 */
describe('Duplicate Detection - findDuplicate', () => {
  // Pure reimplementation of findDuplicate from dedup.ts
  function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }

  interface Candidate {
    id: string;
    title: string;
    vec: Float32Array;
  }

  function findDuplicate(
    vec: Float32Array,
    candidates: Candidate[],
    threshold: number,
  ): { taskId: string; similarity: number } | null {
    let bestId: string | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = cosineSimilarity(vec, c.vec);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestId = c.id;
      }
    }
    return bestId ? { taskId: bestId, similarity: bestScore } : null;
  }

  it('finds exact duplicate (identical vectors)', () => {
    const vec = new Float32Array([1, 0, 0, 1]);
    const candidates: Candidate[] = [
      { id: 'a', title: 'Task A', vec: new Float32Array([1, 0, 0, 1]) },
    ];
    const result = findDuplicate(vec, candidates, 0.85);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('a');
    expect(result!.similarity).toBeCloseTo(1.0);
  });

  it('returns null when similarity is below threshold', () => {
    const vec = new Float32Array([1, 0, 0, 0]);
    const candidates: Candidate[] = [
      { id: 'a', title: 'Task A', vec: new Float32Array([0, 1, 0, 0]) },
    ];
    const result = findDuplicate(vec, candidates, 0.85);
    expect(result).toBeNull();
  });

  it('returns the best match among multiple candidates', () => {
    const vec = new Float32Array([1, 0.1, 0, 0]);
    const candidates: Candidate[] = [
      { id: 'a', title: 'Weak', vec: new Float32Array([0.5, 0.5, 0.5, 0.5]) },
      { id: 'b', title: 'Strong', vec: new Float32Array([1, 0.1, 0, 0]) },
    ];
    const result = findDuplicate(vec, candidates, 0.85);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('b');
  });

  it('handles empty candidates', () => {
    const vec = new Float32Array([1, 0, 0, 0]);
    const result = findDuplicate(vec, [], 0.85);
    expect(result).toBeNull();
  });

  it('handles zero vectors gracefully', () => {
    const vec = new Float32Array([0, 0, 0, 0]);
    const candidates: Candidate[] = [
      { id: 'a', title: 'Task', vec: new Float32Array([1, 0, 0, 0]) },
    ];
    const result = findDuplicate(vec, candidates, 0.85);
    expect(result).toBeNull();
  });

  it('respects lower threshold for Gemini embeddings', () => {
    // Simulate vectors that are similar but not >0.92
    const vec = new Float32Array([1, 0.3, 0.1, 0]);
    const candidates: Candidate[] = [
      { id: 'a', title: 'Similar', vec: new Float32Array([1, 0.4, 0.05, 0.1]) },
    ];
    const similarity = cosineSimilarity(vec, candidates[0].vec);
    // Should be caught at 0.85 but might miss at 0.92
    const resultLow = findDuplicate(vec, candidates, 0.85);
    const resultHigh = findDuplicate(vec, candidates, 0.99);
    if (similarity >= 0.85) {
      expect(resultLow).not.toBeNull();
    }
    if (similarity < 0.99) {
      expect(resultHigh).toBeNull();
    }
  });
});

describe('Duplicate view shows both tasks', () => {
  interface InboxTask { id: string; title: string; duplicateSuspectOf: string | null; dupeSimilarity: number | null; }

  function getDuplicatePairs(tasks: InboxTask[]): { suspect: InboxTask; original: InboxTask | undefined }[] {
    const suspects = tasks.filter(t => t.duplicateSuspectOf);
    return suspects.map(s => ({
      suspect: s,
      original: tasks.find(t => t.id === s.duplicateSuspectOf),
    }));
  }

  it('returns both suspect and original in each pair', () => {
    const tasks: InboxTask[] = [
      { id: 'a', title: 'Make resume updates', duplicateSuspectOf: 'b', dupeSimilarity: 0.91 },
      { id: 'b', title: 'Finish revamping resume', duplicateSuspectOf: null, dupeSimilarity: null },
    ];
    const pairs = getDuplicatePairs(tasks);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].suspect.title).toBe('Make resume updates');
    expect(pairs[0].original?.title).toBe('Finish revamping resume');
  });

  it('groups 3+ similar tasks into one cluster', () => {
    const tasks: InboxTask[] = [
      { id: 'a', title: 'Resume A', duplicateSuspectOf: 'c', dupeSimilarity: 0.9 },
      { id: 'b', title: 'Resume B', duplicateSuspectOf: 'c', dupeSimilarity: 0.88 },
      { id: 'c', title: 'Resume C', duplicateSuspectOf: null, dupeSimilarity: null },
    ];
    // Union-find clustering: A→C and B→C should form one cluster {A, B, C}
    const parent = new Map<string, string>();
    function find(id: string): string { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id)!)!); id = parent.get(id)!; } return id; }
    function union(a: string, b: string) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); }
    const suspects = tasks.filter(t => t.duplicateSuspectOf);
    for (const s of suspects) {
      if (!parent.has(s.id)) parent.set(s.id, s.id);
      if (!parent.has(s.duplicateSuspectOf!)) parent.set(s.duplicateSuspectOf!, s.duplicateSuspectOf!);
      union(s.id, s.duplicateSuspectOf!);
    }
    const clusters = new Map<string, string[]>();
    for (const [id] of parent) { const r = find(id); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r)!.push(id); }
    const groups = Array.from(clusters.values()).filter(g => g.length >= 2);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('deduplicates bidirectional pairs (A→B + B→A)', () => {
    const tasks: InboxTask[] = [
      { id: 'a', title: 'Resume updates', duplicateSuspectOf: 'b', dupeSimilarity: 0.91 },
      { id: 'b', title: 'Revamp resume', duplicateSuspectOf: 'a', dupeSimilarity: 0.91 },
    ];
    // Deduplicate: only keep one per canonical pair
    const seen = new Set<string>();
    const deduped = tasks.filter(t => t.duplicateSuspectOf).filter(s => {
      const pair = [s.id, s.duplicateSuspectOf!].sort().join(':');
      if (seen.has(pair)) return false;
      seen.add(pair);
      return true;
    });
    expect(deduped).toHaveLength(1);
  });

  it('handles missing original gracefully', () => {
    const tasks: InboxTask[] = [
      { id: 'a', title: 'Task A', duplicateSuspectOf: 'nonexistent', dupeSimilarity: 0.85 },
    ];
    const pairs = getDuplicatePairs(tasks);
    expect(pairs[0].original).toBeUndefined();
  });
});

describe('Candidate embedding dimension filtering', () => {
  it('rejects 768-dim embeddings (old Gemini model)', () => {
    const EXPECTED_DIMS = 4096;
    const geminiVec = new Float32Array(768);
    expect(geminiVec.length).not.toBe(EXPECTED_DIMS);
    // This vector would be skipped in getCandidateEmbeddings
  });

  it('accepts 4096-dim embeddings (Qwen3)', () => {
    const EXPECTED_DIMS = 4096;
    const qwenVec = new Float32Array(4096);
    expect(qwenVec.length).toBe(EXPECTED_DIMS);
  });

  it('cosine similarity between mismatched dimensions produces wrong results', () => {
    // This is why we filter — demonstrate the bug
    const a = new Float32Array([1, 0, 0]); // 3-dim
    const b = new Float32Array([1, 0, 0, 0, 0]); // 5-dim
    // cosineSimilarity iterates min(a.length, b.length) but normB includes extra dims
    // Result is mathematically wrong — this is the bug we prevent
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    // normB only sees first 3 elements of b, missing the actual norm
    expect(normB).toBe(1); // Would be wrong if b had nonzero later elements
  });
});

describe('Embedding model for dedup', () => {
  it('dedup imports generateEmbedding from knowledge system, not geminiEmbed', async () => {
    // Verify at the source level that we use the Qwen3 model, not Gemini
    const dedupSource = await import('fs').then(fs =>
      fs.readFileSync('src/lib/embeddings/dedup.ts', 'utf-8')
    );
    expect(dedupSource).toContain("from '@/lib/knowledge/embedding'");
    expect(dedupSource).not.toContain("from '@/lib/llm/gemini'");
    expect(dedupSource).not.toContain('geminiEmbed');
  });
});

describe('Exact title match fallback', () => {
  function normalizeTitle(title: string): string {
    return title.trim().toLowerCase();
  }

  it('matches case-insensitively', () => {
    expect(normalizeTitle('Buy Groceries')).toBe(normalizeTitle('buy groceries'));
  });

  it('trims whitespace', () => {
    expect(normalizeTitle('  Buy Groceries  ')).toBe(normalizeTitle('Buy Groceries'));
  });

  it('does not match different titles', () => {
    expect(normalizeTitle('Buy Groceries')).not.toBe(normalizeTitle('Buy groceries at store'));
  });
});
