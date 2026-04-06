import { generateEmbedding } from '../src/lib/knowledge/embedding';

const tasks = [
  'test merging function',
  'see if merging function works',
  'try to use merging function',
  'see if merges complete',
  'merge things!',
];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function main() {
  console.log('Embedding 5 tasks...');
  const embeddings = await Promise.all(tasks.map(t => generateEmbedding(t, { sourceContext: 'test' })));
  console.log(`Dimensions: ${embeddings[0].length}`);

  console.log('\nPairwise similarity matrix:');
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      const flag = sim >= 0.65 ? '✓' : sim >= 0.55 ? '~' : '✗';
      console.log(`  ${flag} ${sim.toFixed(3)}  "${tasks[i]}" ↔ "${tasks[j]}"`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
