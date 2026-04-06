import { buildContext } from '../src/lib/llm/context';

async function main() {
  const queries = [
    'Review quarterly financials and prepare report',
    'Set up mentoring session with team lead',
    'Fix broken deployment pipeline',
  ];

  for (const q of queries) {
    const t0 = Date.now();
    const ctx = await buildContext(q, 'clarify');
    console.log(`"${q.slice(0, 40)}": ${Date.now() - t0}ms (${ctx.length} chars)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
