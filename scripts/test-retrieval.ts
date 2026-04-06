import { buildKnowledgeContext } from '../src/lib/knowledge/retrieval';

async function main() {
  console.log('Testing retrieval pipeline...');
  const context = await buildKnowledgeContext('pokemon grading and collection management', 'clarify');
  console.log('Context length:', context.length);
  console.log('---');
  console.log(context.slice(0, 1000));
  console.log('---');
  console.log('SUCCESS');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
